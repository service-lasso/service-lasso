import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, open, readFile, rename } from "node:fs/promises";
import path from "node:path";
import { appendAuditEvent } from "../audit/store.js";
import { withCrossProcessFileLock } from "../security/cross-process-file-lock.js";
import { preflightReleaseArchive, type ReleaseArchiveType } from "./release-archive-preflight.js";
import { claimStagedRegistrationInStore, completeStagedRegistrationInStore, serviceRegistrationOperationStorePath, type PersistedOperationStore, type StagedRegistrationOperationInput } from "../operator/remote-service-registration.js";

export type StageState =
  | "uploading" | "ready" | "rejected" | "expired" | "claimed"
  | "consumed" | "quarantined" | "cleaned" | "unknown";

export interface ReleaseIdentity {
  repo: string; releaseTag: string; commitSha: string; targetServiceId: string;
  platform: "win32" | "linux" | "darwin"; archiveType: ReleaseArchiveType;
  assetName: string; assetId: string; archiveBytes: number; archiveSha256: string;
  manifestSha256: string; releaseId: string; manifestAssetId?: string;
  checksumAssetId?: string | null;
  /** Same-release dedicated manifest bytes held by Core after resolver validation. */
  manifestBytes?: string;
}

export interface StageResolver {
  resolve(input: {
    repo: string; releaseTag: string; commitSha: string; targetServiceId: string; platform: string;
  }): Promise<ReleaseIdentity>;
}

export interface ClaimedStageInput {
  serviceId: string; byteObjectId: string; byteLength: number; archiveSha256: string;
  manifestSha256: string; releaseId: string; targetSha: string; workspaceId: string;
  repo: string; releaseTag: string; assetId: string; assetName: string; archiveType: ReleaseArchiveType;
  platform: "win32" | "linux" | "darwin";
  actorId: string; stageId: string; operationId: string; manifestAssetId?: string;
  /** Original registration identity retained with the claimed Core-held bytes. */
  idempotencyKey: string;
  checksumAssetId?: string | null; manifestBytes?: Uint8Array;
  /** The direct child can consume this Core-held object once and cannot substitute it. */
  readByteObject(): Uint8Array | null;
}

/** The child boundary registers one service manifest. It has no lifecycle authority. */
export interface DirectChildImporter {
  import(input: ClaimedStageInput): Promise<"completed" | "conflict" | "unknown">;
  reconcile?(input: Omit<ClaimedStageInput, "readByteObject" | "manifestBytes"> & { byteLength: number; manifestBytes: Uint8Array }): Promise<"completed" | "conflict" | "unknown">;
}

export interface TransferActor { id: string; workspaceId: string; canConfigure: boolean; }
export interface SharedStagedRegistrationOperationStore {
  claim(input: {
    actorId: string; workspaceId: string; idempotencyKey: string; fingerprint: string; stageId: string;
    byteObjectId: string; byteLength: number; fullDigest: string; identity: ReleaseIdentity;
  }): Promise<{ id: string; state: "completed" | "conflict" | "unknown"; replayed: boolean }>;
  complete(input: { actorId: string; operationId: string; outcome: "completed" | "conflict" | "unknown" }): Promise<void>;
}
interface Chunk { ordinal: number; start: number; end: number; digest: string; fingerprint: string; bytes: string; }
interface ByteObject { id: string; bytes: string; sha256: string; size: number; }
interface Operation { id: string; key: string; state: "completed" | "conflict" | "unknown"; stageDigest: string; targetServiceId: string; }
interface Journal {
  version: 1; operationId: string; stageId: string; actorId: string; workspaceId: string;
  byteObjectId: string; byteLength: number; fullDigest: string; fingerprint: string;
  releaseIdentity: ReleaseIdentity; phase: "prepared" | "claimed" | "sealed"; createdAt: number;
}
interface AuditOutbox {
  operationId: string; actorId: string; workspaceId: string; targetServiceId: string;
  outcome: "completed" | "conflict" | "unknown";
}
interface Stage {
  id: string; actorId: string; workspaceId: string; state: StageState; identity: ReleaseIdentity;
  tokenHash: string; confirmationHash: string | null; confirmationExpiresAt: number | null;
  expiresAt: number; chunks: Chunk[]; received: number; archiveDigestPrefix: string | null;
  manifestDigestPrefix: string; byteObject: ByteObject | null; operation: Operation | null;
  journal: Journal | null; terminalAt: number | null;
}
interface StageSection { version: 3; stages: Stage[]; auditOutbox: AuditOutbox[]; legacySidecarDigest?: string; }
/** One atomic authority for #1462 operations and #1463 stage/journal state. */
interface Store extends PersistedOperationStore { stagedTransfer: StageSection; }

