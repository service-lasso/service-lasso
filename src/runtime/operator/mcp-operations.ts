import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { appendAuditEvent } from "../audit/store.js";
import { readPrivateJson, writePrivateJson } from "../security/private-json.js";
import type { McpHttpAuthorization } from "./mcp-auth.js";
import {
  guardedActionPolicy,
  type McpGuardedActionName,
  type McpGuardedActionProgressUpdate,
  type McpGuardedActionResponse,
} from "./mcp-guarded-actions.js";
import type {
  McpPermissionProfile,
} from "./mcp-auth.js";

export const MCP_OPERATION_CONTRACT_VERSION = "service-lasso-mcp-operation.v1" as const;
export const MCP_OPERATION_ACCEPTED_CONTRACT_VERSION = "service-lasso-mcp-operation-accepted.v1" as const;
export const DEFAULT_MCP_OPERATION_REQUEST_BUDGET_MS = 1_000;
export const DEFAULT_MCP_OPERATION_RETENTION_MS = 24 * 60 * 60 * 1_000;
export const MAX_MCP_OPERATION_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;
export const MAX_MCP_OPERATIONS = 48;
export const MAX_MCP_OPERATION_LIST_LIMIT = 100;

const OPERATION_ID_PATTERN = /^mcp-operation-[0-9a-f-]{36}$/u;
const SAFE_TARGET_PATTERN = /^@?[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const secretLikePattern = /(?:bearer\s+[A-Za-z0-9._~+/=-]+)|(?:gh[pousr]_[A-Za-z0-9_]+)|(?:xox[a-z]-[A-Za-z0-9-]+)|(?:(?:AKIA|ASIA)[A-Z0-9]{16})|(?:[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})|(?:(?:password|passwd|secret|token|cookie|credential|private[_-]?key)\s*[:=]\s*[^\s,;]+)/iu;
const absolutePathLikePattern = /^(?:[A-Za-z]:[\\/]|\\\\|\/)|file:\/\//iu;
const stateQueues = new Map<string, Promise<void>>();
const stateCache = new Map<string, { identity: string; state: OperationState }>();
const activeOperations = new Map<string, {
  workspaceRoot: string;
  operationId: string;
  runnerInstanceId: string;
  controller: AbortController;
  completion: Promise<McpOperationCompletion>;
}>();
const workspaceHeartbeats = new Map<string, { completion: Promise<void> }>();
const STATE_VERSION = 1;
const STATE_LOCK_TIMEOUT_MS = 15_000;
const STATE_LOCK_STALE_MS = 60_000;
const RUNNER_HEARTBEAT_INTERVAL_MS = 5_000;
const RUNNER_HEARTBEAT_STALE_MS = 30_000;
const profileRank: Record<McpPermissionProfile, number> = {
  observer: 0,
  operator: 1,
  maintainer: 2,
  administrator: 3,
};

export type McpOperationStatus = "queued" | "running" | "cancelling" | "succeeded" | "failed" | "cancelled" | "skipped";
export type McpOperationOutcome = "succeeded" | "failed" | "cancelled" | "skipped";
export type McpOperationCancellationResult = "requested" | "unsupported" | "too_late";

export interface McpOperationPublicRecord {
  operationId: string;
  action: McpGuardedActionName;
  status: McpOperationStatus;
  phase: string;
  progress: number;
  summary: string;
  createdAt: string;
  startedAt: string | null;
  updatedAt: string;
  completedAt: string | null;
  expiresAt: string;
  targetIds: string[];
  correlationId: string;
  cancellationSupported: boolean;
  outcome: McpOperationOutcome | null;
  ownership: "own" | "other";
}

export interface McpOperationPayload {
  contractVersion: typeof MCP_OPERATION_CONTRACT_VERSION;
  generatedAt: string;
  operation: McpOperationPublicRecord;
  safety: McpOperationSafety;
}

export interface McpOperationListPayload {
  contractVersion: typeof MCP_OPERATION_CONTRACT_VERSION;
  generatedAt: string;
  operations: McpOperationPublicRecord[];
  pagination: {
    limit: number;
    nextCursor: string | null;
    total: number;
  };
  safety: McpOperationSafety;
}

export interface McpOperationCancelPayload extends McpOperationPayload {
  cancellation: {
    result: McpOperationCancellationResult;
    terminal: boolean;
  };
}

export interface McpOperationAcceptedPayload {
  contractVersion: typeof MCP_OPERATION_ACCEPTED_CONTRACT_VERSION;
  generatedAt: string;
  accepted: true;
  operation: McpOperationPublicRecord;
  safety: McpOperationSafety;
}

export interface McpOperationSafety {
  mutating: boolean;
  redacted: true;
  omittedSensitiveFields: string[];
}

interface PendingTerminal {
  status: McpOperationOutcome;
  phase: "completed" | "failed" | "cancelled" | "skipped" | "replayed" | "interrupted";
  progress: 100;
  summary: string;
  completedAt: string;
}

interface StoredOperation {
  operationId: string;
  actorId: string;
  clientId: string;
  action: McpGuardedActionName;
  status: McpOperationStatus;
  phase: string;
  progress: number;
  summary: string;
  createdAt: string;
  startedAt: string | null;
  updatedAt: string;
  completedAt: string | null;
  expiresAt: string;
  targetIds: string[];
  correlationId: string;
  cancellationSupported: boolean;
  outcome: McpOperationOutcome | null;
  runnerPid: number;
  runnerInstanceId: string;
  heartbeatAt: string;
  guardedExecutionId: string | null;
  pendingTerminal: PendingTerminal | null;
}

interface OperationState {
  version: 1;
  operations: StoredOperation[];
}

interface McpOperationCompletion {
  response: McpGuardedActionResponse | null;
  error: unknown | null;
}

export interface McpOperationRecoveryResult {
  status: "running" | McpOperationOutcome;
  phase: string;
  progress: number;
  summary: string;
}

export interface McpOperationRecoveryRecord extends McpOperationPublicRecord {
  guardedExecutionId: string | null;
}

export interface McpOperationServiceOptions {
  workspaceRoot: string;
  requestBudgetMs?: number;
  retentionMs?: number;
  now?: () => Date;
  recoverDetached?: (operation: McpOperationRecoveryRecord) => Promise<McpOperationRecoveryResult | null>;
  cancelDetached?: (operation: McpOperationPublicRecord) => Promise<"cancelled" | "unsupported" | "too_late">;
}

export class McpOperationError extends Error {
  constructor(
    public readonly code:
      | "authorization_required"
      | "forbidden"
      | "invalid_cursor"
      | "invalid_request"
      | "operation_capacity"
      | "operation_not_found"
      | "operation_state_invalid"
      | "operation_state_unavailable"
      | "mcp_operation_audit_unavailable",
    message: string,
  ) {
    super(message);
    this.name = "McpOperationError";
  }
}

export class McpOperationService {
  readonly workspaceRoot: string;
  readonly requestBudgetMs: number;
  readonly retentionMs: number;
  readonly now: () => Date;
  private readonly recoverDetached?: McpOperationServiceOptions["recoverDetached"];
  private readonly cancelDetached?: McpOperationServiceOptions["cancelDetached"];

  constructor(options: McpOperationServiceOptions) {
    this.workspaceRoot = path.resolve(options.workspaceRoot);
    this.requestBudgetMs = boundedInteger(options.requestBudgetMs, DEFAULT_MCP_OPERATION_REQUEST_BUDGET_MS, 25, 30_000);
    this.retentionMs = boundedInteger(options.retentionMs, DEFAULT_MCP_OPERATION_RETENTION_MS, 1_000, MAX_MCP_OPERATION_RETENTION_MS);
    this.now = options.now ?? (() => new Date());
    this.recoverDetached = options.recoverDetached;
    this.cancelDetached = options.cancelDetached;
  }

  async submit(input: {
    authorization: McpHttpAuthorization | undefined;
    action: McpGuardedActionName;
    targetIds: string[];
    cancellationSupported: boolean;
    guardedExecutionId?: string | null;
    requestSignal?: AbortSignal;
    execute: (
      signal: AbortSignal,
      reportProgress: (update: McpGuardedActionProgressUpdate) => Promise<void>,
      correlationId: string,
    ) => Promise<McpGuardedActionResponse>;
  }): Promise<{ kind: "completed"; response: McpGuardedActionResponse } | { kind: "accepted"; payload: McpOperationAcceptedPayload }> {
    const authorization = requiredAuthorization(input.authorization);
    const createdAt = this.now();
    const priorState = await this.readAndCleanState();
    for (const prior of priorState.operations.filter((operation) =>
      !isTerminal(operation.status) && Date.parse(operation.expiresAt) <= createdAt.getTime()
    )) {
      await this.reconcileOperation(prior.operationId);
    }
    const operationId = `mcp-operation-${randomUUID()}`;
    const correlationId = `mcp-operation-correlation-${randomUUID()}`;
    const targetIds = normalizeTargets(input.targetIds);
    const record: StoredOperation = {
      operationId,
      actorId: storedIdentity(authorization.actor.actorId, "actor"),
      clientId: storedIdentity(authorization.actor.clientId, "client"),
      action: input.action,
      status: "running",
      phase: "preflight",
      progress: 5,
      summary: "Durable MCP operation preflight is running.",
      createdAt: createdAt.toISOString(),
      startedAt: createdAt.toISOString(),
      updatedAt: createdAt.toISOString(),
      completedAt: null,
      expiresAt: new Date(createdAt.getTime() + this.retentionMs).toISOString(),
      targetIds,
      correlationId,
      cancellationSupported: input.cancellationSupported,
      outcome: null,
      runnerPid: process.pid,
      runnerInstanceId: randomUUID(),
      heartbeatAt: createdAt.toISOString(),
      guardedExecutionId: normalizeGuardedExecutionId(input.guardedExecutionId),
      pendingTerminal: null,
    };

    await this.mutateState((state) => {
      if (state.operations.filter((operation) => !isTerminal(operation.status)).length >= MAX_MCP_OPERATIONS) {
        throw new McpOperationError("operation_capacity", "Too many durable MCP operations are active.");
      }
      state.operations.push(record);
    });
    try {
      await auditOperation(this.workspaceRoot, record, "started", "accepted");
    } catch (error) {
      await this.mutateState((state) => {
        state.operations = state.operations.filter((operation) => operation.operationId !== operationId);
      }).catch(() => undefined);
      throw error;
    }

    const controller = new AbortController();
    const activeKey = operationKey(this.workspaceRoot, operationId);
    const completion = this.runOperation(record, controller, input.execute);
    activeOperations.set(activeKey, {
      workspaceRoot: this.workspaceRoot,
      operationId,
      runnerInstanceId: record.runnerInstanceId,
      controller,
      completion,
    });
    this.ensureWorkspaceHeartbeat();

    const requestCancellation = () => {
      if (!input.cancellationSupported) return;
      void this.cancel(operationId, authorization, "request_cancelled").catch(() => undefined);
    };
    input.requestSignal?.addEventListener("abort", requestCancellation, { once: true });
    if (input.requestSignal?.aborted) requestCancellation();
    void completion.finally(() => input.requestSignal?.removeEventListener("abort", requestCancellation));

    const budgetElapsed = Symbol("budgetElapsed");
    const settled = await Promise.race([
      completion,
      delay(this.requestBudgetMs, budgetElapsed),
    ]);
    if (settled !== budgetElapsed) {
      input.requestSignal?.removeEventListener("abort", requestCancellation);
      if (settled.error === null && settled.response) return { kind: "completed", response: settled.response };
      throw settled.error instanceof Error
        ? settled.error
        : new McpOperationError("invalid_request", "The durable MCP operation failed safely.");
    }

    const current = await this.get(operationId, authorization);
    return {
      kind: "accepted",
      payload: {
        contractVersion: MCP_OPERATION_ACCEPTED_CONTRACT_VERSION,
        generatedAt: this.now().toISOString(),
        accepted: true,
        operation: current.operation,
        safety: operationSafety(true),
      },
    };
  }

  async get(operationId: string, authorization: McpHttpAuthorization | undefined): Promise<McpOperationPayload> {
    const identity = requiredAuthorization(authorization);
    const normalizedId = normalizeOperationId(operationId);
    await this.reconcileOperation(normalizedId).catch((error) => {
      if (error instanceof McpOperationError && error.code === "operation_not_found") return;
      throw error;
    });
    const record = await this.readRecord(normalizedId);
    assertCanInspect(record, identity);
    return {
      contractVersion: MCP_OPERATION_CONTRACT_VERSION,
      generatedAt: this.now().toISOString(),
      operation: publicRecord(record, identity.actor.actorId),
      safety: operationSafety(false),
    };
  }

  async list(input: {
    authorization: McpHttpAuthorization | undefined;
    includeAllActors?: boolean;
    cursor?: number;
    limit?: number;
  }): Promise<McpOperationListPayload> {
    const identity = requiredAuthorization(input.authorization);
    if (input.includeAllActors === true && identity.actor.permissionProfile !== "administrator") {
      throw new McpOperationError("forbidden", "Administrator permission is required to list other actors' operations.");
    }
    const state = await this.readAndCleanState();
    for (const record of state.operations.filter((operation) => !isTerminal(operation.status))) {
      await this.reconcileOperation(record.operationId).catch(() => undefined);
    }
    const refreshed = await this.readAndCleanState();
    const visible = refreshed.operations
      .filter((operation) => input.includeAllActors === true || operation.actorId === storedIdentity(identity.actor.actorId, "actor"))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || left.operationId.localeCompare(right.operationId));
    const cursor = input.cursor ?? 0;
    const limit = input.limit ?? 50;
    if (!Number.isSafeInteger(cursor) || cursor < 0 || cursor > visible.length) {
      throw new McpOperationError("invalid_cursor", "The durable operation cursor is invalid or stale.");
    }
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_MCP_OPERATION_LIST_LIMIT) {
      throw new McpOperationError("invalid_request", `Operation list limit must be an integer from 1 to ${MAX_MCP_OPERATION_LIST_LIMIT}.`);
    }
    const page = visible.slice(cursor, cursor + limit);
    return {
      contractVersion: MCP_OPERATION_CONTRACT_VERSION,
      generatedAt: this.now().toISOString(),
      operations: page.map((record) => publicRecord(record, identity.actor.actorId)),
      pagination: {
        limit,
        nextCursor: cursor + page.length < visible.length ? String(cursor + page.length) : null,
        total: visible.length,
      },
      safety: operationSafety(false),
    };
  }

  async cancel(
    operationId: string,
    authorization: McpHttpAuthorization | undefined,
    reason = "operator_requested",
  ): Promise<McpOperationCancelPayload> {
    const identity = requiredAuthorization(authorization);
    const normalizedId = normalizeOperationId(operationId);
    let record = await this.readRecord(normalizedId);
    try {
      assertCanInspect(record, identity);
      assertCanCancel(record, identity);
    } catch (error) {
      await auditOperation(
        this.workspaceRoot,
        record,
        "cancellation",
        error instanceof McpOperationError ? error.code : "forbidden",
        {
          actorId: identity.actor.actorId,
          clientId: identity.actor.clientId,
          denied: true,
        },
      );
      throw error;
    }

    if (record.pendingTerminal) {
      await this.finalizePendingTerminal(normalizedId);
      record = await this.readRecord(normalizedId);
    }
    if (isTerminal(record.status)) {
      await auditOperation(this.workspaceRoot, record, "cancellation", "too_late");
      return cancellationPayload(record, identity.actor.actorId, "too_late", this.now());
    }
    if (!record.cancellationSupported) {
      await auditOperation(this.workspaceRoot, record, "cancellation", "unsupported");
      return cancellationPayload(record, identity.actor.actorId, "unsupported", this.now());
    }

    await auditOperation(this.workspaceRoot, record, "cancellation", safeReason(reason));
    let cancellationRequested = false;
    await this.mutateState((state) => {
      const current = state.operations.find((operation) => operation.operationId === normalizedId);
      if (!current) throw new McpOperationError("operation_not_found", "The durable MCP operation was not found.");
      if (isTerminal(current.status) || current.pendingTerminal) {
        record = structuredClone(current);
        return;
      }
      current.status = "cancelling";
      current.phase = "cancellation_requested";
      current.summary = "Durable MCP operation cancellation requested.";
      current.updatedAt = this.now().toISOString();
      record = structuredClone(current);
      cancellationRequested = true;
    });
    if (!cancellationRequested) {
      if (record.pendingTerminal) {
        await this.finalizePendingTerminal(normalizedId);
        record = await this.readRecord(normalizedId);
      }
      await auditOperation(this.workspaceRoot, record, "cancellation", "too_late");
      return cancellationPayload(record, identity.actor.actorId, "too_late", this.now());
    }

    const active = activeOperations.get(operationKey(this.workspaceRoot, normalizedId));
    if (active) {
      active.controller.abort(new Error("MCP operation cancellation requested."));
      await Promise.race([active.completion, delay(2_000, undefined, { ref: false })]);
    } else if (runnerOwnsLiveOperation(record, this.now())) {
      const deadline = Date.now() + 2_000;
      do {
        await delay(50, undefined, { ref: false });
        record = await this.readRecord(normalizedId);
        if (record.pendingTerminal) await this.finalizePendingTerminal(normalizedId);
        record = await this.readRecord(normalizedId);
        if (isTerminal(record.status)) break;
      } while (Date.now() < deadline);
    } else if (this.cancelDetached) {
      let detachedResult: "cancelled" | "unsupported" | "too_late";
      try {
        detachedResult = await this.cancelDetached(recoveryRecord(record, identity.actor.actorId));
      } catch {
        await this.restoreDetachedAfterCancellation(normalizedId);
        throw new McpOperationError("invalid_request", "Durable MCP operation cancellation could not be completed safely.");
      }
      if (detachedResult === "cancelled") {
        await this.stageTerminal(normalizedId, "cancelled", "Durable MCP operation cancelled.");
        await this.finalizePendingTerminal(normalizedId);
      } else if (detachedResult === "unsupported") {
        await this.restoreDetachedAfterCancellation(normalizedId);
        record = await this.readRecord(normalizedId);
        return cancellationPayload(record, identity.actor.actorId, "unsupported", this.now());
      } else {
        await this.restoreDetachedAfterCancellation(normalizedId);
        await this.reconcileOperation(normalizedId);
        record = await this.readRecord(normalizedId);
        return cancellationPayload(record, identity.actor.actorId, "too_late", this.now());
      }
    }

    record = await this.readRecord(normalizedId);
    if (record.pendingTerminal) {
      await this.finalizePendingTerminal(normalizedId);
      record = await this.readRecord(normalizedId);
    }
    return cancellationPayload(
      record,
      identity.actor.actorId,
      isTerminal(record.status) && record.status !== "cancelled" ? "too_late" : "requested",
      this.now(),
    );
  }

  private async restoreDetachedAfterCancellation(operationId: string): Promise<void> {
    await this.updateRecord(operationId, (record) => {
      if (record.status !== "cancelling" || record.pendingTerminal) return;
      record.status = "running";
      record.phase = "detached";
      record.summary = "Durable runtime work continues outside this MCP process; poll for reconciliation.";
      record.updatedAt = this.now().toISOString();
    });
  }

  private async runOperation(
    initial: StoredOperation,
    controller: AbortController,
    execute: (
      signal: AbortSignal,
      reportProgress: (update: McpGuardedActionProgressUpdate) => Promise<void>,
      correlationId: string,
    ) => Promise<McpGuardedActionResponse>,
  ): Promise<McpOperationCompletion> {
    const activeKey = operationKey(this.workspaceRoot, initial.operationId);
    let response: McpGuardedActionResponse | null = null;
    let error: unknown | null = null;
    let lastProgressPersistedAt = Date.now();
    try {
      response = await execute(controller.signal, async (update) => {
        const normalizedTargets = update.targetIds ? normalizeTargets(update.targetIds) : null;
        const targetsChanged = normalizedTargets !== null && !sameTargets(normalizedTargets, initial.targetIds);
        if (!targetsChanged && Date.now() - lastProgressPersistedAt < 5_000) return;
        await this.updateRecord(initial.operationId, (record) => {
          if (record.status === "cancelling") return;
          record.status = "running";
          record.phase = safePhase(update.phase);
          record.progress = boundedProgress(update.progress);
          record.summary = safeSummary(update.summary, "Durable MCP operation is running.");
          if (normalizedTargets) record.targetIds = normalizedTargets;
          record.updatedAt = this.now().toISOString();
        });
        if (normalizedTargets) initial.targetIds = normalizedTargets;
        lastProgressPersistedAt = Date.now();
      }, initial.correlationId);
      const completedTargets = normalizeTargets(response?.preflight.targets ?? initial.targetIds);
      if (!sameTargets(completedTargets, initial.targetIds)) {
        await this.updateRecord(initial.operationId, (record) => {
          record.targetIds = completedTargets;
          record.updatedAt = this.now().toISOString();
        });
        initial.targetIds = completedTargets;
      }
      if (!response.ok && controller.signal.aborted) {
        await this.stageTerminal(initial.operationId, "cancelled", "Durable MCP operation cancelled.");
      } else {
        const outcome: McpOperationOutcome = response.status === "skipped" || response.status === "replayed"
          ? "skipped"
          : response.ok
            ? "succeeded"
            : "failed";
        await this.stageTerminal(
          initial.operationId,
          outcome,
          safeSummary(response.summary, outcome === "succeeded" ? "Durable MCP operation completed." : "Durable MCP operation did not repeat a mutation."),
          response.status === "replayed" ? "replayed" : undefined,
        );
      }
    } catch (caught) {
      error = caught;
      await this.stageTerminal(
        initial.operationId,
        controller.signal.aborted ? "cancelled" : "failed",
        controller.signal.aborted ? "Durable MCP operation cancelled." : "Durable MCP operation failed safely.",
      ).catch(() => undefined);
    }
    try {
      await this.finalizePendingTerminal(initial.operationId);
    } catch (caught) {
      error ??= caught;
    } finally {
      activeOperations.delete(activeKey);
    }
    return { response, error };
  }

  private ensureWorkspaceHeartbeat(): void {
    if (workspaceHeartbeats.has(this.workspaceRoot)) return;
    const heartbeat = { completion: Promise.resolve() };
    workspaceHeartbeats.set(this.workspaceRoot, heartbeat);
    heartbeat.completion = (async () => {
      try {
        for (;;) {
          await delay(RUNNER_HEARTBEAT_INTERVAL_MS, undefined, { ref: false });
          if (workspaceHeartbeats.get(this.workspaceRoot) !== heartbeat) return;
          const active = [...activeOperations.values()].filter((entry) => entry.workspaceRoot === this.workspaceRoot);
          if (active.length === 0) return;
          const activeById = new Map(active.map((entry) => [entry.operationId, entry]));
          await this.mutateState((state) => {
            const heartbeatAt = this.now().toISOString();
            for (const record of state.operations) {
              const owned = activeById.get(record.operationId);
              if (
                !owned ||
                record.runnerInstanceId !== owned.runnerInstanceId ||
                isTerminal(record.status) ||
                record.pendingTerminal
              ) continue;
              record.heartbeatAt = heartbeatAt;
              if (record.status === "cancelling") {
                owned.controller.abort(new Error("MCP operation cancellation requested."));
              }
            }
          }).catch(() => undefined);
        }
      } finally {
        if (workspaceHeartbeats.get(this.workspaceRoot) === heartbeat) {
          workspaceHeartbeats.delete(this.workspaceRoot);
          if ([...activeOperations.values()].some((entry) => entry.workspaceRoot === this.workspaceRoot)) {
            this.ensureWorkspaceHeartbeat();
          }
        }
      }
    })();
  }

  private async stageTerminal(
    operationId: string,
    outcome: McpOperationOutcome,
    summary: string,
    phase?: PendingTerminal["phase"],
  ): Promise<void> {
    await this.updateRecord(operationId, (record) => {
      if (isTerminal(record.status) || record.pendingTerminal) return;
      const completedAt = this.now().toISOString();
      record.phase = "finalizing";
      record.progress = 99;
      record.summary = "Durable MCP operation is finalizing Audit.";
      record.updatedAt = completedAt;
      record.pendingTerminal = {
        status: outcome,
        phase: phase ?? (outcome === "succeeded" ? "completed" : outcome),
        progress: 100,
        summary: safeSummary(summary, terminalSummary(outcome)),
        completedAt,
      };
    });
  }

  private async finalizePendingTerminal(operationId: string): Promise<void> {
    await withStateLock(this.workspaceRoot, async () => {
      const state = await readState(this.workspaceRoot);
      const record = state.operations.find((operation) => operation.operationId === operationId);
      if (!record) throw new McpOperationError("operation_not_found", "The durable MCP operation was not found.");
      const pending = record.pendingTerminal;
      if (!pending) return;
      await auditOperation(this.workspaceRoot, record, pending.status, pending.phase, {
        eventId: terminalAuditEventId(record, pending),
      });
      if (!record.pendingTerminal || record.pendingTerminal.completedAt !== pending.completedAt) return;
      record.status = pending.status;
      record.phase = pending.phase;
      record.progress = pending.progress;
      record.summary = pending.summary;
      record.updatedAt = pending.completedAt;
      record.completedAt = pending.completedAt;
      record.expiresAt = new Date(Date.parse(pending.completedAt) + this.retentionMs).toISOString();
      record.outcome = pending.status;
      record.pendingTerminal = null;
      await writeState(this.workspaceRoot, state);
    });
  }

  private async reconcileOperation(operationId: string): Promise<void> {
    let record = await this.readRecord(operationId);
    if (record.pendingTerminal) {
      await this.finalizePendingTerminal(operationId);
      return;
    }
    if (isTerminal(record.status) || activeOperations.has(operationKey(this.workspaceRoot, operationId))) return;
    if (runnerOwnsLiveOperation(record, this.now())) return;

    if (this.recoverDetached) {
      const recovered = await this.recoverDetached(recoveryRecord(record, record.actorId));
      if (recovered && recovered.status !== "running") {
        await this.stageTerminal(operationId, recovered.status, recovered.summary);
        await this.finalizePendingTerminal(operationId);
        return;
      }
      if (recovered) {
        await this.updateRecord(operationId, (current) => {
          current.phase = safePhase(recovered.phase);
          current.progress = boundedProgress(recovered.progress);
          current.summary = safeSummary(recovered.summary, "Durable MCP operation is running outside this MCP process.");
          current.updatedAt = this.now().toISOString();
        });
        return;
      }
    }
    if (Date.parse(record.expiresAt) <= this.now().getTime()) {
      await this.stageTerminal(
        operationId,
        "failed",
        "The interrupted durable MCP operation expired without an authoritative terminal result.",
        "interrupted",
      );
      await this.finalizePendingTerminal(operationId);
      return;
    }
    await this.updateRecord(operationId, (current) => {
      current.phase = "detached";
      current.summary = "Durable runtime work continues outside this MCP process; poll for reconciliation.";
      current.updatedAt = this.now().toISOString();
    });
    record = await this.readRecord(operationId);
  }

  private async readRecord(operationId: string): Promise<StoredOperation> {
    const state = await this.readAndCleanState();
    const record = state.operations.find((operation) => operation.operationId === operationId);
    if (!record) throw new McpOperationError("operation_not_found", "The durable MCP operation was not found.");
    return record;
  }

  private async updateRecord(operationId: string, update: (record: StoredOperation) => void): Promise<void> {
    await this.mutateState((state) => {
      const record = state.operations.find((operation) => operation.operationId === operationId);
      if (!record) throw new McpOperationError("operation_not_found", "The durable MCP operation was not found.");
      update(record);
    });
  }

  private async readAndCleanState(): Promise<OperationState> {
    return await withStateLock(this.workspaceRoot, async () => {
      const state = await readState(this.workspaceRoot);
      const changed = cleanupState(state, this.now());
      if (changed) await writeState(this.workspaceRoot, state);
      return state;
    });
  }

  private async mutateState(update: (state: OperationState) => void): Promise<void> {
    await withStateLock(this.workspaceRoot, async () => {
      const state = await readState(this.workspaceRoot);
      cleanupState(state, this.now());
      update(state);
      trimState(state);
      await writeState(this.workspaceRoot, state);
    });
  }
}

