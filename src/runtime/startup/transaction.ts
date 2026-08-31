import { randomUUID } from "node:crypto";
import path from "node:path";
import { resolveWorkspaceProcessId } from "../process/registry.js";
import {
  STARTUP_TRANSACTION_POLICY,
  STARTUP_TRANSACTION_SCHEMA_V2,
  readLifecycleDocument,
  writeLifecycleDocument,
} from "../state/lifecycle-persistence.js";

export const STARTUP_TRANSACTION_PHASES = [
  "preflight_reconciliation",
  "allocation_reserved",
  "configuration_materialized",
  "process_spawned",
  "ownership_persisted",
  "owned_readiness_proven",
  "generation_committed",
] as const;

export type StartupTransactionPhase = typeof STARTUP_TRANSACTION_PHASES[number];
export type StartupTransactionStatus = "active" | "committed" | "rolled_back" | "blocked";

export interface StartupTransactionJournal {
  schemaVersion: typeof STARTUP_TRANSACTION_SCHEMA_V2;
  version: 2;
  workspaceId: string;
  canonicalWorkspaceRoot: string;
  transactionId: string;
  generationId: string;
  instanceId: string;
  servicesRoot: string;
  workspaceRoot: string;
  status: StartupTransactionStatus;
  phase: StartupTransactionPhase;
  startedAt: string;
  updatedAt: string;
  finishedAt: string | null;
  allocationRevision: string | null;
  completedActions: string[];
  pendingCompensations: string[];
  startedServiceIds: string[];
  materializationDigests: Record<string, string>;
  failureCode: string | null;
  recoveredFromTransactionId: string | null;
}

export interface StartupTransactionUpdate {
  allocationRevision?: string | null;
  completedActions?: string[];
  addCompensations?: string[];
  removeCompensations?: string[];
  startedServiceIds?: string[];
  materializationDigests?: Record<string, string>;
  failureCode?: string | null;
}

export class StartupTransactionRecoveryRequiredError extends Error {
  readonly code = "startup_transaction_recovery_required";
  readonly statusCode = 409;
  readonly journal: StartupTransactionJournal;

  constructor(journal: StartupTransactionJournal) {
    super(
      `Workspace startup transaction ${journal.transactionId} is ${journal.status} at phase ${journal.phase}; ` +
      "complete its recorded compensations before starting another generation.",
    );
    this.name = "StartupTransactionRecoveryRequiredError";
    this.journal = journal;
  }
}

export function getStartupTransactionJournalPath(workspaceRoot: string): string {
  return path.join(path.resolve(workspaceRoot), ".service-lasso", "startup-transaction.json");
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function samePath(left: string, right: string): boolean {
  const normalize = (value: string) => {
    const resolved = path.resolve(value);
    return process.platform === "win32" ? resolved.toLowerCase() : resolved;
  };
  return normalize(left) === normalize(right);
}

function isPhase(value: unknown): value is StartupTransactionPhase {
  return typeof value === "string" && (STARTUP_TRANSACTION_PHASES as readonly string[]).includes(value);
}

function isStatus(value: unknown): value is StartupTransactionStatus {
  return value === "active" || value === "committed" || value === "rolled_back" || value === "blocked";
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? unique(value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0 && entry.length <= 300))
    : [];
}

function digests(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  const result: Record<string, string> = {};
  for (const [actionId, candidate] of Object.entries(value).slice(0, 128)) {
    if (
      /^[a-f0-9]{24}$/.test(actionId) && typeof candidate === "string" &&
      (candidate === "missing" || /^[a-f0-9]{64}$/.test(candidate))
    ) {
      result[actionId] = candidate;
    }
  }
  return result;
}

function wrapJournal(
  workspaceRoot: string,
  value: Omit<StartupTransactionJournal, "schemaVersion" | "version" | "workspaceId" | "canonicalWorkspaceRoot"> & {
    workspaceRoot: string;
  },
): StartupTransactionJournal {
  const canonicalWorkspaceRoot = path.resolve(workspaceRoot);
  return {
    schemaVersion: STARTUP_TRANSACTION_SCHEMA_V2,
    version: 2,
    workspaceId: resolveWorkspaceProcessId(canonicalWorkspaceRoot),
    canonicalWorkspaceRoot,
    ...value,
    servicesRoot: path.resolve(value.servicesRoot),
    workspaceRoot: canonicalWorkspaceRoot,
  };
}