const MAX_BYTES = 64 * 1024 * 1024;
const MAX_CHUNKS = 64;
const MAX_ENTRIES = 1024;
const MAX_EXPANDED = 128 * 1024 * 1024;
const UPLOAD_MS = 30 * 60_000;
const READY_MS = 10 * 60_000;
const CONFIRM_MS = 10 * 60_000;
const REJECTED_MS = 24 * 60 * 60_000;
const QUARANTINE_MS = 7 * 24 * 60 * 60_000;
const hash = (value: Uint8Array | string) => createHash("sha256").update(value).digest("hex");
const opaque = (prefix: string, bytes: number) => prefix + randomBytes(bytes).toString("base64url");
const equal = (left: string, right: string) => left.length === right.length && timingSafeEqual(Buffer.from(left), Buffer.from(right));
const idPattern = /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/;
const repoPattern = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const shaPattern = /^[a-f0-9]{40}$/;
const digestPattern = /^[a-f0-9]{64}$/;
const keyPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$/;
const stagePattern = /^stg_[A-Za-z0-9_-]{32}$/;
const tokenPattern = /^sut_[A-Za-z0-9_-]{43}$/;
const confirmationPattern = /^scf_[A-Za-z0-9_-]{32}$/;

function active(state: StageState): boolean { return !["consumed", "cleaned"].includes(state); }
function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === "object" && !Array.isArray(value); }
function only(recordValue: Record<string, unknown>, allowed: string[]): boolean { return Object.keys(recordValue).every((key) => allowed.includes(key)); }

/**
 * The durable document is recovery authority.  It must never be "best effort"
 * parsed: a dangling or contradictory relation could otherwise free capacity or
 * direct reconciliation at bytes that were not the claimed object.
 */
function assertCoherentStagedTransferStore(store: Store): void {
  if (!only(store as unknown as Record<string, unknown>, ["version", "operations", "stagedTransfer"]) || !record(store.stagedTransfer) || !only(store.stagedTransfer, ["version", "stages", "auditOutbox", "legacySidecarDigest"])) throw new Error("invalid staged state");
  const stages = store.stagedTransfer.stages;
  const stageIds = new Set<string>();
  const operationIds = new Set<string>();
  for (const candidate of stages) {
    if (!record(candidate) || !only(candidate, ["id", "actorId", "workspaceId", "state", "identity", "tokenHash", "confirmationHash", "confirmationExpiresAt", "expiresAt", "chunks", "received", "archiveDigestPrefix", "manifestDigestPrefix", "byteObject", "operation", "journal", "terminalAt"])) throw new Error("invalid stage fields");
    if (typeof candidate.id !== "string" || !stagePattern.test(candidate.id) || stageIds.has(candidate.id) || typeof candidate.actorId !== "string" || !candidate.actorId || typeof candidate.workspaceId !== "string" || !candidate.workspaceId || !["uploading", "ready", "rejected", "expired", "claimed", "consumed", "quarantined", "cleaned", "unknown"].includes(String(candidate.state))) throw new Error("invalid stage identity");
    stageIds.add(candidate.id);
    if (!record(candidate.identity) || !only(candidate.identity, ["repo", "releaseTag", "commitSha", "targetServiceId", "platform", "archiveType", "assetName", "assetId", "archiveBytes", "archiveSha256", "manifestSha256", "releaseId", "manifestAssetId", "checksumAssetId", "manifestBytes"]) || typeof candidate.identity.archiveSha256 !== "string" || !digestPattern.test(candidate.identity.archiveSha256) || typeof candidate.identity.archiveBytes !== "number" || !Number.isSafeInteger(candidate.identity.archiveBytes) || candidate.identity.archiveBytes < 1) throw new Error("invalid release identity");
    if (candidate.byteObject !== null && (!record(candidate.byteObject) || !only(candidate.byteObject, ["id", "bytes", "sha256", "size"]) || typeof candidate.byteObject.id !== "string" || typeof candidate.byteObject.bytes !== "string" || candidate.byteObject.sha256 !== candidate.identity.archiveSha256 || candidate.byteObject.size !== candidate.identity.archiveBytes)) throw new Error("invalid byte object");
    if (candidate.operation !== null) {
      if (!record(candidate.operation) || !only(candidate.operation, ["id", "key", "state", "stageDigest", "targetServiceId"]) || typeof candidate.operation.id !== "string" || operationIds.has(candidate.operation.id) || candidate.operation.stageDigest !== candidate.identity.archiveSha256 || candidate.operation.targetServiceId !== candidate.identity.targetServiceId) throw new Error("invalid stage operation");
      operationIds.add(candidate.operation.id);
      if (!record(candidate.journal) || candidate.journal.operationId !== candidate.operation.id || candidate.journal.stageId !== candidate.id || candidate.journal.actorId !== candidate.actorId || candidate.journal.workspaceId !== candidate.workspaceId || candidate.journal.byteObjectId !== (candidate.byteObject as Record<string, unknown> | null)?.id || candidate.journal.byteLength !== (candidate.byteObject as Record<string, unknown> | null)?.size || candidate.journal.fullDigest !== candidate.identity.archiveSha256) throw new Error("invalid stage journal");
    } else if (candidate.journal !== null && (!record(candidate.journal) || candidate.journal.phase !== "prepared" || candidate.journal.stageId !== candidate.id || candidate.journal.actorId !== candidate.actorId || candidate.journal.workspaceId !== candidate.workspaceId || candidate.journal.byteObjectId !== (candidate.byteObject as Record<string, unknown> | null)?.id || candidate.journal.byteLength !== (candidate.byteObject as Record<string, unknown> | null)?.size || candidate.journal.fullDigest !== candidate.identity.archiveSha256)) throw new Error("orphan journal");
  }
  const persisted = new Map<string, Record<string, unknown>>();
  for (const candidate of store.operations) {
    if (!record(candidate) || typeof candidate.id !== "string" || persisted.has(candidate.id)) throw new Error("invalid operation");
    persisted.set(candidate.id, candidate);
  }
  for (const stage of stages) {
    if (!record(stage) || !record(stage.operation)) continue;
    const operation = persisted.get(stage.operation.id);
    const staged = operation?.staged;
    if (!record(staged) || staged.stageId !== stage.id || staged.workspaceId !== stage.workspaceId || staged.byteObjectId !== (stage.byteObject as Record<string, unknown> | null)?.id || staged.byteLength !== (stage.byteObject as Record<string, unknown> | null)?.size || staged.fullDigest !== stage.identity.archiveSha256 || operation?.actorId !== stage.actorId) throw new Error("operation-stage mismatch");
  }
  for (const entry of store.stagedTransfer.auditOutbox) {
    if (!record(entry) || !only(entry, ["operationId", "actorId", "workspaceId", "targetServiceId", "outcome"])) throw new Error("invalid audit outbox");
    const stage = stages.find((candidate) => candidate.operation?.id === entry.operationId);
    if (!stage || stage.actorId !== entry.actorId || stage.workspaceId !== entry.workspaceId || stage.identity.targetServiceId !== entry.targetServiceId) throw new Error("orphan audit outbox");
  }
}

