import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";

export const OPERATOR_ACTION_QUEUE_LIMIT = 500;

export type OperatorActionSourceKind =
  | "update"
  | "recovery"
  | "diagnostic"
  | "blocked_start"
  | "failed_check"
  | "config_drift"
  | "manual";

export type OperatorActionSeverity = "info" | "warning" | "critical";
export type OperatorActionStatus = "open" | "acknowledged" | "deferred";

export interface OperatorActionSource {
  kind: OperatorActionSourceKind;
  serviceId: string | null;
  reference: string | null;
}

export interface OperatorActionEvidence {
  label: string;
  value: string;
}

export interface OperatorActionItem {
  id: string;
  dedupeKey: string;
  status: OperatorActionStatus;
  severity: OperatorActionSeverity;
  source: OperatorActionSource;
  title: string;
  summary: string;
  evidence: OperatorActionEvidence[];
  createdAt: string;
  updatedAt: string;
  firstSeenAt: string;
  lastSeenAt: string;
  acknowledgedAt: string | null;
  deferredUntil: string | null;
  reopenedAt: string | null;
}

export interface OperatorActionQueueState {
  updatedAt: string;
  items: OperatorActionItem[];
}

export interface OperatorActionInput {
  dedupeKey: string;
  severity: OperatorActionSeverity;
  source: OperatorActionSource;
  title: string;
  summary: string;
  evidence?: OperatorActionEvidence[];
  observedAt?: string;
}

export interface OperatorActionMutationInput {
  now?: string;
  deferredUntil?: string | null;
}

const queueWriteQueues = new Map<string, Promise<void>>();

function nowIso(): string {
  return new Date().toISOString();
}

function queuePath(workspaceRoot: string): string {
  return path.join(workspaceRoot, ".state", "operator-actions.json");
}

function stableIdFromDedupeKey(dedupeKey: string): string {
  const normalized = dedupeKey
    .toLowerCase()
    .replace(/[^a-z0-9_.:-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
  return normalized ? "action-" + normalized : "action-unknown";
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function isSeverity(value: unknown): value is OperatorActionSeverity {
  return value === "info" || value === "warning" || value === "critical";
}

function isStatus(value: unknown): value is OperatorActionStatus {
  return value === "open" || value === "acknowledged" || value === "deferred";
}

function isSourceKind(value: unknown): value is OperatorActionSourceKind {
  return (
    value === "update" ||
    value === "recovery" ||
    value === "diagnostic" ||
    value === "blocked_start" ||
    value === "failed_check" ||
    value === "config_drift" ||
    value === "manual"
  );
}

function sanitizeText(value: string): string {
  return value
    .replace(/([\w.-]*(?:password|passwd|secret|token|key|credential)[\w.-]*\s*[:=]\s*)[^\s,;]+/gi, "$1[redacted]")
    .replace(/(bearer\s+)[A-Za-z0-9._~+/=-]+/gi, "$1[redacted]")
    .replace(/(gh[pousr]_[A-Za-z0-9_]+)/g, "[redacted]")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeEvidence(value: unknown): OperatorActionEvidence[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return [];
    }

    const record = entry as Record<string, unknown>;
    const label = sanitizeText(stringOr(record.label, ""));
    const evidenceValue = sanitizeText(stringOr(record.value, ""));
    if (!label || !evidenceValue) {
      return [];
    }

    return [{ label, value: evidenceValue }];
  });
}

function normalizeSource(value: unknown): OperatorActionSource {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { kind: "manual", serviceId: null, reference: null };
  }

  const record = value as Record<string, unknown>;
  return {
    kind: isSourceKind(record.kind) ? record.kind : "manual",
    serviceId: stringOrNull(record.serviceId),
    reference: stringOrNull(record.reference),
  };
}

function normalizeItem(value: unknown): OperatorActionItem | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const dedupeKey = sanitizeText(stringOr(record.dedupeKey, ""));
  if (!dedupeKey) {
    return null;
  }

  const observedAt = stringOr(record.updatedAt, nowIso());
  return {
    id: stringOr(record.id, stableIdFromDedupeKey(dedupeKey)),
    dedupeKey,
    status: isStatus(record.status) ? record.status : "open",
    severity: isSeverity(record.severity) ? record.severity : "warning",
    source: normalizeSource(record.source),
    title: sanitizeText(stringOr(record.title, "Operator action required")),
    summary: sanitizeText(stringOr(record.summary, "")),
    evidence: normalizeEvidence(record.evidence),
    createdAt: stringOr(record.createdAt, observedAt),
    updatedAt: observedAt,
    firstSeenAt: stringOr(record.firstSeenAt, observedAt),
    lastSeenAt: stringOr(record.lastSeenAt, observedAt),
    acknowledgedAt: stringOrNull(record.acknowledgedAt),
    deferredUntil: stringOrNull(record.deferredUntil),
    reopenedAt: stringOrNull(record.reopenedAt),
  };
}

