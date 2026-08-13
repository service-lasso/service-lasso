import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";

export const OPERATOR_INBOX_LIMIT = 1000;

export type OperatorInboxType =
  | "system"
  | "workflow"
  | "service"
  | "update"
  | "security"
  | "help"
  | "error";

export type OperatorInboxSeverity = "info" | "success" | "warning" | "error" | "critical";
export type OperatorInboxSource = "runtime" | "service" | "workflow" | "updater" | "broker" | "admin-ui" | "system";
export type OperatorInboxState = "unread" | "read";
export type OperatorInboxVisibility = "visible" | "hidden";
export type OperatorInboxActionKind = "link" | "api" | "command";
export type OperatorInboxActionAvailability = "available" | "disabled" | "expired";
export type OperatorInboxFilter =
  | "all"
  | "unread"
  | "updates"
  | "system"
  | "workflow"
  | "service"
  | "errors"
  | "hidden";

export interface OperatorInboxRelatedTarget {
  serviceId?: string;
  workflowId?: string;
  updateId?: string;
  auditId?: string;
  backupExportId?: string;
  route?: string;
}

export interface OperatorInboxActionMetadata {
  label: string;
  target: string;
  kind: OperatorInboxActionKind;
  availability: OperatorInboxActionAvailability;
}

export interface OperatorInboxItem {
  id: string;
  dedupeKey: string;
  title: string;
  summary: string;
  details: string | null;
  type: OperatorInboxType;
  severity: OperatorInboxSeverity;
  source: OperatorInboxSource;
  state: OperatorInboxState;
  visibility: OperatorInboxVisibility;
  createdAt: string;
  updatedAt: string;
  readAt: string | null;
  hiddenAt: string | null;
  relatedTarget: OperatorInboxRelatedTarget | null;
  action: OperatorInboxActionMetadata | null;
}

export interface OperatorInboxStateFile {
  updatedAt: string;
  items: OperatorInboxItem[];
}

export interface OperatorInboxInput {
  dedupeKey: string;
  title: string;
  summary: string;
  details?: string | null;
  type: OperatorInboxType;
  severity: OperatorInboxSeverity;
  source: OperatorInboxSource;
  relatedTarget?: OperatorInboxRelatedTarget | null;
  action?: OperatorInboxActionMetadata | null;
  observedAt?: string;
}

export interface OperatorInboxQuery {
  filter?: OperatorInboxFilter;
  type?: OperatorInboxType;
  state?: OperatorInboxState;
  visibility?: OperatorInboxVisibility;
  severity?: OperatorInboxSeverity;
  source?: OperatorInboxSource;
  limit?: number;
  cursor?: string;
}

export interface OperatorInboxListResult {
  items: OperatorInboxItem[];
  pagination: {
    limit: number;
    nextCursor: string | null;
    total: number;
  };
}

export interface OperatorInboxCounts {
  total: number;
  unread: number;
  read: number;
  visible: number;
  hidden: number;
  byType: Record<OperatorInboxType, number>;
  bySeverity: Record<OperatorInboxSeverity, number>;
  bySource: Record<OperatorInboxSource, number>;
  byFilter: Record<OperatorInboxFilter, number>;
}

export interface OperatorInboxSystemEvent {
  kind: "runtime.startup" | "first-run.required" | "first-run.completed" | "auth.session";
  status: "info" | "success" | "warning" | "error";
  summary: string;
  details?: string | null;
  route?: string;
  correlationKey?: string;
  observedAt?: string;
}

export interface OperatorInboxServiceEvent {
  serviceId: string;
  kind: "lifecycle.failed" | "lifecycle.recovered" | "health.degraded" | "health.unhealthy" | "health.recovered";
  summary: string;
  severity?: OperatorInboxSeverity;
  details?: string | null;
  route?: string;
  correlationKey?: string;
  observedAt?: string;
}

export interface OperatorInboxWorkflowEvent {
  workflowId: string;
  status: "succeeded" | "failed" | "timeout";
  summary: string;
  serviceId?: string | null;
  actionId?: string | null;
  runId?: string | null;
  scheduleId?: string | null;
  route?: string;
  observedAt?: string;
}