function journalPayload(value: Record<string, unknown>): Omit<
  StartupTransactionJournal,
  "schemaVersion" | "version" | "workspaceId" | "canonicalWorkspaceRoot"
> | null {
  if (!isPhase(value.phase) || !isStatus(value.status)) return null;
  if (
    typeof value.transactionId !== "string" || !value.transactionId
    || typeof value.generationId !== "string" || !value.generationId
    || typeof value.instanceId !== "string" || !value.instanceId
    || typeof value.servicesRoot !== "string" || !value.servicesRoot
    || typeof value.workspaceRoot !== "string" || !value.workspaceRoot
    || typeof value.startedAt !== "string" || !value.startedAt
    || typeof value.updatedAt !== "string" || !value.updatedAt
  ) {
    return null;
  }
  return {
    transactionId: value.transactionId,
    generationId: value.generationId,
    instanceId: value.instanceId,
    servicesRoot: path.resolve(value.servicesRoot),
    workspaceRoot: path.resolve(value.workspaceRoot),
    status: value.status,
    phase: value.phase,
    startedAt: value.startedAt,
    updatedAt: value.updatedAt,
    finishedAt: typeof value.finishedAt === "string" ? value.finishedAt : null,
    allocationRevision: typeof value.allocationRevision === "string" ? value.allocationRevision : null,
    completedActions: strings(value.completedActions),
    pendingCompensations: strings(value.pendingCompensations),
    startedServiceIds: strings(value.startedServiceIds),
    materializationDigests: digests(value.materializationDigests),
    failureCode: typeof value.failureCode === "string" ? value.failureCode : null,
    recoveredFromTransactionId: typeof value.recoveredFromTransactionId === "string"
      ? value.recoveredFromTransactionId
      : null,
  };
}

function parseCurrentJournal(workspaceRoot: string, value: unknown): StartupTransactionJournal | null {
  const canonicalWorkspaceRoot = path.resolve(workspaceRoot);
  if (
    !isRecord(value)
    || value.schemaVersion !== STARTUP_TRANSACTION_SCHEMA_V2
    || value.version !== 2
    || typeof value.workspaceId !== "string"
    || value.workspaceId !== resolveWorkspaceProcessId(canonicalWorkspaceRoot)
    || typeof value.canonicalWorkspaceRoot !== "string"
    || !samePath(value.canonicalWorkspaceRoot, canonicalWorkspaceRoot)
  ) {
    return null;
  }
  const payload = journalPayload(value);
  if (!payload || !samePath(payload.workspaceRoot, workspaceRoot)) return null;
  return wrapJournal(workspaceRoot, payload);
}

function parseLegacyJournal(workspaceRoot: string, value: unknown): StartupTransactionJournal | null {
  if (!isRecord(value) || value.version !== 1) return null;
  const payload = journalPayload(value);
  if (!payload || !samePath(payload.workspaceRoot, workspaceRoot)) return null;
  return wrapJournal(workspaceRoot, payload);
}

async function atomicWriteJournal(journal: StartupTransactionJournal): Promise<void> {
  const canonical = wrapJournal(journal.workspaceRoot, journal);
  await writeLifecycleDocument(journal.workspaceRoot, STARTUP_TRANSACTION_POLICY, canonical, {
    parseCurrent: (value) => parseCurrentJournal(journal.workspaceRoot, value),
    parseLegacy: (value) => parseLegacyJournal(journal.workspaceRoot, value),
    serialize: (document) => document,
  });
}

export async function readStartupTransactionJournal(workspaceRoot: string): Promise<StartupTransactionJournal | null> {
  const result = await readLifecycleDocument(workspaceRoot, STARTUP_TRANSACTION_POLICY, {
    parseCurrent: (value) => parseCurrentJournal(workspaceRoot, value),
    parseLegacy: (value) => parseLegacyJournal(workspaceRoot, value),
  });
  return result.document;
}

