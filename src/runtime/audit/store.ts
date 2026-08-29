import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { appendFile, mkdir, readFile, readdir } from "node:fs/promises";
import type {
  AuditChainStatus,
  AuditEvent,
  AuditEventOutcome,
  AuditQuery,
  AuditResponse,
  AuditSafeMetadataValue,
} from "../../contracts/api.js";
import { assertSafeAuditMetadata } from "./events.js";
import { withCrossProcessFileLock } from "../security/cross-process-file-lock.js";

export interface AppendAuditEventInput {
  /** Optional deterministic identifier for idempotent terminal/outbox replay. */
  eventId?: string;
  /** Internal clock override used by deterministic store tests. */
  now?: () => Date;
  workspaceRoot?: string;
  serviceRoot?: string;
  source: string;
  action: string;
  actor?: string;
  subject?: string;
  serviceId?: string;
  method?: string;
  routeTemplate?: string;
  outcome: AuditEventOutcome;
  statusCode: number;
  summary: string;
  reason?: string | null;
  correlationId?: string | null;
  relatedRevisionId?: string | null;
  metadata?: Record<string, AuditSafeMetadataValue>;
}

export interface ReadAuditEventsInput {
  workspaceRoot?: string;
  serviceRoots?: string[];
  query?: AuditQuery;
}

const defaultLimit = 100;
const maxLimit = 500;
const auditAppendQueues = new Map<string, Promise<void>>();

type AuditEventChainStatus = AuditEvent["chainStatus"];

export interface AuditChainVerificationResult {
  filePath: string;
  chainStatus: AuditEventChainStatus;
  events: AuditEvent[];
  brokenAtSequence?: number;
  reason?: string;
}

function auditDateSegment(timestamp: string): string {
  return timestamp.slice(0, 10);
}

function getRuntimeAuditDir(workspaceRoot: string): string {
  return path.join(workspaceRoot, ".service-lasso", "audit", "runtime");
}

function getServiceAuditDir(serviceRoot: string): string {
  return path.join(serviceRoot, ".state", "audit");
}

function stableCanonicalValue(input: unknown): unknown {
  if (input === null || typeof input !== "object") {
    return input;
  }

  if (Array.isArray(input)) {
    return input.map((item) => stableCanonicalValue(item));
  }

  return Object.fromEntries(
    Object.entries(input as Record<string, unknown>)
      .filter(([, value]) => value !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => [key, stableCanonicalValue(value)]),
  );
}

function stableHash(input: unknown): string {
  return createHash("sha256").update(JSON.stringify(stableCanonicalValue(input)), "utf8").digest("hex");
}

function auditEventHashPayload(event: AuditEvent, previousHash: string | null): Record<string, unknown> {
  const { eventHash: _eventHash, chainStatus: _chainStatus, ...safeEvent } = event;
  return {
    ...safeEvent,
    previousHash,
  };
}

function computeAuditEventHash(event: AuditEvent, previousHash: string | null): string {
  return stableHash(auditEventHashPayload(event, previousHash));
}

function parseJsonl(content: string): AuditEvent[] {
  return content
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as AuditEvent];
      } catch {
        return [];
      }
    });
}

async function readAuditFile(filePath: string): Promise<AuditEvent[]> {
  const content = await readFile(filePath, "utf8").catch((error: unknown) => {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return "";
    }
    throw error;
  });

  return parseJsonl(content);
}

