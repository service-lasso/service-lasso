import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import type { AuditEvent, AuditEventOutcome, AuditQuery, AuditResponse, AuditSafeMetadataValue } from "../../contracts/api.js";
import { assertSafeAuditMetadata } from "./events.js";

export interface AppendAuditEventInput {
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

function auditDateSegment(timestamp: string): string {
  return timestamp.slice(0, 10);
}

function getRuntimeAuditPath(workspaceRoot: string, timestamp: string): string {
  return path.join(workspaceRoot, ".service-lasso", "audit", "runtime", `${auditDateSegment(timestamp)}.jsonl`);
}

function getRuntimeAuditDir(workspaceRoot: string): string {
  return path.join(workspaceRoot, ".service-lasso", "audit", "runtime");
}

function getServiceAuditPath(serviceRoot: string): string {
  return path.join(serviceRoot, ".state", "audit", "events.jsonl");
}

function stableHash(input: unknown): string {
  return createHash("sha256").update(JSON.stringify(input), "utf8").digest("hex");
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

async function appendAuditLine(filePath: string, event: AuditEvent): Promise<void> {
  const existing = await readAuditFile(filePath);
  const previous = existing.at(-1);
  const sequence = previous ? previous.sequence + 1 : 1;
  const previousHash = previous?.eventHash ?? null;
  const eventWithoutHash = {
    ...event,
    sequence,
    previousHash,
    eventHash: "",
  };
  const eventHash = stableHash(eventWithoutHash);
  const nextEvent: AuditEvent = {
    ...eventWithoutHash,
    eventHash,
  };

  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${existing.map((entry) => JSON.stringify(entry)).join("\n")}${existing.length > 0 ? "\n" : ""}${JSON.stringify(nextEvent)}\n`);
}

export async function appendAuditEvent(input: AppendAuditEventInput): Promise<AuditEvent> {
  if (input.metadata) {
    assertSafeAuditMetadata(input.metadata);
  }

  const timestamp = new Date().toISOString();
  const chainId = input.serviceId ? `service:${input.serviceId}` : "runtime";
  const event: AuditEvent = {
    id: randomUUID(),
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
    chainId,
    sequence: 0,
    previousHash: null,
    eventHash: "",
    chainStatus: "valid",
  };
  const filePath =
    input.serviceRoot && input.serviceId
      ? getServiceAuditPath(input.serviceRoot)
      : input.workspaceRoot
        ? getRuntimeAuditPath(input.workspaceRoot, timestamp)
        : null;

  if (!filePath) {
    return event;
  }

  await appendAuditLine(filePath, event);
  const [persisted] = (await readAuditFile(filePath)).slice(-1);
  return persisted ?? event;
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

export async function readAuditEvents(input: ReadAuditEventsInput): Promise<AuditResponse> {
  const query = input.query ?? {};
  const limit = normalizeLimit(query.limit);
  const cursor = normalizeCursor(query.cursor);
  const files: string[] = [];

  if (input.workspaceRoot) {
    const runtimeAuditDir = getRuntimeAuditDir(input.workspaceRoot);
    const entries = await readdir(runtimeAuditDir, { withFileTypes: true }).catch(() => []);
    files.push(
      ...entries
        .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
        .map((entry) => path.join(runtimeAuditDir, entry.name)),
    );
  }

  for (const serviceRoot of input.serviceRoots ?? []) {
    files.push(getServiceAuditPath(serviceRoot));
  }

  const events = (
    await Promise.all(files.map(async (filePath) => readAuditFile(filePath)))
  )
    .flat()
    .filter((event) => matchesQuery(event, query))
    .sort((left, right) => right.timestamp.localeCompare(left.timestamp));
  const page = events.slice(cursor, cursor + limit);
  const nextCursor = cursor + page.length < events.length ? String(cursor + page.length) : null;

  return {
    events: page,
    pagination: {
      limit,
      nextCursor,
      total: events.length,
    },
  };
}