export function normalizeOperatorActionQueueState(input: unknown): OperatorActionQueueState {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { updatedAt: nowIso(), items: [] };
  }

  const record = input as Record<string, unknown>;
  return {
    updatedAt: stringOr(record.updatedAt, nowIso()),
    items: Array.isArray(record.items)
      ? record.items.flatMap((entry) => {
          const item = normalizeItem(entry);
          return item ? [item] : [];
        })
      : [],
  };
}

export async function readOperatorActionQueue(workspaceRoot: string): Promise<OperatorActionQueueState> {
  try {
    return normalizeOperatorActionQueueState(JSON.parse(await readFile(queuePath(workspaceRoot), "utf8")) as unknown);
  } catch {
    return normalizeOperatorActionQueueState(null);
  }
}

async function writeOperatorActionQueueWithoutQueue(
  workspaceRoot: string,
  state: OperatorActionQueueState,
): Promise<OperatorActionQueueState> {
  const updatedAt = state.updatedAt || nowIso();
  const nextState = {
    updatedAt,
    items: state.items
      .map((item) => normalizeItem(item))
      .flatMap((item) => item ? [item] : [])
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, OPERATOR_ACTION_QUEUE_LIMIT),
  };

  const filePath = queuePath(workspaceRoot);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(nextState, null, 2));

  return nextState;
}

async function withQueueLock<T>(filePath: string, operation: () => Promise<T>): Promise<T> {
  const previous = queueWriteQueues.get(filePath) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(operation);
  const settled = next.then(() => undefined, () => undefined);
  queueWriteQueues.set(filePath, settled);

  try {
    return await next;
  } finally {
    if (queueWriteQueues.get(filePath) === settled) {
      queueWriteQueues.delete(filePath);
    }
  }
}

export async function writeOperatorActionQueue(
  workspaceRoot: string,
  state: OperatorActionQueueState,
): Promise<OperatorActionQueueState> {
  const filePath = queuePath(workspaceRoot);
  return await withQueueLock(filePath, () => writeOperatorActionQueueWithoutQueue(workspaceRoot, state));
}

export async function upsertOperatorActionItem(
  workspaceRoot: string,
  input: OperatorActionInput,
): Promise<OperatorActionQueueState> {
  const filePath = queuePath(workspaceRoot);
  return await withQueueLock(filePath, async () => {
    const existing = await readOperatorActionQueue(workspaceRoot);
    const observedAt = input.observedAt ?? nowIso();
    const dedupeKey = sanitizeText(input.dedupeKey);
    const existingItem = existing.items.find((item) => item.dedupeKey === dedupeKey);
    const nextItem: OperatorActionItem = {
      id: existingItem?.id ?? stableIdFromDedupeKey(dedupeKey),
      dedupeKey,
      status: existingItem?.status === "acknowledged" ? "open" : (existingItem?.status ?? "open"),
      severity: input.severity,
      source: input.source,
      title: sanitizeText(input.title),
      summary: sanitizeText(input.summary),
      evidence: normalizeEvidence(input.evidence ?? []),
      createdAt: existingItem?.createdAt ?? observedAt,
      updatedAt: observedAt,
      firstSeenAt: existingItem?.firstSeenAt ?? observedAt,
      lastSeenAt: observedAt,
      acknowledgedAt: existingItem?.status === "acknowledged" ? null : (existingItem?.acknowledgedAt ?? null),
      deferredUntil: existingItem?.status === "deferred" ? existingItem.deferredUntil : null,
      reopenedAt: existingItem?.status === "acknowledged" ? observedAt : (existingItem?.reopenedAt ?? null),
    };

    return await writeOperatorActionQueueWithoutQueue(workspaceRoot, {
      updatedAt: observedAt,
      items: [nextItem, ...existing.items.filter((item) => item.id !== nextItem.id)],
    });
  });
}

export async function mutateOperatorActionItem(
  workspaceRoot: string,
  itemId: string,
  action: "acknowledge" | "defer" | "reopen",
  input: OperatorActionMutationInput = {},
): Promise<OperatorActionQueueState> {
  const filePath = queuePath(workspaceRoot);
  return await withQueueLock(filePath, async () => {
    const existing = await readOperatorActionQueue(workspaceRoot);
    const now = input.now ?? nowIso();
    let found = false;
    const items = existing.items.map((item) => {
      if (item.id !== itemId) {
        return item;
      }

      found = true;
      if (action === "acknowledge") {
        return {
          ...item,
          status: "acknowledged" as const,
          updatedAt: now,
          acknowledgedAt: now,
          deferredUntil: null,
        };
      }

      if (action === "defer") {
        return {
          ...item,
          status: "deferred" as const,
          updatedAt: now,
          deferredUntil: input.deferredUntil ?? null,
        };
      }

      return {
        ...item,
        status: "open" as const,
        updatedAt: now,
        acknowledgedAt: null,
        deferredUntil: null,
        reopenedAt: now,
      };
    });

    if (!found) {
      throw new Error("Unknown operator action id: " + itemId + ".");
    }

    return await writeOperatorActionQueueWithoutQueue(workspaceRoot, {
      updatedAt: now,
      items,
    });
  });
}