export async function beginStartupTransaction(input: {
  generationId: string;
  instanceId: string;
  servicesRoot: string;
  workspaceRoot: string;
  recoveredFromTransactionId?: string | null;
  now?: Date;
}): Promise<StartupTransactionJournal> {
  const prior = await readStartupTransactionJournal(input.workspaceRoot);
  if (prior && (prior.status === "active" || prior.status === "blocked")) {
    throw new StartupTransactionRecoveryRequiredError(prior);
  }
  const now = (input.now ?? new Date()).toISOString();
  const journal: StartupTransactionJournal = wrapJournal(input.workspaceRoot, {
    transactionId: randomUUID(),
    generationId: input.generationId,
    instanceId: input.instanceId,
    servicesRoot: path.resolve(input.servicesRoot),
    workspaceRoot: path.resolve(input.workspaceRoot),
    status: "active",
    phase: "preflight_reconciliation",
    startedAt: now,
    updatedAt: now,
    finishedAt: null,
    allocationRevision: null,
    completedActions: ["preflight_reconciliation"],
    pendingCompensations: [],
    startedServiceIds: [],
    materializationDigests: {},
    failureCode: null,
    recoveredFromTransactionId: input.recoveredFromTransactionId ?? null,
  });
  await atomicWriteJournal(journal);
  return journal;
}

export async function activateStartupTransactionRecovery(
  journal: StartupTransactionJournal,
  action: "resume" | "rollback",
  now = new Date(),
): Promise<StartupTransactionJournal> {
  if (journal.status !== "active" && journal.status !== "blocked") {
    throw new Error(`Cannot recover ${journal.status} startup transaction.`);
  }
  const timestamp = now.toISOString();
  const next: StartupTransactionJournal = {
    ...journal,
    status: "active",
    updatedAt: timestamp,
    finishedAt: null,
    failureCode: action === "resume" ? null : journal.failureCode,
    completedActions: unique([...journal.completedActions, `recovery_${action}_started`]),
  };
  await atomicWriteJournal(next);
  return next;
}

function applyUpdate(
  journal: StartupTransactionJournal,
  update: StartupTransactionUpdate,
  now: string,
): StartupTransactionJournal {
  const removed = new Set(update.removeCompensations ?? []);
  return {
    ...journal,
    updatedAt: now,
    allocationRevision: update.allocationRevision === undefined ? journal.allocationRevision : update.allocationRevision,
    completedActions: unique([...journal.completedActions, ...(update.completedActions ?? [])]),
    pendingCompensations: unique([
      ...journal.pendingCompensations.filter((action) => !removed.has(action)),
      ...(update.addCompensations ?? []),
    ]),
    startedServiceIds: unique([...journal.startedServiceIds, ...(update.startedServiceIds ?? [])]),
    materializationDigests: {
      ...journal.materializationDigests,
      ...(update.materializationDigests ?? {}),
    },
    failureCode: update.failureCode === undefined ? journal.failureCode : update.failureCode,
  };
}

export async function advanceStartupTransaction(
  journal: StartupTransactionJournal,
  phase: StartupTransactionPhase,
  update: StartupTransactionUpdate = {},
  now = new Date(),
): Promise<StartupTransactionJournal> {
  if (journal.status !== "active") throw new Error(`Cannot advance ${journal.status} startup transaction.`);
  if (STARTUP_TRANSACTION_PHASES.indexOf(phase) < STARTUP_TRANSACTION_PHASES.indexOf(journal.phase)) {
    throw new Error(`Cannot move startup transaction backward from ${journal.phase} to ${phase}.`);
  }
  const next = applyUpdate({ ...journal, phase }, update, now.toISOString());
  await atomicWriteJournal(next);
  return next;
}

export async function settleStartupTransaction(
  journal: StartupTransactionJournal,
  status: Exclude<StartupTransactionStatus, "active">,
  update: StartupTransactionUpdate = {},
  now = new Date(),
): Promise<StartupTransactionJournal> {
  const timestamp = now.toISOString();
  const next = applyUpdate({ ...journal, status, finishedAt: timestamp }, update, timestamp);
  if ((status === "committed" || status === "rolled_back") && next.pendingCompensations.length > 0) {
    throw new Error(`Cannot seal startup transaction ${status} with pending compensations.`);
  }
  await atomicWriteJournal(next);
  return next;
}