export class StagedServiceTransfer {
  constructor(
    private readonly workspaceRoot: string,
    private readonly resolver: StageResolver,
    private readonly importer: DirectChildImporter,
    private readonly now: () => number = Date.now,
    private readonly operationStore?: SharedStagedRegistrationOperationStore,
  ) {}

  private statePath() {
    return serviceRegistrationOperationStorePath(this.workspaceRoot);
  }

  private legacyStatePath() {
    return path.join(this.workspaceRoot, ".service-lasso", "operator", "staged-service-transfers.json");
  }

  private async locked<T>(work: (store: Store) => Promise<T>): Promise<T> {
    const file = this.statePath();
    return await withCrossProcessFileLock(file + ".lock", async () => {
      const store = await this.readStore(file);
      this.recover(store.stagedTransfer);
      try {
        const result = await work(store);
        await this.writeStore(file, store);
        return result;
      } catch (error) {
        // Terminal denials (notably digest mismatch) are durable outcomes, not
        // transient in-memory state that disappears when the request closes.
        await this.writeStore(file, store);
        throw error;
      }
    }, { unavailableMessage: "staged transfer state unavailable" });
  }

  private async readStore(file: string): Promise<Store> {
    try {
      const store = JSON.parse(await readFile(file, "utf8")) as Partial<Store>;
      if (store.version !== 1 || !Array.isArray(store.operations)) throw new Error("invalid state");
      if (!store.stagedTransfer) {
        try {
          const legacy = JSON.parse(await readFile(this.legacyStatePath(), "utf8")) as StageSection;
          if (legacy.version !== 3 || !Array.isArray(legacy.stages) || !Array.isArray(legacy.auditOutbox)) throw new Error("invalid legacy state");
          return { version: 1, operations: store.operations, stagedTransfer: { ...legacy, legacySidecarDigest: hash(JSON.stringify(legacy)) } };
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          return { version: 1, operations: store.operations, stagedTransfer: { version: 3, stages: [], auditOutbox: [] } };
        }
      }
      if (store.stagedTransfer.version !== 3 || !Array.isArray(store.stagedTransfer.stages) || !Array.isArray(store.stagedTransfer.auditOutbox)) throw new Error("invalid state");
      // A legacy v3 sidecar is accepted only when it is an exact retained copy
      // of the migrated section. A divergent sidecar is evidence of a partial
      // cross-store commit and must remain unavailable rather than guessed at.
      try {
        const legacy = JSON.parse(await readFile(this.legacyStatePath(), "utf8")) as StageSection;
        const legacyDigest = hash(JSON.stringify(legacy));
        if (legacy.version !== 3 || !Array.isArray(legacy.stages) || !Array.isArray(legacy.auditOutbox)) throw new Error("invalid legacy state");
        if (store.stagedTransfer.legacySidecarDigest) {
          if (store.stagedTransfer.legacySidecarDigest !== legacyDigest) throw new Error("divergent legacy state");
        } else {
          const { legacySidecarDigest: _legacySidecarDigest, ...section } = store.stagedTransfer;
          if (JSON.stringify(legacy) !== JSON.stringify(section)) throw new Error("divergent legacy state");
          store.stagedTransfer.legacySidecarDigest = legacyDigest;
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      assertCoherentStagedTransferStore(store as Store);
      return store as Store;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        try {
          const legacy = JSON.parse(await readFile(this.legacyStatePath(), "utf8")) as StageSection;
          if (legacy.version !== 3 || !Array.isArray(legacy.stages) || !Array.isArray(legacy.auditOutbox)) throw new Error("invalid legacy state");
          return { version: 1, operations: [], stagedTransfer: { ...legacy, legacySidecarDigest: hash(JSON.stringify(legacy)) } };
        } catch (legacyError) {
          if ((legacyError as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, operations: [], stagedTransfer: { version: 3, stages: [], auditOutbox: [] } };
          throw new TransferError("registration_unavailable", 503);
        }
      }
      throw new TransferError("registration_unavailable", 503);
    }
  }

  private async writeStore(file: string, store: Store): Promise<void> {
    await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    const temporary = file + "." + randomBytes(8).toString("hex") + ".tmp";
    // A claimed byte object and its journal are recovery authority.  Do not
    // publish a rename whose file data has only reached the process cache.
    const handle = await open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(JSON.stringify(store) + "\n", "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, file);
  }

  private recover(store: StageSection): void {
    const now = this.now();
    for (const stage of store.stages) {
      if ((stage.state === "uploading" || stage.state === "ready") && stage.expiresAt <= now) {
        stage.state = "expired"; stage.terminalAt = stage.expiresAt;
        stage.confirmationHash = null; stage.confirmationExpiresAt = null;
      }
      if (stage.confirmationExpiresAt !== null && stage.confirmationExpiresAt <= now) {
        stage.confirmationHash = null; stage.confirmationExpiresAt = null;
      }
      if ((stage.state === "rejected" || stage.state === "expired") && stage.terminalAt !== null && stage.terminalAt + REJECTED_MS <= now) this.clean(stage);
      if (stage.state === "quarantined" && stage.terminalAt !== null && stage.terminalAt + QUARANTINE_MS <= now) this.clean(stage);
    }
  }

  private clean(stage: Stage): void { stage.state = "cleaned"; stage.chunks = []; stage.byteObject = null; }
  private actor(actor: TransferActor): void { if (!actor.canConfigure || !actor.id || !actor.workspaceId) throw new TransferError("forbidden", 403); }
  private find(store: StageSection, actor: TransferActor, id: string): Stage {
    this.actor(actor);
    if (!stagePattern.test(id)) throw new TransferError("stage_not_found", 404);
    const stage = store.stages.find((item) => item.id === id && item.actorId === actor.id && item.workspaceId === actor.workspaceId);
    if (!stage) throw new TransferError("stage_not_found", 404);
    return stage;
  }
  private chunkBytes(stage: Stage): number { return Math.min(1024 * 1024, Math.max(256 * 1024, Math.ceil(stage.identity.archiveBytes / MAX_CHUNKS))); }
  private usage(stages: Stage[]) {
    return stages.filter((stage) => active(stage.state)).reduce((total, stage) => ({
      stages: total.stages + 1, bytes: total.bytes + stage.identity.archiveBytes, chunks: total.chunks + MAX_CHUNKS,
      entries: total.entries + MAX_ENTRIES, expanded: total.expanded + MAX_EXPANDED,
    }), { stages: 0, bytes: 0, chunks: 0, entries: 0, expanded: 0 });
  }
  private quota(store: StageSection, actor: TransferActor, identity: ReleaseIdentity): void {
    const add = (usage: ReturnType<StagedServiceTransfer["usage"]>) => ({
      stages: usage.stages + 1, bytes: usage.bytes + identity.archiveBytes, chunks: usage.chunks + MAX_CHUNKS,
      entries: usage.entries + MAX_ENTRIES, expanded: usage.expanded + MAX_EXPANDED,
    });
    const actorUse = add(this.usage(store.stages.filter((stage) => stage.actorId === actor.id)));
    const workspaceUse = add(this.usage(store.stages.filter((stage) => stage.workspaceId === actor.workspaceId)));
    if (actorUse.stages > 8 || actorUse.bytes > 256 * 1024 * 1024 || actorUse.chunks > 512 || actorUse.entries > 8192 || actorUse.expanded > 1024 * 1024 * 1024 || workspaceUse.stages > 64 || workspaceUse.bytes > 1024 * 1024 * 1024 || workspaceUse.chunks > 4096 || workspaceUse.entries > 65536 || workspaceUse.expanded > 8 * 1024 * 1024 * 1024) throw new TransferError("stage_quota_exceeded", 429);
  }

  private assertIdentity(input: { targetServiceId: string; provenance: { repo: string; releaseTag: string; commitSha: string }; platform: string }, identity: ReleaseIdentity): void {
    if (identity.targetServiceId !== input.targetServiceId || identity.repo !== input.provenance.repo || identity.releaseTag !== input.provenance.releaseTag || identity.commitSha !== input.provenance.commitSha || identity.platform !== input.platform || !["zip", "tar.gz", "tgz"].includes(identity.archiveType) || identity.archiveBytes < 1 || identity.archiveBytes > MAX_BYTES || !digestPattern.test(identity.archiveSha256) || !digestPattern.test(identity.manifestSha256) || !identity.releaseId || !identity.assetId || !identity.assetName) throw new TransferError("release_provenance_unavailable", 503);
  }

  async create(actor: TransferActor, input: { targetServiceId: string; provenance: { repo: string; releaseTag: string; commitSha: string }; platform: string; manifestSchemaVersion: string }) {
    this.actor(actor);
    if (!idPattern.test(input.targetServiceId) || !repoPattern.test(input.provenance.repo) || !shaPattern.test(input.provenance.commitSha) || !["win32", "linux", "darwin"].includes(input.platform) || input.manifestSchemaVersion !== "service-lasso.service-manifest/v1") throw new TransferError("invalid_request", 400);
    const identity = await this.resolver.resolve({ ...input.provenance, targetServiceId: input.targetServiceId, platform: input.platform });
    this.assertIdentity(input, identity);
    return await this.locked(async (store) => {
      this.quota(store.stagedTransfer, actor, identity);
      const token = opaque("sut_", 32), id = opaque("stg_", 24), expiresAt = this.now() + UPLOAD_MS;
      const stage: Stage = { id, actorId: actor.id, workspaceId: actor.workspaceId, state: "uploading", identity, tokenHash: hash(token), confirmationHash: null, confirmationExpiresAt: null, expiresAt, chunks: [], received: 0, archiveDigestPrefix: null, manifestDigestPrefix: identity.manifestSha256.slice(0, 12), byteObject: null, operation: null, journal: null, terminalAt: null };
      store.stagedTransfer.stages.push(stage);
      return { stageId: id, state: "uploading" as const, archiveBytes: identity.archiveBytes, chunkBytes: this.chunkBytes(stage), uploadToken: token, expiresAt: new Date(expiresAt).toISOString() };
    });
  }

  async upload(actor: TransferActor, id: string, ordinal: number, token: string, digest: string, bytes: Uint8Array, range?: { start: number; end: number; total: number }) {
    if (!Number.isInteger(ordinal) || ordinal < 0 || ordinal >= MAX_CHUNKS || !tokenPattern.test(token) || !digestPattern.test(digest)) throw new TransferError("invalid_request", 400);
    await this.locked(async (store) => {
      const stage = this.find(store.stagedTransfer, actor, id);
      if (stage.state !== "uploading" || stage.expiresAt <= this.now() || !equal(stage.tokenHash, hash(token))) throw new TransferError("stage_not_found", 404);
      const unit = this.chunkBytes(stage), start = ordinal * unit, expected = Math.min(unit, stage.identity.archiveBytes - start), end = start + expected - 1;
      if (expected < 1 || bytes.length !== expected || (range && (range.start !== start || range.end !== end || range.total !== stage.identity.archiveBytes))) throw new TransferError("chunk_sequence_conflict", 409);
      const fingerprint = hash(id + "\0" + actor.id + "\0" + ordinal + "\0" + start + "\0" + end + "\0" + stage.identity.archiveBytes + "\0" + digest + "\0" + Buffer.from(bytes).toString("base64"));
      const prior = stage.chunks[ordinal];
      if (prior) { if (prior.fingerprint === fingerprint) return; throw new TransferError("chunk_sequence_conflict", 409); }
      if (ordinal !== stage.chunks.length || hash(bytes) !== digest) throw new TransferError("chunk_sequence_conflict", 409);
      stage.chunks.push({ ordinal, start, end, digest, fingerprint, bytes: Buffer.from(bytes).toString("base64") }); stage.received += bytes.length;
    });
  }

  async finalize(actor: TransferActor, id: string) {
    return await this.locked(async (store) => {
      const stage = this.find(store.stagedTransfer, actor, id);
      if (stage.state !== "uploading" || stage.expiresAt <= this.now() || stage.received !== stage.identity.archiveBytes || stage.chunks.length !== Math.ceil(stage.identity.archiveBytes / this.chunkBytes(stage))) throw new TransferError("digest_mismatch", 409);
      const bytes = Buffer.concat(stage.chunks.map((chunk) => Buffer.from(chunk.bytes, "base64")));
      if (!equal(hash(bytes), stage.identity.archiveSha256)) {
        stage.state = "rejected"; stage.terminalAt = this.now();
        throw new TransferError("digest_mismatch", 409);
      }
      // The parser has a bounded TAR implementation, but the governed T1--T5
      // qualification evidence has not enabled TAR admission.  Keep the
      // release-asset surface fail closed until that exact decision exists.
      if (stage.identity.archiveType !== "zip") {
        stage.state = "rejected"; stage.terminalAt = this.now();
        throw new TransferError("archive_unsafe", 409);
      }
      if (!preflightReleaseArchive({ bytes, archiveType: stage.identity.archiveType }).ok) {
        stage.state = "rejected"; stage.terminalAt = this.now();
        throw new TransferError("archive_unsafe", 409);
      }
      stage.byteObject = { id: "sbo_" + hash(stage.id + "\0" + stage.identity.archiveSha256).slice(0, 32), bytes: bytes.toString("base64"), sha256: stage.identity.archiveSha256, size: bytes.length };
      stage.chunks = []; stage.state = "ready"; stage.expiresAt = this.now() + READY_MS; stage.archiveDigestPrefix = stage.identity.archiveSha256.slice(0, 12);
      return this.public(stage);
    });
  }

  async confirmation(actor: TransferActor, id: string) {
    return await this.locked(async (store) => {
      const stage = this.find(store.stagedTransfer, actor, id);
      if (stage.state !== "ready" || stage.expiresAt <= this.now()) throw new TransferError("stage_not_found", 404);
      const confirmationId = opaque("scf_", 24), expiresAt = this.now() + CONFIRM_MS;
      stage.confirmationHash = hash(confirmationId); stage.confirmationExpiresAt = expiresAt;
      return { confirmationId, stageId: id, expiresAt: new Date(expiresAt).toISOString(), archiveDigestPrefix: stage.archiveDigestPrefix, code: "confirmation_issued" };
    });
  }

  private sameIdentity(left: ReleaseIdentity, right: ReleaseIdentity): boolean {
    return left.repo === right.repo && left.releaseTag === right.releaseTag && left.commitSha === right.commitSha && left.targetServiceId === right.targetServiceId && left.platform === right.platform && left.archiveType === right.archiveType && left.assetName === right.assetName && left.assetId === right.assetId && left.archiveBytes === right.archiveBytes && left.archiveSha256 === right.archiveSha256 && left.manifestSha256 === right.manifestSha256 && left.releaseId === right.releaseId && (left.manifestAssetId ?? null) === (right.manifestAssetId ?? null) && (left.checksumAssetId ?? null) === (right.checksumAssetId ?? null);
  }

  private replay(stage: Stage, key: string): Operation | null {
    if (!stage.operation) return null;
    if (stage.operation.key !== key || stage.operation.stageDigest !== stage.identity.archiveSha256 || stage.operation.targetServiceId !== stage.identity.targetServiceId) throw new TransferError("idempotency_conflict", 409);
    return stage.operation;
  }

  private preparedJournal(stage: Stage, actor: TransferActor, key: string): Journal {
    const byteObject = stage.byteObject!;
    return { version: 1, operationId: "sro_" + hash(actor.id + "\0" + key).slice(0, 32), stageId: stage.id, actorId: actor.id, workspaceId: actor.workspaceId, byteObjectId: byteObject.id, byteLength: byteObject.size, fullDigest: byteObject.sha256, fingerprint: hash(actor.id + "\0" + actor.workspaceId + "\0" + key + "\0" + stage.id + "\0" + byteObject.id + "\0" + byteObject.size + "\0" + byteObject.sha256 + "\0" + JSON.stringify(stage.identity)), releaseIdentity: stage.identity, phase: "prepared", createdAt: this.now() };
  }

  async register(actor: TransferActor, id: string, confirmation: string, key: string) {
    if (!confirmationPattern.test(confirmation) || !keyPattern.test(key)) throw new TransferError("invalid_request", 400);
    const replay = await this.locked(async (store) => {
      const stage = this.find(store.stagedTransfer, actor, id), operation = this.replay(stage, key);
      return operation ? { operation, status: stage.state } : null;
    });
    if (replay) {
      // The stage can still be `claimed` when the process dies after the
      // direct child has run and before its outcome is durably recorded.
      // Operation state, rather than the presentation stage state, is the
      // recovery authority.
      if (replay.operation.state === "unknown") await this.reconcileUnknown(actor, id);
      const current = await this.locked(async (store) => this.find(store.stagedTransfer, actor, id));
      return { operation: current.operation, replayed: true, status: current.state };
    }

    const identity = await this.locked(async (store) => this.find(store.stagedTransfer, actor, id).identity);
    let resolved: ReleaseIdentity;
    try { resolved = await this.resolver.resolve({ repo: identity.repo, releaseTag: identity.releaseTag, commitSha: identity.commitSha, targetServiceId: identity.targetServiceId, platform: identity.platform }); } catch { throw new TransferError("release_provenance_unavailable", 503); }
    if (!this.sameIdentity(identity, resolved)) throw new TransferError("release_binding_mismatch", 409);

    const prepared = await this.locked(async (store) => {
      const stage = this.find(store.stagedTransfer, actor, id), operation = this.replay(stage, key);
      if (operation) return { stage, operation };
      if (stage.state !== "ready" || stage.expiresAt <= this.now() || !stage.byteObject || !this.sameIdentity(stage.identity, resolved)) throw new TransferError("stage_not_found", 404);
      stage.journal ??= this.preparedJournal(stage, actor, key);
      return { stage, operation: null };
    });
    if (prepared.operation) return { operation: prepared.operation, replayed: true, status: prepared.stage.state };

    const claimed = await this.locked(async (store) => {
      const stage = this.find(store.stagedTransfer, actor, id), operation = this.replay(stage, key);
      if (operation) return { stage, operation };
      if (!stage.journal || stage.journal.phase !== "prepared" || stage.state !== "ready" || stage.expiresAt <= this.now() || !stage.confirmationHash || !stage.confirmationExpiresAt || stage.confirmationExpiresAt <= this.now() || !equal(stage.confirmationHash, hash(confirmation)) || !stage.byteObject) throw new TransferError("stage_not_found", 404);
      let shared;
      try {
        const journal = stage.journal;
        const input: StagedRegistrationOperationInput = { workspaceRoot: this.workspaceRoot, actorId: actor.id, workspaceId: actor.workspaceId, idempotencyKey: key, fingerprint: journal.fingerprint, stageId: id, byteObjectId: journal.byteObjectId, byteLength: journal.byteLength, fullDigest: journal.fullDigest, repo: stage.identity.repo, releaseTag: stage.identity.releaseTag, commitSha: stage.identity.commitSha, serviceId: stage.identity.targetServiceId, manifestSha256: stage.identity.manifestSha256, releaseId: stage.identity.releaseId, platform: stage.identity.platform, assetName: stage.identity.assetName, archiveType: stage.identity.archiveType, manifestAssetId: stage.identity.manifestAssetId ?? null, checksumAssetId: stage.identity.checksumAssetId ?? null };
        shared = claimStagedRegistrationInStore(store, input);
      } catch { throw new TransferError("registration_unavailable", 503); }
      if (shared.id !== stage.journal.operationId) throw new TransferError("registration_unavailable", 503);
      if (shared.replayed && shared.status !== "unknown") {
        stage.operation = { id: shared.id, key, state: shared.status, stageDigest: stage.identity.archiveSha256, targetServiceId: stage.identity.targetServiceId };
        stage.state = shared.status === "completed" ? "consumed" : "quarantined";
        stage.journal.phase = "sealed";
        return { stage, operation: stage.operation };
      }
      stage.state = "claimed"; stage.confirmationHash = null; stage.confirmationExpiresAt = null; stage.journal.phase = "claimed";
      stage.operation = { id: stage.journal.operationId, key, state: "unknown", stageDigest: stage.identity.archiveSha256, targetServiceId: stage.identity.targetServiceId };
      return { stage, operation: null };
    });
    if (claimed.operation) return { operation: claimed.operation, replayed: true, status: claimed.stage.state };

    const outcome = await this.importClaimed(actor, id);
    await this.recordOutcome(actor, id, outcome);
    await this.flushAuditOutbox();
    const stage = await this.locked(async (store) => this.find(store.stagedTransfer, actor, id));
    return { operation: stage.operation, replayed: false, status: stage.state };
  }

  private async importClaimed(actor: TransferActor, id: string): Promise<"completed" | "conflict" | "unknown"> {
    const input = await this.locked(async (store) => {
      const stage = this.find(store.stagedTransfer, actor, id), journal = stage.journal, byteObject = stage.byteObject;
      if (!journal || journal.phase !== "claimed" || stage.state !== "claimed" || !byteObject || byteObject.id !== journal.byteObjectId || byteObject.size !== journal.byteLength || byteObject.sha256 !== journal.fullDigest || !this.sameIdentity(stage.identity, journal.releaseIdentity)) return null;
      const manifestBytes = stage.identity.manifestBytes ? Buffer.from(stage.identity.manifestBytes, "base64") : undefined;
      if (manifestBytes && hash(manifestBytes) !== stage.identity.manifestSha256) return null;
      let consumed = false;
      return { serviceId: stage.identity.targetServiceId, byteObjectId: byteObject.id, byteLength: byteObject.size, archiveSha256: byteObject.sha256, manifestSha256: stage.identity.manifestSha256, releaseId: stage.identity.releaseId, targetSha: stage.identity.commitSha, workspaceId: stage.workspaceId, actorId: stage.actorId, stageId: stage.id, operationId: journal.operationId, idempotencyKey: stage.operation!.key, repo: stage.identity.repo, releaseTag: stage.identity.releaseTag, assetId: stage.identity.assetId, assetName: stage.identity.assetName, archiveType: stage.identity.archiveType, platform: stage.identity.platform, manifestAssetId: stage.identity.manifestAssetId, checksumAssetId: stage.identity.checksumAssetId, manifestBytes,
        readByteObject: () => { if (consumed) return null; consumed = true; return Buffer.from(byteObject.bytes, "base64"); },
      };
    });
    if (!input) return "unknown";
    try { return await this.importer.import(input); } catch { return "unknown"; }
  }

  private async reconcileUnknown(actor: TransferActor, id: string): Promise<void> {
    if (!this.importer.reconcile) return;
    const input = await this.locked(async (store) => {
      const stage = this.find(store.stagedTransfer, actor, id), journal = stage.journal, byteObject = stage.byteObject;
      // A process can die after the child returns but before recordOutcome
      // persists the terminal state.  That leaves the durable claim in the
      // original claimed/unknown form.  Reconcile that exact claim without
      // handing bytes to the child again or reacquiring a release asset.
      if ((stage.state !== "claimed" && stage.state !== "unknown") ||
        !stage.operation || stage.operation.state !== "unknown" || !journal || !byteObject ||
        journal.phase !== "claimed" || byteObject.id !== journal.byteObjectId ||
        byteObject.size !== journal.byteLength || byteObject.sha256 !== journal.fullDigest ||
        !this.sameIdentity(stage.identity, journal.releaseIdentity) || !stage.identity.manifestBytes) return null;
      const manifestBytes = Buffer.from(stage.identity.manifestBytes, "base64");
      if (hash(manifestBytes) !== stage.identity.manifestSha256) return null;
       return { serviceId: stage.identity.targetServiceId, byteObjectId: byteObject.id, archiveSha256: byteObject.sha256, manifestSha256: stage.identity.manifestSha256, releaseId: stage.identity.releaseId, targetSha: stage.identity.commitSha, workspaceId: stage.workspaceId, actorId: stage.actorId, stageId: stage.id, operationId: journal.operationId, idempotencyKey: stage.operation.key, repo: stage.identity.repo, releaseTag: stage.identity.releaseTag, assetId: stage.identity.assetId, assetName: stage.identity.assetName, archiveType: stage.identity.archiveType, platform: stage.identity.platform, manifestAssetId: stage.identity.manifestAssetId, checksumAssetId: stage.identity.checksumAssetId, byteLength: byteObject.size, manifestBytes };
    });
    if (!input) return;
    let outcome: "completed" | "conflict" | "unknown" = "unknown";
    try { outcome = await this.importer.reconcile(input); } catch { return; }
    if (outcome === "unknown") return;
    await this.recordOutcome(actor, id, outcome);
  }

  private async recordOutcome(actor: TransferActor, id: string, outcome: "completed" | "conflict" | "unknown"): Promise<void> {
    await this.locked(async (store) => {
      const stage = this.find(store.stagedTransfer, actor, id);
      if (!stage.operation || !stage.journal || stage.journal.phase !== "claimed") return;
      try { completeStagedRegistrationInStore(store, { actorId: actor.id, operationId: stage.operation.id, outcome }); }
      catch { throw new TransferError("registration_unavailable", 503); }
      stage.operation.state = outcome; stage.state = outcome === "completed" ? "consumed" : outcome === "conflict" ? "quarantined" : "unknown";
      stage.terminalAt = outcome === "unknown" ? null : this.now();
      if (outcome !== "unknown") stage.journal.phase = "sealed";
      if (!store.stagedTransfer.auditOutbox.some((entry) => entry.operationId === stage.operation!.id)) store.stagedTransfer.auditOutbox.push({ operationId: stage.operation.id, actorId: stage.actorId, workspaceId: stage.workspaceId, targetServiceId: stage.identity.targetServiceId, outcome });
    });
  }

  private async flushAuditOutbox(): Promise<void> {
    const pending = await this.locked(async (store) => [...store.stagedTransfer.auditOutbox]);
    for (const entry of pending) {
      try {
        await appendAuditEvent({
          // The outbox can survive a process exit after the JSONL append but
          // before this entry is removed.  The durable operation identity is
          // therefore also the Audit idempotency identity.
          eventId: `staged-registration:${entry.operationId}`,
          workspaceRoot: this.workspaceRoot,
          source: "runtime-api",
          action: "staged_service_registration",
          actor: entry.actorId,
          subject: entry.targetServiceId,
          outcome: entry.outcome === "completed" ? "success" : "failure",
          statusCode: entry.outcome === "completed" ? 202 : entry.outcome === "conflict" ? 409 : 503,
          summary: "staged registration " + entry.outcome,
          metadata: { operationId: entry.operationId, workspaceId: entry.workspaceId },
        });
        await this.locked(async (store) => { store.stagedTransfer.auditOutbox = store.stagedTransfer.auditOutbox.filter((candidate) => candidate.operationId !== entry.operationId); });
      } catch {
        // The retained outbox is the sole retry point. Never repeat a child import for Audit.
      }
    }
  }

  async status(actor: TransferActor, id: string) {
    await this.flushAuditOutbox();
    return await this.locked(async (store) => this.public(this.find(store.stagedTransfer, actor, id)));
  }

  private public(stage: Stage) {
    return { stageId: stage.id, state: stage.state, targetServiceId: stage.identity.targetServiceId, archiveBytes: stage.identity.archiveBytes, receivedBytes: stage.received, receivedChunks: stage.chunks.length, archiveDigestPrefix: stage.archiveDigestPrefix, manifestDigestPrefix: stage.manifestDigestPrefix, provenance: { repo: stage.identity.repo, releaseTag: stage.identity.releaseTag, commitSha: stage.identity.commitSha }, platform: stage.identity.platform, assetName: stage.identity.assetName, expiresAt: new Date(stage.expiresAt).toISOString(), code: stage.state };
  }
}

export class TransferError extends Error { constructor(readonly code: string, readonly statusCode: number, message = "Staged service transfer request denied.") { super(message); } }