async function listAuditFiles(auditDir: string): Promise<string[]> {
  const entries = await readdir(auditDir, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
    .sort((left, right) => {
      if (left.name === "events.jsonl") return -1;
      if (right.name === "events.jsonl") return 1;
      return left.name.localeCompare(right.name);
    })
    .map((entry) => path.join(auditDir, entry.name));
}

async function readAuditDir(auditDir: string): Promise<AuditEvent[]> {
  const files = await listAuditFiles(auditDir);
  return (await Promise.all(files.map(async (filePath) => readAuditFile(filePath)))).flat();
}

async function verifyAuditFiles(filePaths: string[]): Promise<AuditChainVerificationResult> {
  const filePath = filePaths.join(path.delimiter);
  const events: AuditEvent[] = [];
  let previousHash: string | null = null;
  let chainId: string | null = null;
  let expectedSequence = 1;

  for (const currentFilePath of filePaths) {
    const content = await readFile(currentFilePath, "utf8").catch((error: unknown) => {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
        return "";
      }
      throw error;
    });
    const lines = content
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter(Boolean);

    for (const line of lines) {
      let event: AuditEvent;
      try {
        event = JSON.parse(line) as AuditEvent;
      } catch {
        return {
          filePath,
          chainStatus: "broken",
          events,
          brokenAtSequence: expectedSequence,
          reason: "invalid-jsonl",
        };
      }
      events.push(event);

      if (!event.chainId || typeof event.sequence !== "number" || !event.eventHash) {
        return {
          filePath,
          chainStatus: "unavailable",
          events,
          brokenAtSequence: expectedSequence,
          reason: "missing-chain-metadata",
        };
      }

      if (chainId === null) {
        chainId = event.chainId;
      }

      if (event.chainId !== chainId || event.sequence !== expectedSequence || event.previousHash !== previousHash) {
        return {
          filePath,
          chainStatus: "broken",
          events,
          brokenAtSequence: expectedSequence,
          reason: "chain-link-mismatch",
        };
      }

      if (event.eventHash !== computeAuditEventHash(event, previousHash)) {
        return {
          filePath,
          chainStatus: "broken",
          events,
          brokenAtSequence: expectedSequence,
          reason: "event-hash-mismatch",
        };
      }

      previousHash = event.eventHash;
      expectedSequence += 1;
    }
  }

  if (events.length === 0) {
    return {
      filePath,
      chainStatus: "unavailable",
      events,
      reason: "empty",
    };
  }

  return {
    filePath,
    chainStatus: "verified",
    events,
  };
}

export async function verifyAuditFile(filePath: string): Promise<AuditChainVerificationResult> {
  return verifyAuditFiles([filePath]);
}

async function appendAuditLine(auditDir: string, event: AuditEvent): Promise<AuditEvent> {
  const previousQueue = auditAppendQueues.get(auditDir) ?? Promise.resolve();
  const operation = previousQueue.catch(() => undefined).then(async () => {
    return await withCrossProcessFileLock(
      path.join(auditDir, ".append.lock"),
      async () => {
        const files = await listAuditFiles(auditDir);
        const existing = (await Promise.all(files.map(async (filePath) => readAuditFile(filePath)))).flat();
        const duplicate = existing.find((candidate) => candidate.id === event.id);
        if (duplicate) return duplicate;
        const previous = existing.at(-1);
        const sequence = typeof previous?.sequence === "number" ? previous.sequence + 1 : 1;
        const previousHash = previous?.eventHash || null;
        const eventWithoutHash = {
          ...event,
          sequence,
          previousHash,
          chainStatus: "verified" as const,
        };
        const eventHash = computeAuditEventHash(eventWithoutHash, previousHash);
        const nextEvent: AuditEvent = {
          ...eventWithoutHash,
          eventHash,
        };

        const requestedBucket = auditDateSegment(event.timestamp);
        const latestBucket = files
          .map((existingPath) => path.basename(existingPath))
          .filter((name) => /^\d{4}-\d{2}-\d{2}\.jsonl$/u.test(name))
          .map((name) => name.slice(0, 10))
          .at(-1);
        const appendBucket = latestBucket && latestBucket > requestedBucket ? latestBucket : requestedBucket;
        const filePath = path.join(auditDir, `${appendBucket}.jsonl`);
        await mkdir(path.dirname(filePath), { recursive: true });
        await appendFile(filePath, `${JSON.stringify(nextEvent)}\n`, "utf8");
        return nextEvent;
      },
      { unavailableMessage: "Durable Audit append lock is unavailable." },
    );
  });
  const settled = operation.then(() => undefined, () => undefined);
  auditAppendQueues.set(auditDir, settled);

  try {
    return await operation;
  } finally {
    if (auditAppendQueues.get(auditDir) === settled) {
      auditAppendQueues.delete(auditDir);
    }
  }
}