export interface OperatorInboxUpdateEvent {
  serviceId: string;
  status: "available" | "downloaded" | "installed" | "failed" | "restart_required" | "deferred";
  summary: string;
  details?: string | null;
  updateId?: string | null;
  route?: string;
  observedAt?: string;
}

export interface OperatorInboxDiagnosticsEvent {
  kind: "diagnostics.completed" | "export.completed" | "archive.completed";
  summary: string;
  serviceId?: string | null;
  backupExportId?: string | null;
  route?: string;
  observedAt?: string;
}

const inboxWriteQueues = new Map<string, Promise<void>>();

const INBOX_TYPES: OperatorInboxType[] = ["system", "workflow", "service", "update", "security", "help", "error"];
const INBOX_SEVERITIES: OperatorInboxSeverity[] = ["info", "success", "warning", "error", "critical"];
const INBOX_SOURCES: OperatorInboxSource[] = ["runtime", "service", "workflow", "updater", "broker", "admin-ui", "system"];
const INBOX_FILTERS: OperatorInboxFilter[] = ["all", "unread", "updates", "system", "workflow", "service", "errors", "hidden"];

function nowIso(): string {
  return new Date().toISOString();
}

function inboxPath(workspaceRoot: string): string {
  return path.join(workspaceRoot, ".state", "operator-inbox.json");
}