export function mcpOperationStatePath(workspaceRoot: string): string {
  return path.join(workspaceRoot, ".service-lasso", "mcp", "operations.json");
}

export function isDurableMcpAction(action: McpGuardedActionName): boolean {
  return new Set<McpGuardedActionName>([
    "service_install",
    "service_configure",
    "setup_step_run",
    "update_check",
    "update_download",
    "update_install",
    "runtime_start_all",
    "runtime_stop_all",
  ]).has(action);
}

export function isSafelyCancellableMcpAction(action: McpGuardedActionName): boolean {
  return action === "update_check" || action === "update_download";
}

function requiredAuthorization(authorization: McpHttpAuthorization | undefined): McpHttpAuthorization {
  if (!authorization?.actor.actorId || !authorization.actor.clientId) {
    throw new McpOperationError("authorization_required", "A validated MCP identity is required for durable operations.");
  }
  return authorization;
}

function assertCanInspect(record: StoredOperation, authorization: McpHttpAuthorization): void {
  if (record.actorId === storedIdentity(authorization.actor.actorId, "actor")) return;
  if (authorization.actor.permissionProfile === "administrator") return;
  throw new McpOperationError("operation_not_found", "The durable MCP operation was not found.");
}

function assertCanCancel(record: StoredOperation, authorization: McpHttpAuthorization): void {
  const policy = guardedActionPolicy(record.action);
  if (
    profileRank[authorization.actor.permissionProfile] < profileRank[policy.requiredProfile] ||
    !authorization.actor.scopes.includes(policy.requiredScope)
  ) {
    throw new McpOperationError("forbidden", "The validated identity cannot cancel this durable operation.");
  }
}

