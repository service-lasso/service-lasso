import { randomUUID } from "node:crypto";
import {
  AUDIT_EVENT_CONTRACT_VERSION,
  AUDIT_EVENT_KIND,
  type AuditEvent,
  type AuditEventInput,
  type AuditSafeMetadataValue,
} from "../../contracts/audit.js";

const UNSAFE_AUDIT_FIELD_NAMES = new Set([
  "password",
  "token",
  "secret",
  "authorization",
  "cookie",
  "privatekey",
  "body",
  "raw",
]);

export function createAuditEventId(prefix = "audit"): string {
  const safePrefix = prefix.replace(/[^a-z0-9-]/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || "audit";
  return `${safePrefix}_${randomUUID()}`;
}

export function createAuditTimestamp(now = new Date()): string {
  return now.toISOString();
}

export function createAuditSummary(parts: Array<string | number | boolean | null | undefined>, maxLength = 240): string {
  const summary = parts
    .filter((part) => part !== undefined && part !== null && String(part).trim().length > 0)
    .map((part) => String(part).replace(/\s+/g, " ").trim())
    .join(" ")
    .slice(0, maxLength)
    .trim();

  if (!summary) {
    throw new Error("Audit summary must not be empty.");
  }

  return summary;
}

export function buildAuditEvent(input: AuditEventInput): AuditEvent {
  assertNoUnsafeAuditKeys(input, "audit event");
  if (input.metadata) {
    assertSafeAuditMetadata(input.metadata);
  }

  return {
    contractVersion: AUDIT_EVENT_CONTRACT_VERSION,
    kind: AUDIT_EVENT_KIND,
    id: input.id ?? createAuditEventId(input.source),
    timestamp: input.timestamp ?? createAuditTimestamp(),
    source: input.source,
    actor: input.actor,
    action: input.action,
    outcome: input.outcome,
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    serviceId: input.serviceId,
    routeTemplate: input.routeTemplate,
    method: input.method,
    statusCode: input.statusCode,
    summary: input.summary,
    reason: input.reason,
    correlationId: input.correlationId,
    traceId: input.traceId,
    relatedRevisionId: input.relatedRevisionId,
    metadata: input.metadata,
    chainId: input.chainId,
    sequence: input.sequence,
    previousHash: input.previousHash,
    eventHash: input.eventHash,
    chainStatus: input.chainStatus,
  };
}

export function assertSafeAuditMetadata(metadata: Record<string, AuditSafeMetadataValue>): void {
  assertNoUnsafeAuditKeys(metadata, "audit metadata");
}

function assertNoUnsafeAuditKeys(value: unknown, context: string): void {
  if (value === null || typeof value !== "object") {
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoUnsafeAuditKeys(item, `${context}[${index}]`));
    return;
  }

  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    const normalized = key.replace(/[^a-z0-9]/gi, "").toLowerCase();
    if (UNSAFE_AUDIT_FIELD_NAMES.has(normalized)) {
      throw new Error(`Unsafe audit field "${key}" is not allowed in ${context}. Store safe metadata instead.`);
    }
    assertNoUnsafeAuditKeys(nested, `${context}.${key}`);
  }
}