export async function appendAuditEvent(input: AppendAuditEventInput): Promise<AuditEvent> {
  if (input.metadata) {
    assertSafeAuditMetadata(input.metadata);
  }

  if (input.eventId !== undefined && !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u.test(input.eventId)) {
    throw new Error("Audit eventId must be a bounded safe identifier.");
  }
  const timestamp = (input.now?.() ?? new Date()).toISOString();
  const target =
    input.serviceRoot && input.serviceId
      ? {
          auditDir: getServiceAuditDir(input.serviceRoot),
          chainId: `service:${input.serviceId}`,
        }
      : input.workspaceRoot
        ? {
            auditDir: getRuntimeAuditDir(input.workspaceRoot),
            chainId: "runtime",
          }
        : null;
  const event: AuditEvent = {
    id: input.eventId ?? randomUUID(),
    timestamp,
    source: input.source,
    action: input.action,
    actor: input.actor?.trim() || "unknown",
    subject: input.subject,
    serviceId: input.serviceId,
    method: input.method,
    routeTemplate: input.routeTemplate,
    outcome: input.outcome,
    statusCode: input.statusCode,
    summary: input.summary,
    reason: input.reason ?? null,
    correlationId: input.correlationId ?? randomUUID(),
    relatedRevisionId: input.relatedRevisionId ?? null,
    metadata: input.metadata,
    chainId: target?.chainId ?? "runtime",
    sequence: 0,
    previousHash: null,
    eventHash: "",
    chainStatus: "verified",
  };
  if (!target) {
    return event;
  }

  return appendAuditLine(target.auditDir, event);
}

function normalizeLimit(value: string | undefined): number {
  const parsed = value ? Number(value) : defaultLimit;
  if (!Number.isFinite(parsed) || parsed < 1) return defaultLimit;
  return Math.min(Math.trunc(parsed), maxLimit);
}

function normalizeCursor(value: string | undefined): number {
  const parsed = value ? Number(value) : 0;
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.trunc(parsed);
}

function matchesQuery(event: AuditEvent, query: AuditQuery): boolean {
  if (query.serviceId && event.serviceId !== query.serviceId) return false;
  if (query.actor && event.actor !== query.actor) return false;
  if (query.action && event.action !== query.action) return false;
  if (query.outcome && event.outcome !== query.outcome) return false;
  if (query.subjectType && (event as AuditEvent & { subjectType?: string }).subjectType !== query.subjectType) return false;
  if (query.source && event.source !== query.source) return false;
  if (query.since && event.timestamp < query.since) return false;
  if (query.until && event.timestamp > query.until) return false;

  if (query.query) {
    const needle = query.query.toLowerCase();
    const haystack = [
      event.id,
      event.source,
      event.action,
      event.actor,
      event.subject,
      event.serviceId,
      event.method,
      event.routeTemplate,
      event.summary,
      event.reason,
      event.relatedRevisionId,
    ]
      .filter((value): value is string => typeof value === "string")
      .join(" ")
      .toLowerCase();
    return haystack.includes(needle);
  }

  return true;
}

function getVerificationChainStatus(results: AuditChainVerificationResult[]): AuditChainStatus {
  if (results.length === 0) return "unavailable";
  const statuses = new Set(results.map((result) => result.chainStatus));
  return statuses.size === 1 ? [...statuses][0] : "mixed";
}

export async function readAuditEvents(input: ReadAuditEventsInput): Promise<AuditResponse> {
  const query = input.query ?? {};
  const limit = normalizeLimit(query.limit);
  const cursor = normalizeCursor(query.cursor);
  const auditDirs: string[] = [];

  if (input.workspaceRoot) {
    auditDirs.push(getRuntimeAuditDir(input.workspaceRoot));
  }

  for (const serviceRoot of input.serviceRoots ?? []) {
    auditDirs.push(getServiceAuditDir(serviceRoot));
  }

  const fileGroups = await Promise.all(auditDirs.map(async (auditDir) => listAuditFiles(auditDir)));
  const verificationResults = await Promise.all(
    fileGroups.filter((filePaths) => filePaths.length > 0).map(async (filePaths) => verifyAuditFiles(filePaths)),
  );
  const events = verificationResults
    .flatMap((result) => result.events.map((event) => ({ ...event, chainStatus: result.chainStatus })))
    .filter((event) => matchesQuery(event, query))
    .sort((left, right) =>
      right.timestamp.localeCompare(left.timestamp) ||
      right.sequence - left.sequence ||
      right.id.localeCompare(left.id),
    );
  const page = events.slice(cursor, cursor + limit);
  const nextCursor = cursor + page.length < events.length ? String(cursor + page.length) : null;

  return {
    events: page,
    nextCursor,
    source: "runtime-audit",
    chainStatus: getVerificationChainStatus(verificationResults),
    rawMaterialReturned: false,
    pagination: {
      limit,
      nextCursor,
      total: events.length,
    },
  };
}