function normalizeOperationId(value: string): string {
  const normalized = value.trim();
  if (!OPERATION_ID_PATTERN.test(normalized)) {
    throw new McpOperationError("invalid_request", "operationId must be an opaque Service Lasso operation id.");
  }
  return normalized;
}

function normalizeTargets(values: string[]): string[] {
  if (values.some((value) => !SAFE_TARGET_PATTERN.test(value))) {
    throw new McpOperationError("invalid_request", "Durable operation targets must be allowlisted Service Lasso ids.");
  }
  const targets = [...new Set(values)].sort();
  if (targets.length > 100) throw new McpOperationError("invalid_request", "Durable operation target count exceeds the limit.");
  return targets;
}

function normalizeGuardedExecutionId(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  if (!/^[0-9a-f]{64}$/u.test(value)) {
    throw new McpOperationError("invalid_request", "Guarded execution identity is invalid.");
  }
  return value;
}

function sameTargets(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function storedIdentity(value: string, kind: "actor" | "client"): string {
  if (!absolutePathLikePattern.test(value) && !secretLikePattern.test(value)) return value;
  const digest = createHash("sha256").update(`${kind}\0${value}`, "utf8").digest("hex").slice(0, 32);
  return `mcp-${kind}-${digest}`;
}

function publicRecord(record: StoredOperation, actorId: string): McpOperationPublicRecord {
  return {
    operationId: record.operationId,
    action: record.action,
    status: record.status,
    phase: record.phase,
    progress: record.progress,
    summary: record.summary,
    createdAt: record.createdAt,
    startedAt: record.startedAt,
    updatedAt: record.updatedAt,
    completedAt: record.completedAt,
    expiresAt: record.expiresAt,
    targetIds: [...record.targetIds],
    correlationId: record.correlationId,
    cancellationSupported: record.cancellationSupported,
    outcome: record.outcome,
    ownership: record.actorId === storedIdentity(actorId, "actor") ? "own" : "other",
  };
}

function recoveryRecord(record: StoredOperation, actorId: string): McpOperationRecoveryRecord {
  return {
    ...publicRecord(record, actorId),
    guardedExecutionId: record.guardedExecutionId,
  };
}

function operationSafety(mutating: boolean): McpOperationSafety {
  return {
    mutating,
    redacted: true,
    omittedSensitiveFields: [
      "raw commands and subprocess output",
      "logs and unbounded errors",
      "credentials, tokens, cookies, and secret values",
      "configuration bodies and environment values",
      "absolute workspace, service, artifact, and log paths",
      "confirmation phrases and idempotency keys",
    ],
  };
}

function cancellationPayload(
  record: StoredOperation,
  actorId: string,
  result: McpOperationCancellationResult,
  now: Date,
): McpOperationCancelPayload {
  return {
    contractVersion: MCP_OPERATION_CONTRACT_VERSION,
    generatedAt: now.toISOString(),
    operation: publicRecord(record, actorId),
    cancellation: { result, terminal: isTerminal(record.status) },
    safety: operationSafety(result === "requested"),
  };
}

function safeSummary(value: unknown, fallback: string): string {
  if (typeof value !== "string" || !value.trim() || secretLikePattern.test(value)) return fallback;
  return value
    .trim()
    .replace(/[\r\n\t]+/gu, " ")
    .replace(/file:\/\/\/?[^\s"']+/giu, "[REDACTED_PATH]")
    .replace(/(^|[^A-Za-z0-9])(?:[A-Za-z]:[\\/]|\\\\)[^\s"']+/gu, "$1[REDACTED_PATH]")
    .replace(/(^|[\s("'=,;|{}\[\]-]|:(?=\/[^/]))\/(?:[^\s"'<>/]+\/)*[^\s"'<>/]+/gu, "$1[REDACTED_PATH]")
    .slice(0, 300);
}

function safePhase(value: unknown): string {
  return typeof value === "string" && /^[a-z][a-z0-9_]{0,63}$/u.test(value) ? value : "running";
}

function safeReason(value: unknown): string {
  return typeof value === "string" && /^[a-z][a-z0-9_]{0,63}$/u.test(value) ? value : "operator_requested";
}

function boundedProgress(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(99, Math.round(value))) : 50;
}

function boundedInteger(value: number | undefined, fallback: number, minimum: number, maximum: number): number {
  return typeof value === "number" && Number.isInteger(value) && value >= minimum && value <= maximum ? value : fallback;
}

function terminalSummary(outcome: McpOperationOutcome): string {
  if (outcome === "succeeded") return "Durable MCP operation completed.";
  if (outcome === "cancelled") return "Durable MCP operation cancelled.";
  if (outcome === "skipped") return "Durable MCP operation skipped safely.";
  return "Durable MCP operation failed safely.";
}

function isTerminal(status: McpOperationStatus): status is McpOperationOutcome {
  return status === "succeeded" || status === "failed" || status === "cancelled" || status === "skipped";
}

function operationKey(workspaceRoot: string, operationId: string): string {
  return `${path.resolve(workspaceRoot)}\0${operationId}`;
}

function runnerOwnsLiveOperation(record: StoredOperation, now: Date): boolean {
  return processIsAlive(record.runnerPid) && now.getTime() - Date.parse(record.heartbeatAt) <= RUNNER_HEARTBEAT_STALE_MS;
}

function cleanupState(state: OperationState, now: Date): boolean {
  const before = state.operations.length;
  state.operations = state.operations.filter((operation) => !isTerminal(operation.status) || Date.parse(operation.expiresAt) > now.getTime());
  trimState(state);
  return before !== state.operations.length;
}

function trimState(state: OperationState): void {
  if (state.operations.length <= MAX_MCP_OPERATIONS) return;
  const active = state.operations.filter((operation) => !isTerminal(operation.status));
  const terminal = state.operations
    .filter((operation) => isTerminal(operation.status))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  state.operations = [...active, ...terminal.slice(0, Math.max(0, MAX_MCP_OPERATIONS - active.length))];
}

async function readState(workspaceRoot: string): Promise<OperationState> {
  const statePath = mcpOperationStatePath(workspaceRoot);
  let identity: string | null = null;
  try {
    const info = await stat(statePath);
    identity = `${info.dev}:${info.ino}:${info.size}:${info.mtimeMs}:${info.ctimeMs}`;
  } catch (error) {
    if (!isNodeError(error) || error.code !== "ENOENT") {
      throw new McpOperationError("operation_state_unavailable", "Durable MCP operation state is unavailable.");
    }
  }
  if (identity === null) {
    stateCache.delete(statePath);
    return { version: STATE_VERSION, operations: [] };
  }
  const cached = stateCache.get(statePath);
  if (cached?.identity === identity) return structuredClone(cached.state);
  let raw: unknown;
  try {
    raw = await readPrivateJson(workspaceRoot, statePath);
  } catch {
    throw new McpOperationError("operation_state_unavailable", "Durable MCP operation state is unavailable.");
  }
  if (raw === null) {
    stateCache.delete(statePath);
    throw new McpOperationError("operation_state_unavailable", "Durable MCP operation state is unavailable.");
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw invalidState();
  const state = raw as { version?: unknown; operations?: unknown };
  if (state.version !== STATE_VERSION || !Array.isArray(state.operations)) throw invalidState();
  const parsed: OperationState = {
    version: STATE_VERSION,
    operations: state.operations.map(parseStoredOperation),
  };
  stateCache.set(statePath, { identity, state: structuredClone(parsed) });
  return parsed;
}

function parseStoredOperation(raw: unknown): StoredOperation {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw invalidState();
  const record = raw as Partial<StoredOperation>;
  if (
    typeof record.operationId !== "string" || !OPERATION_ID_PATTERN.test(record.operationId) ||
    typeof record.actorId !== "string" || !record.actorId || record.actorId.length > 200 ||
    typeof record.clientId !== "string" || !record.clientId || record.clientId.length > 200 ||
    typeof record.action !== "string" ||
    !["service_start", "service_stop", "service_restart", "service_install", "service_configure", "setup_step_run", "update_check", "update_download", "update_install", "runtime_start_all", "runtime_stop_all"].includes(record.action) ||
    typeof record.status !== "string" || !["queued", "running", "cancelling", "succeeded", "failed", "cancelled", "skipped"].includes(record.status) ||
    typeof record.phase !== "string" || !/^[a-z][a-z0-9_]{0,63}$/u.test(record.phase) ||
    typeof record.progress !== "number" || !Number.isInteger(record.progress) || record.progress < 0 || record.progress > 100 ||
    typeof record.summary !== "string" || !record.summary || record.summary.length > 300 ||
    !isIso(record.createdAt) || !(record.startedAt === null || isIso(record.startedAt)) || !isIso(record.updatedAt) ||
    !(record.completedAt === null || isIso(record.completedAt)) || !isIso(record.expiresAt) ||
    !Array.isArray(record.targetIds) || record.targetIds.some((target) => typeof target !== "string" || !SAFE_TARGET_PATTERN.test(target)) ||
    new Set(record.targetIds).size !== record.targetIds.length ||
    typeof record.correlationId !== "string" || !/^mcp-operation-correlation-[0-9a-f-]{36}$/u.test(record.correlationId) ||
    typeof record.cancellationSupported !== "boolean" ||
    !(record.outcome === null || (typeof record.outcome === "string" && ["succeeded", "failed", "cancelled", "skipped"].includes(record.outcome))) ||
    typeof record.runnerPid !== "number" || !Number.isSafeInteger(record.runnerPid) || record.runnerPid <= 0 ||
    typeof record.runnerInstanceId !== "string" || !/^[0-9a-f-]{36}$/u.test(record.runnerInstanceId) ||
    !isIso(record.heartbeatAt) ||
    !(record.guardedExecutionId === null || typeof record.guardedExecutionId === "string" && /^[0-9a-f]{64}$/u.test(record.guardedExecutionId)) ||
    !(record.pendingTerminal === null || isPendingTerminal(record.pendingTerminal))
  ) throw invalidState();
  return record as StoredOperation;
}

function isPendingTerminal(value: unknown): value is PendingTerminal {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const pending = value as Partial<PendingTerminal>;
  return (
    typeof pending.status === "string" && ["succeeded", "failed", "cancelled", "skipped"].includes(pending.status) &&
    typeof pending.phase === "string" && ["completed", "failed", "cancelled", "skipped", "replayed", "interrupted"].includes(pending.phase) &&
    pending.progress === 100 && typeof pending.summary === "string" && pending.summary.length > 0 && pending.summary.length <= 300 &&
    isIso(pending.completedAt)
  );
}

function invalidState(): McpOperationError {
  return new McpOperationError("operation_state_invalid", "Durable MCP operation state is invalid.");
}

function isIso(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}

async function writeState(workspaceRoot: string, state: OperationState): Promise<void> {
  const statePath = mcpOperationStatePath(workspaceRoot);
  try {
    await writePrivateJson(workspaceRoot, statePath, state);
    const info = await stat(statePath);
    const identity = `${info.dev}:${info.ino}:${info.size}:${info.mtimeMs}:${info.ctimeMs}`;
    stateCache.set(statePath, { identity, state: structuredClone(state) });
  } catch {
    throw new McpOperationError("operation_state_unavailable", "Durable MCP operation state is unavailable.");
  }
}

async function auditOperation(
  workspaceRoot: string,
  record: StoredOperation,
  event: "started" | "cancellation" | McpOperationOutcome,
  reason: string,
  options: { actorId?: string; clientId?: string; denied?: boolean; eventId?: string } = {},
): Promise<void> {
  try {
    await appendAuditEvent({
      eventId: options.eventId,
      workspaceRoot,
      source: "runtime-mcp",
      action: `mcp.operation.${event}`,
      actor: options.actorId ? storedIdentity(options.actorId, "actor") : record.actorId,
      subject: record.operationId,
      method: "MCP",
      routeTemplate: `operation:${event}`,
      outcome: event === "failed" || options.denied ? "failure" : "success",
      statusCode: options.denied ? 403 : event === "failed" ? 500 : 200,
      summary: event === "cancellation" ? "Durable MCP operation cancellation attempted." : `Durable MCP operation ${event}.`,
      reason,
      correlationId: record.correlationId,
      metadata: {
        clientId: options.clientId ? storedIdentity(options.clientId, "client") : record.clientId,
        operationId: record.operationId,
        action: record.action,
        targetIds: record.targetIds,
        targetCount: record.targetIds.length,
        cancellationSupported: record.cancellationSupported,
      },
    });
  } catch {
    throw new McpOperationError("mcp_operation_audit_unavailable", "Durable MCP operation Audit is unavailable.");
  }
}

function terminalAuditEventId(record: StoredOperation, pending: PendingTerminal): string {
  const digest = createHash("sha256")
    .update(`${record.operationId}\0${record.correlationId}\0${pending.status}\0${pending.phase}\0${pending.completedAt}`, "utf8")
    .digest("hex");
  return `mcp-operation-terminal-${digest}`;
}

async function withStateLock<T>(workspaceRoot: string, work: () => Promise<T>): Promise<T> {
  const statePath = mcpOperationStatePath(workspaceRoot);
  const previous = stateQueues.get(statePath) ?? Promise.resolve();
  let release: () => void = () => {};
  const queued = new Promise<void>((resolve) => { release = resolve; });
  const chain = previous.then(() => queued);
  stateQueues.set(statePath, chain);
  await previous;
  const lockPath = `${statePath}.lock`;
  const deadline = Date.now() + STATE_LOCK_TIMEOUT_MS;
  const nonce = randomBytes(16).toString("hex");
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    await mkdir(path.dirname(statePath), { recursive: true, mode: 0o700 });
    while (!handle) {
      if (await stateLockRecoveryInProgress(lockPath)) {
        if (Date.now() >= deadline) {
          throw new McpOperationError("operation_state_unavailable", "Durable MCP operation state is busy.");
        }
        await delay(20 + Math.floor(Math.random() * 31));
        continue;
      }
      try {
        handle = await open(lockPath, "wx", 0o600);
        await handle.writeFile(JSON.stringify({ pid: process.pid, nonce, createdAt: new Date().toISOString() }), "utf8");
        if (await stateLockRecoveryInProgress(lockPath)) {
          await handle.close();
          handle = null;
          await removeOwnedLock(lockPath, nonce);
          await delay(20 + Math.floor(Math.random() * 31));
        }
      } catch (error) {
        if (!isNodeError(error) || error.code !== "EEXIST") throw error;
        await recoverStaleLock(lockPath);
        if (Date.now() >= deadline) {
          throw new McpOperationError("operation_state_unavailable", "Durable MCP operation state is busy.");
        }
        await delay(20 + Math.floor(Math.random() * 31));
      }
    }
    return await work();
  } catch (error) {
    if (error instanceof McpOperationError) throw error;
    throw new McpOperationError("operation_state_unavailable", "Durable MCP operation state is unavailable.");
  } finally {
    await handle?.close().catch(() => undefined);
    await removeOwnedLock(lockPath, nonce);
    release();
    if (stateQueues.get(statePath) === chain) stateQueues.delete(statePath);
  }
}

async function recoverStaleLock(lockPath: string): Promise<void> {
  const recoveryPath = `${lockPath}.recovery`;
  const recoveryNonce = randomBytes(16).toString("hex");
  let recoveryHandle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    recoveryHandle = await open(recoveryPath, "wx", 0o600);
    await recoveryHandle.writeFile(JSON.stringify({
      pid: process.pid,
      nonce: recoveryNonce,
      createdAt: new Date().toISOString(),
    }), "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "EEXIST") return;
    throw error;
  }
  try {
    let inspectedHandle: Awaited<ReturnType<typeof open>> | null = null;
    try {
      inspectedHandle = await open(lockPath, "r");
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") return;
      throw error;
    }
    try {
      const inspectedStat = await inspectedHandle.stat();
      if (Date.now() - inspectedStat.mtimeMs < STATE_LOCK_STALE_MS) return;
      let inspectedOwner: { pid?: unknown; nonce?: unknown } = {};
      try {
        inspectedOwner = JSON.parse(await inspectedHandle.readFile("utf8")) as { pid?: unknown; nonce?: unknown };
      } catch {
        // A malformed stale lock has no trustworthy live owner and is recoverable.
      }
      const ownerPid = typeof inspectedOwner.pid === "number" && Number.isSafeInteger(inspectedOwner.pid) && inspectedOwner.pid > 0
        ? inspectedOwner.pid
        : null;
      if (ownerPid !== null && processIsAlive(ownerPid)) return;
      const claimedPath = `${lockPath}.stale-${process.pid}-${randomBytes(8).toString("hex")}`;
      try {
        await rename(lockPath, claimedPath);
      } catch (error) {
        if (isNodeError(error) && error.code === "ENOENT") return;
        throw error;
      }
      const claimedStat = await stat(claimedPath);
      let claimedOwner: { nonce?: unknown } = {};
      try {
        claimedOwner = JSON.parse(await readFile(claimedPath, "utf8")) as { nonce?: unknown };
      } catch {
        // File metadata still identifies the claimed malformed lock.
      }
      const sameFile = inspectedStat.dev === claimedStat.dev && inspectedStat.ino !== 0 && inspectedStat.ino === claimedStat.ino;
      const sameFallbackIdentity = inspectedStat.size === claimedStat.size && inspectedStat.mtimeMs === claimedStat.mtimeMs;
      const sameNonce = typeof inspectedOwner.nonce !== "string" || claimedOwner.nonce === inspectedOwner.nonce;
      if (!(sameFile || sameFallbackIdentity) || !sameNonce) {
        await rename(claimedPath, lockPath).catch(() => undefined);
        return;
      }
      await rm(claimedPath, { force: true });
    } finally {
      await inspectedHandle.close();
    }
  } finally {
    if (recoveryHandle) {
      await recoveryHandle.close().catch(() => undefined);
      await removeOwnedLock(recoveryPath, recoveryNonce);
    }
  }
}

async function stateLockRecoveryInProgress(lockPath: string): Promise<boolean> {
  const recoveryPath = `${lockPath}.recovery`;
  let inspectedHandle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    inspectedHandle = await open(recoveryPath, "r");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return false;
    throw error;
  }
  try {
    const inspectedStat = await inspectedHandle.stat();
    if (Date.now() - inspectedStat.mtimeMs < STATE_LOCK_STALE_MS) return true;
    let inspectedOwner: { pid?: unknown; nonce?: unknown } = {};
    try {
      inspectedOwner = JSON.parse(await inspectedHandle.readFile("utf8")) as { pid?: unknown; nonce?: unknown };
    } catch {
      // A malformed stale recovery sentinel has no trustworthy live owner.
    }
    const ownerPid = typeof inspectedOwner.pid === "number" && Number.isSafeInteger(inspectedOwner.pid) && inspectedOwner.pid > 0
      ? inspectedOwner.pid
      : null;
    if (ownerPid !== null && processIsAlive(ownerPid)) return true;
    const claimedPath = `${recoveryPath}.stale-${process.pid}-${randomBytes(8).toString("hex")}`;
    try {
      await rename(recoveryPath, claimedPath);
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") return false;
      throw error;
    }
    const claimedStat = await stat(claimedPath);
    let claimedOwner: { nonce?: unknown } = {};
    try {
      claimedOwner = JSON.parse(await readFile(claimedPath, "utf8")) as { nonce?: unknown };
    } catch {
      // File metadata still identifies the claimed malformed sentinel.
    }
    const sameFile = inspectedStat.dev === claimedStat.dev && inspectedStat.ino !== 0 && inspectedStat.ino === claimedStat.ino;
    const sameFallbackIdentity = inspectedStat.size === claimedStat.size && inspectedStat.mtimeMs === claimedStat.mtimeMs;
    const sameNonce = typeof inspectedOwner.nonce !== "string" || claimedOwner.nonce === inspectedOwner.nonce;
    if (!(sameFile || sameFallbackIdentity) || !sameNonce) {
      await rename(claimedPath, recoveryPath).catch(() => undefined);
      return true;
    }
    await rm(claimedPath, { force: true });
    return false;
  } finally {
    await inspectedHandle.close();
  }
}

async function removeOwnedLock(lockPath: string, nonce: string): Promise<void> {
  try {
    const owner = JSON.parse(await readFile(lockPath, "utf8")) as { nonce?: unknown };
    if (owner.nonce === nonce) await rm(lockPath, { force: true });
  } catch (error) {
    if (!isNodeError(error) || error.code !== "ENOENT") return;
  }
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return isNodeError(error) && error.code === "EPERM";
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