function stableIdFromDedupeKey(dedupeKey: string): string {
  const normalized = dedupeKey
    .toLowerCase()
    .replace(/[^a-z0-9_.:-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
  return normalized ? "inbox-" + normalized : "inbox-unknown";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function oneOf<T extends string>(value: unknown, values: readonly T[], fallback: T): T {
  return typeof value === "string" && values.includes(value as T) ? value as T : fallback;
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function sanitizeText(value: string): string {
  return value
    .replace(/([\w.-]*(?:password|passwd|secret|token|key|credential|cookie)[\w.-]*\s*[:=]\s*)[^\s,;]+/gi, "$1[redacted]")
    .replace(/(bearer\s+)[A-Za-z0-9._~+/=-]+/gi, "$1[redacted]")
    .replace(/(gh[pousr]_[A-Za-z0-9_]+)/g, "[redacted]")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeRelatedTarget(value: unknown): OperatorInboxRelatedTarget | null {
  if (!isRecord(value)) {
    return null;
  }

  const target: OperatorInboxRelatedTarget = {};
  for (const key of ["serviceId", "workflowId", "updateId", "auditId", "backupExportId", "route"] as const) {
    if (typeof value[key] === "string" && value[key].trim()) {
      target[key] = sanitizeText(value[key]);
    }
  }

  return Object.keys(target).length > 0 ? target : null;
}

function normalizeAction(value: unknown): OperatorInboxActionMetadata | null {
  if (!isRecord(value)) {
    return null;
  }

  const label = sanitizeText(stringOr(value.label, ""));
  const target = sanitizeText(stringOr(value.target, ""));
  if (!label || !target) {
    return null;
  }

  return {
    label,
    target,
    kind: oneOf(value.kind, ["link", "api", "command"] as const, "link"),
    availability: oneOf(value.availability, ["available", "disabled", "expired"] as const, "available"),
  };
}

function normalizeItem(value: unknown): OperatorInboxItem | null {
  if (!isRecord(value)) {
    return null;
  }

  const dedupeKey = sanitizeText(stringOr(value.dedupeKey, ""));
  if (!dedupeKey) {
    return null;
  }

  const observedAt = stringOr(value.updatedAt, nowIso());
  const state = oneOf(value.state, ["unread", "read"] as const, "unread");
  const visibility = oneOf(value.visibility, ["visible", "hidden"] as const, "visible");
  return {
    id: stringOr(value.id, stableIdFromDedupeKey(dedupeKey)),
    dedupeKey,
    title: sanitizeText(stringOr(value.title, "Inbox item")),
    summary: sanitizeText(stringOr(value.summary, "")),
    details: stringOrNull(value.details) === null ? null : sanitizeText(stringOr(value.details, "")),
    type: oneOf(value.type, INBOX_TYPES, "system"),
    severity: oneOf(value.severity, INBOX_SEVERITIES, "info"),
    source: oneOf(value.source, INBOX_SOURCES, "runtime"),
    state,
    visibility,
    createdAt: stringOr(value.createdAt, observedAt),
    updatedAt: observedAt,
    readAt: state === "read" ? stringOrNull(value.readAt) ?? observedAt : null,
    hiddenAt: visibility === "hidden" ? stringOrNull(value.hiddenAt) ?? observedAt : null,
    relatedTarget: normalizeRelatedTarget(value.relatedTarget),
    action: normalizeAction(value.action),
  };
}

export function normalizeOperatorInboxState(input: unknown): OperatorInboxStateFile {
  if (!isRecord(input)) {
    return { updatedAt: nowIso(), items: [] };
  }

  return {
    updatedAt: stringOr(input.updatedAt, nowIso()),
    items: Array.isArray(input.items)
      ? input.items.flatMap((entry) => {
          const item = normalizeItem(entry);
          return item ? [item] : [];
        })
      : [],
  };
}

async function withQueueLock<T>(filePath: string, operation: () => Promise<T>): Promise<T> {
  const previous = inboxWriteQueues.get(filePath) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(operation);
  const settled = next.then(() => undefined, () => undefined);
  inboxWriteQueues.set(filePath, settled);

  try {
    return await next;
  } finally {
    if (inboxWriteQueues.get(filePath) === settled) {
      inboxWriteQueues.delete(filePath);
    }
  }
}

export async function readOperatorInbox(workspaceRoot: string): Promise<OperatorInboxStateFile> {
  try {
    return normalizeOperatorInboxState(JSON.parse(await readFile(inboxPath(workspaceRoot), "utf8")) as unknown);
  } catch {
    return normalizeOperatorInboxState(null);
  }
}

async function writeOperatorInboxWithoutQueue(
  workspaceRoot: string,
  state: OperatorInboxStateFile,
): Promise<OperatorInboxStateFile> {
  const updatedAt = state.updatedAt || nowIso();
  const nextState: OperatorInboxStateFile = {
    updatedAt,
    items: state.items
      .map((item) => normalizeItem(item))
      .flatMap((item) => item ? [item] : [])
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, OPERATOR_INBOX_LIMIT),
  };

  const filePath = inboxPath(workspaceRoot);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(nextState, null, 2));
  return nextState;
}

export async function writeOperatorInbox(
  workspaceRoot: string,
  state: OperatorInboxStateFile,
): Promise<OperatorInboxStateFile> {
  const filePath = inboxPath(workspaceRoot);
  return await withQueueLock(filePath, () => writeOperatorInboxWithoutQueue(workspaceRoot, state));
}

export async function upsertOperatorInboxItem(
  workspaceRoot: string,
  input: OperatorInboxInput,
): Promise<OperatorInboxStateFile> {
  const filePath = inboxPath(workspaceRoot);
  return await withQueueLock(filePath, async () => {
    const existing = await readOperatorInbox(workspaceRoot);
    const observedAt = input.observedAt ?? nowIso();
    const dedupeKey = sanitizeText(input.dedupeKey);
    const existingItem = existing.items.find((item) => item.dedupeKey === dedupeKey);
    const nextItem: OperatorInboxItem = {
      id: existingItem?.id ?? stableIdFromDedupeKey(dedupeKey),
      dedupeKey,
      title: sanitizeText(input.title),
      summary: sanitizeText(input.summary),
      details: input.details === undefined || input.details === null ? null : sanitizeText(input.details),
      type: input.type,
      severity: input.severity,
      source: input.source,
      state: existingItem?.state ?? "unread",
      visibility: existingItem?.visibility ?? "visible",
      createdAt: existingItem?.createdAt ?? observedAt,
      updatedAt: observedAt,
      readAt: existingItem?.readAt ?? null,
      hiddenAt: existingItem?.hiddenAt ?? null,
      relatedTarget: normalizeRelatedTarget(input.relatedTarget ?? null),
      action: normalizeAction(input.action ?? null),
    };

    return await writeOperatorInboxWithoutQueue(workspaceRoot, {
      updatedAt: observedAt,
      items: [nextItem, ...existing.items.filter((item) => item.id !== nextItem.id)],
    });
  });
}

export async function mutateOperatorInboxItem(
  workspaceRoot: string,
  itemId: string,
  action: "read" | "unread" | "hide" | "unhide",
  now = nowIso(),
): Promise<OperatorInboxStateFile> {
  const filePath = inboxPath(workspaceRoot);
  return await withQueueLock(filePath, async () => {
    const existing = await readOperatorInbox(workspaceRoot);
    let found = false;
    const items = existing.items.map((item) => {
      if (item.id !== itemId) {
        return item;
      }

      found = true;
      if (action === "read") {
        return { ...item, state: "read" as const, updatedAt: now, readAt: now };
      }
      if (action === "unread") {
        return { ...item, state: "unread" as const, updatedAt: now, readAt: null };
      }
      if (action === "hide") {
        return { ...item, visibility: "hidden" as const, updatedAt: now, hiddenAt: now };
      }
      return { ...item, visibility: "visible" as const, updatedAt: now, hiddenAt: null };
    });

    if (!found) {
      throw new Error("Unknown operator inbox item id: " + itemId + ".");
    }

    return await writeOperatorInboxWithoutQueue(workspaceRoot, { updatedAt: now, items });
  });
}

export async function bulkMutateOperatorInboxItems(
  workspaceRoot: string,
  action: "read" | "hide",
  itemIds: string[],
  now = nowIso(),
): Promise<OperatorInboxStateFile> {
  const filePath = inboxPath(workspaceRoot);
  return await withQueueLock(filePath, async () => {
    const existing = await readOperatorInbox(workspaceRoot);
    const selected = new Set(itemIds);
    const items = existing.items.map((item) => {
      if (!selected.has(item.id)) {
        return item;
      }
      if (action === "read") {
        return { ...item, state: "read" as const, updatedAt: now, readAt: now };
      }
      return { ...item, visibility: "hidden" as const, updatedAt: now, hiddenAt: now };
    });
    return await writeOperatorInboxWithoutQueue(workspaceRoot, { updatedAt: now, items });
  });
}

function matchesFilter(item: OperatorInboxItem, filter: OperatorInboxFilter): boolean {
  if (filter === "all") {
    return item.visibility === "visible";
  }
  if (filter === "unread") {
    return item.state === "unread" && item.visibility === "visible";
  }
  if (filter === "updates") {
    return item.type === "update" && item.visibility === "visible";
  }
  if (filter === "system") {
    return item.type === "system" && item.visibility === "visible";
  }
  if (filter === "workflow") {
    return item.type === "workflow" && item.visibility === "visible";
  }
  if (filter === "service") {
    return item.type === "service" && item.visibility === "visible";
  }
  if (filter === "errors") {
    return (item.type === "error" || item.severity === "error" || item.severity === "critical") && item.visibility === "visible";
  }
  return item.visibility === "hidden";
}

export function filterOperatorInboxItems(
  items: OperatorInboxItem[],
  query: OperatorInboxQuery = {},
): OperatorInboxItem[] {
  const filter = query.filter ?? "all";
  return items.filter((item) => {
    return (
      matchesFilter(item, filter) &&
      (query.type === undefined || item.type === query.type) &&
      (query.state === undefined || item.state === query.state) &&
      (query.visibility === undefined || item.visibility === query.visibility) &&
      (query.severity === undefined || item.severity === query.severity) &&
      (query.source === undefined || item.source === query.source)
    );
  });
}

export function listOperatorInboxItems(
  state: OperatorInboxStateFile,
  query: OperatorInboxQuery = {},
): OperatorInboxListResult {
  const limit = Math.min(Math.max(query.limit ?? 50, 1), 200);
  const offset = query.cursor ? Math.max(Number.parseInt(query.cursor, 10) || 0, 0) : 0;
  const filtered = filterOperatorInboxItems(state.items, query);
  const items = filtered.slice(offset, offset + limit);
  const nextOffset = offset + items.length;
  return {
    items,
    pagination: {
      limit,
      nextCursor: nextOffset < filtered.length ? String(nextOffset) : null,
      total: filtered.length,
    },
  };
}

export function countOperatorInboxItems(items: OperatorInboxItem[]): OperatorInboxCounts {
  const counts: OperatorInboxCounts = {
    total: items.length,
    unread: items.filter((item) => item.state === "unread").length,
    read: items.filter((item) => item.state === "read").length,
    visible: items.filter((item) => item.visibility === "visible").length,
    hidden: items.filter((item) => item.visibility === "hidden").length,
    byType: { system: 0, workflow: 0, service: 0, update: 0, security: 0, help: 0, error: 0 },
    bySeverity: { info: 0, success: 0, warning: 0, error: 0, critical: 0 },
    bySource: { runtime: 0, service: 0, workflow: 0, updater: 0, broker: 0, "admin-ui": 0, system: 0 },
    byFilter: { all: 0, unread: 0, updates: 0, system: 0, workflow: 0, service: 0, errors: 0, hidden: 0 },
  };

  for (const item of items) {
    counts.byType[item.type] += 1;
    counts.bySeverity[item.severity] += 1;
    counts.bySource[item.source] += 1;
  }

  for (const filter of INBOX_FILTERS) {
    counts.byFilter[filter] = items.filter((item) => matchesFilter(item, filter)).length;
  }

  return counts;
}

function severityFromSystemStatus(status: OperatorInboxSystemEvent["status"]): OperatorInboxSeverity {
  if (status === "error") {
    return "error";
  }
  if (status === "warning") {
    return "warning";
  }
  if (status === "success") {
    return "success";
  }
  return "info";
}

function serviceEventTitle(kind: OperatorInboxServiceEvent["kind"], serviceId: string): string {
  if (kind === "lifecycle.failed") {
    return "Service lifecycle failed: " + serviceId;
  }
  if (kind === "lifecycle.recovered") {
    return "Service recovered: " + serviceId;
  }
  if (kind === "health.degraded") {
    return "Service health degraded: " + serviceId;
  }
  if (kind === "health.recovered") {
    return "Service health recovered: " + serviceId;
  }
  return "Service health unhealthy: " + serviceId;
}

function updateEventTitle(status: OperatorInboxUpdateEvent["status"], serviceId: string): string {
  if (status === "available") {
    return "Update available: " + serviceId;
  }
  if (status === "downloaded") {
    return "Update downloaded: " + serviceId;
  }
  if (status === "installed") {
    return "Update installed: " + serviceId;
  }
  if (status === "restart_required") {
    return "Restart required: " + serviceId;
  }
  if (status === "deferred") {
    return "Update deferred: " + serviceId;
  }
  return "Update failed: " + serviceId;
}

function updateEventSeverity(status: OperatorInboxUpdateEvent["status"]): OperatorInboxSeverity {
  if (status === "failed") {
    return "error";
  }
  if (status === "deferred" || status === "restart_required") {
    return "warning";
  }
  if (status === "installed" || status === "downloaded") {
    return "success";
  }
  return "info";
}

export async function emitOperatorInboxSystemEvent(
  workspaceRoot: string,
  event: OperatorInboxSystemEvent,
): Promise<OperatorInboxStateFile> {
  return await upsertOperatorInboxItem(workspaceRoot, {
    dedupeKey: "system:" + event.kind + ":" + (event.correlationKey ?? "current"),
    title: event.kind === "runtime.startup"
      ? "Runtime startup"
      : event.kind === "first-run.required"
        ? "First-run setup required"
        : event.kind === "first-run.completed"
          ? "First-run setup completed"
          : "Authentication notice",
    summary: event.summary,
    details: event.details,
    type: event.kind === "auth.session" ? "security" : "system",
    severity: severityFromSystemStatus(event.status),
    source: event.kind === "auth.session" ? "runtime" : "system",
    relatedTarget: event.route ? { route: event.route } : null,
    action: event.route
      ? {
          label: "Review",
          target: event.route,
          kind: "link",
          availability: "available",
        }
      : null,
    observedAt: event.observedAt,
  });
}

export async function emitOperatorInboxServiceEvent(
  workspaceRoot: string,
  event: OperatorInboxServiceEvent,
): Promise<OperatorInboxStateFile> {
  const recovered = event.kind === "lifecycle.recovered" || event.kind === "health.recovered";
  const severity = event.severity ?? (recovered ? "success" : event.kind === "health.degraded" ? "warning" : "error");
  return await upsertOperatorInboxItem(workspaceRoot, {
    dedupeKey: "service:" + event.kind + ":" + event.serviceId + ":" + (event.correlationKey ?? "current"),
    title: serviceEventTitle(event.kind, event.serviceId),
    summary: event.summary,
    details: event.details,
    type: recovered ? "service" : "error",
    severity,
    source: "service",
    relatedTarget: {
      serviceId: event.serviceId,
      route: event.route ?? "/services/" + encodeURIComponent(event.serviceId),
    },
    action: {
      label: "Open service",
      target: event.route ?? "/services/" + encodeURIComponent(event.serviceId),
      kind: "link",
      availability: "available",
    },
    observedAt: event.observedAt,
  });
}

export async function emitOperatorInboxWorkflowEvent(
  workspaceRoot: string,
  event: OperatorInboxWorkflowEvent,
): Promise<OperatorInboxStateFile> {
  const ok = event.status === "succeeded";
  return await upsertOperatorInboxItem(workspaceRoot, {
    dedupeKey: "workflow:" + event.workflowId + ":" + (event.runId ?? event.scheduleId ?? event.actionId ?? event.status),
    title: ok ? "Workflow completed: " + event.workflowId : "Workflow needs attention: " + event.workflowId,
    summary: event.summary,
    type: ok ? "workflow" : "error",
    severity: ok ? "success" : "error",
    source: "workflow",
    relatedTarget: {
      ...(event.serviceId ? { serviceId: event.serviceId } : {}),
      workflowId: event.workflowId,
      ...(event.runId ? { auditId: event.runId } : {}),
      ...(event.route ? { route: event.route } : {}),
    },
    action: event.route
      ? {
          label: "Open workflow",
          target: event.route,
          kind: "link",
          availability: "available",
        }
      : null,
    observedAt: event.observedAt,
  });
}

export async function emitOperatorInboxUpdateEvent(
  workspaceRoot: string,
  event: OperatorInboxUpdateEvent,
): Promise<OperatorInboxStateFile> {
  return await upsertOperatorInboxItem(workspaceRoot, {
    dedupeKey: "update:" + event.status + ":" + event.serviceId + ":" + (event.updateId ?? "current"),
    title: updateEventTitle(event.status, event.serviceId),
    summary: event.summary,
    details: event.details,
    type: "update",
    severity: updateEventSeverity(event.status),
    source: "updater",
    relatedTarget: {
      serviceId: event.serviceId,
      ...(event.updateId ? { updateId: event.updateId } : {}),
      route: event.route ?? "/services/" + encodeURIComponent(event.serviceId) + "/updates",
    },
    action: {
      label: "Review update",
      target: event.route ?? "/services/" + encodeURIComponent(event.serviceId) + "/updates",
      kind: "link",
      availability: "available",
    },
    observedAt: event.observedAt,
  });
}

export async function emitOperatorInboxDiagnosticsEvent(
  workspaceRoot: string,
  event: OperatorInboxDiagnosticsEvent,
): Promise<OperatorInboxStateFile> {
  return await upsertOperatorInboxItem(workspaceRoot, {
    dedupeKey: "diagnostics:" + event.kind + ":" + (event.backupExportId ?? event.serviceId ?? "runtime"),
    title: event.kind === "diagnostics.completed"
      ? "Diagnostics bundle completed"
      : event.kind === "archive.completed"
        ? "Archive completed"
        : "Export completed",
    summary: event.summary,
    type: "system",
    severity: "success",
    source: "runtime",
    relatedTarget: {
      ...(event.serviceId ? { serviceId: event.serviceId } : {}),
      ...(event.backupExportId ? { backupExportId: event.backupExportId } : {}),
      ...(event.route ? { route: event.route } : {}),
    },
    action: event.route
      ? {
          label: "Open",
          target: event.route,
          kind: "link",
          availability: "available",
        }
      : null,
    observedAt: event.observedAt,
  });
}
