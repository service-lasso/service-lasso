import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { appendAuditEvent } from "../audit/store.js";
import { readPrivateJson, writePrivateJson } from "../security/private-json.js";
import type { McpHttpAuthorization, McpPermissionProfile } from "./mcp-auth.js";

export const MCP_GUARDED_ACTION_NAMES = [
  "service_start",
  "service_stop",
  "service_restart",
  "service_install",
  "service_configure",
  "setup_step_run",
  "update_check",
  "update_download",
  "update_install",
  "runtime_start_all",
  "runtime_stop_all",
] as const;

export type McpGuardedActionName = typeof MCP_GUARDED_ACTION_NAMES[number];
export type McpGuardedActionStatus = "preflight" | "succeeded" | "failed" | "skipped" | "replayed";

export interface McpGuardedActionParameters {
  serviceId?: string;
  stepId?: string;
  force?: boolean;
}

export interface McpGuardedActionPlan {
  action: McpGuardedActionName;
  targets: string[];
  effects: string[];
  executable: boolean;
  skippedReason: string | null;
  /** Internal revision binding used by the shared facade; never exposed raw. */
  revision?: string;
}

export interface McpGuardedActionServiceState {
  serviceId: string;
  installed: boolean;
  configured: boolean;
  running: boolean;
}

export interface McpGuardedActionFacadeResult {
  ok: boolean;
  status: "succeeded" | "failed" | "skipped";
  targets: string[];
  effects: string[];
  summary: string;
  resultingState: McpGuardedActionServiceState[];
}

export interface McpGuardedActionExecutionOptions {
  signal?: AbortSignal;
  reportProgress?: (update: McpGuardedActionProgressUpdate) => Promise<void>;
}

export interface McpGuardedActionProgressUpdate {
  phase: string;
  progress: number;
  summary: string;
  targetIds?: string[];
}

/**
 * The runtime owns this facade. MCP receives only this narrow application
 * boundary and never loops back through HTTP or reimplements lifecycle work.
 */
export interface McpGuardedActionFacade {
  preflight(action: McpGuardedActionName, parameters: McpGuardedActionParameters): Promise<McpGuardedActionPlan>;
  execute(
    action: McpGuardedActionName,
    parameters: McpGuardedActionParameters,
    approvedPlan: McpGuardedActionPlan,
    options?: McpGuardedActionExecutionOptions,
  ): Promise<McpGuardedActionFacadeResult>;
  snapshot?(targets: string[]): Promise<McpGuardedActionServiceState[]>;
}

export interface McpGuardedActionInput extends McpGuardedActionParameters {
  execute?: boolean;
  idempotencyKey?: string;
  confirmationId?: string;
  confirmationPhrase?: string;
  confirmationTtlSeconds?: number;
}

export interface McpGuardedActionResponse {
  contractVersion: "service-lasso-mcp-guarded-action.v1";
  generatedAt: string;
  action: McpGuardedActionName;
  status: McpGuardedActionStatus;
  ok: boolean;
  correlationId: string;
  preflight: {
    planId: string;
    targets: string[];
    effects: string[];
    executable: boolean;
    skippedReason: string | null;
    requiredProfile: McpPermissionProfile;
  };
  confirmation: {
    required: boolean;
    id: string | null;
    status: "not_required" | "pending" | "consumed";
    expiresAt: string | null;
    confirmationPhrase?: string;
  };
  idempotency: {
    keyId: string | null;
    replayed: boolean;
  };
  summary: string;
  result: {
    targets: string[];
    effects: string[];
    resultingState: McpGuardedActionServiceState[];
  } | null;
  safety: {
    mutating: boolean;
    redacted: true;
    omittedSensitiveFields: string[];
  };
}

interface StoredConfirmation {
  id: string;
  action: McpGuardedActionName;
  actorId: string;
  clientId: string;
  targetFingerprint: string;
  parameterFingerprint: string;
  planFingerprint: string;
  phraseHash: string;
  issuedAt: string;
  expiresAt: string;
  status: "pending" | "claimed" | "completed" | "expired";
  correlationId: string;
}

interface StoredIdempotencyRecord {
  keyId: string;
  actorId: string;
  clientId: string;
  requestFingerprint: string;
  status: "in_progress" | "succeeded" | "failed" | "skipped";
  correlationId: string;
  response: McpGuardedActionResponse | null;
  pendingResponse: McpGuardedActionResponse | null;
  createdAt: string;
  completedAt: string | null;
}

interface GuardedActionState {
  version: 1;
  confirmations: StoredConfirmation[];
}

type GuardedActionClaim =
  | { replay: McpGuardedActionResponse }
  | { pendingTerminal: McpGuardedActionResponse }
  | { claimedConfirmationId: string | null };

interface ActionPolicy {
  requiredProfile: McpPermissionProfile;
  requiredScope: string;
  confirmationRequired: boolean;
}

const STATE_VERSION = 1;
const MAX_CONFIRMATIONS = 64;
const DEFAULT_CONFIRMATION_TTL_SECONDS = 300;
const MAX_CONFIRMATION_TTL_SECONDS = 900;
const IDEMPOTENCY_KEY_PATTERN = /^(?!(?:AKIA|ASIA)[A-Z0-9]{16}$)(?!gh[pousr]_)(?!xox[a-z]-)(?![A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}$)[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$/u;
const CONFIRMATION_ID_PATTERN = /^mcp-confirmation-[0-9a-f-]{36}$/u;
const secretLikePattern = /(?:bearer\s+[A-Za-z0-9._~+/=-]+)|(?:gh[pousr]_[A-Za-z0-9_]+)|(?:xox[a-z]-[A-Za-z0-9-]+)|(?:(?:AKIA|ASIA)[A-Z0-9]{16})|(?:[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})|(?:(?:password|passwd|secret|token|cookie|credential|private[_-]?key)\s*[:=]\s*[^\s,;]+)/iu;
const stateQueues = new Map<string, Promise<void>>();
const STATE_LOCK_TIMEOUT_MS = 15_000;
const STATE_LOCK_STALE_MS = 60_000;

const policyByAction: Record<McpGuardedActionName, ActionPolicy> = {
  service_start: { requiredProfile: "operator", requiredScope: "service-lasso:lifecycle:write", confirmationRequired: true },
  service_stop: { requiredProfile: "operator", requiredScope: "service-lasso:lifecycle:write", confirmationRequired: true },
  service_restart: { requiredProfile: "operator", requiredScope: "service-lasso:lifecycle:write", confirmationRequired: true },
  service_install: { requiredProfile: "maintainer", requiredScope: "service-lasso:config:write", confirmationRequired: true },
  service_configure: { requiredProfile: "maintainer", requiredScope: "service-lasso:config:write", confirmationRequired: true },
  setup_step_run: { requiredProfile: "maintainer", requiredScope: "service-lasso:config:write", confirmationRequired: true },
  update_check: { requiredProfile: "maintainer", requiredScope: "service-lasso:update:write", confirmationRequired: false },
  update_download: { requiredProfile: "maintainer", requiredScope: "service-lasso:update:write", confirmationRequired: true },
  update_install: { requiredProfile: "maintainer", requiredScope: "service-lasso:update:write", confirmationRequired: true },
  runtime_start_all: { requiredProfile: "administrator", requiredScope: "service-lasso:runtime:admin", confirmationRequired: true },
  runtime_stop_all: { requiredProfile: "administrator", requiredScope: "service-lasso:runtime:admin", confirmationRequired: true },
};

const profileRank: Record<McpPermissionProfile, number> = {
  observer: 0,
  operator: 1,
  maintainer: 2,
  administrator: 3,
};

export class McpGuardedActionError extends Error {
  constructor(public readonly code: McpGuardedActionErrorCode, message: string) {
    super(message);
    this.name = "McpGuardedActionError";
  }
}

export type McpGuardedActionErrorCode =
  | "authorization_required"
  | "confirmation_action_mismatch"
  | "confirmation_actor_mismatch"
  | "confirmation_already_used"
  | "confirmation_expired"
  | "confirmation_not_found"
  | "confirmation_parameter_mismatch"
  | "confirmation_phrase_mismatch"
  | "confirmation_plan_mismatch"
  | "confirmation_required"
  | "confirmation_target_mismatch"
  | "confirmation_capacity"
  | "feature_unavailable"
  | "guarded_action_state_invalid"
  | "idempotency_conflict"
  | "idempotency_in_progress"
  | "idempotency_state_unavailable"
  | "insufficient_profile"
  | "insufficient_scope"
  | "invalid_idempotency_key"
  | "invalid_request"
  | "mcp_audit_unavailable"
  | "mcp_read_only_mode"
  | "preflight_failed";

export function guardedActionStatePath(workspaceRoot: string): string {
  return path.join(workspaceRoot, ".service-lasso", "mcp", "guarded-actions.json");
}

export function guardedActionIdempotencyPath(
  workspaceRoot: string,
  actorId: string,
  clientId: string,
  idempotencyKey: string,
): string {
  return guardedActionExecutionPath(workspaceRoot, guardedActionExecutionId(actorId, clientId, idempotencyKey));
}

export function guardedActionExecutionId(actorId: string, clientId: string, idempotencyKey: string): string {
  const normalized = normalizeIdempotencyKey(idempotencyKey);
  if (!normalized) {
    throw new McpGuardedActionError("invalid_idempotency_key", "Execution requires a bounded idempotency key of at least eight safe characters.");
  }
  return fingerprint({ actorId, clientId, idempotencyKey: normalized });
}

function guardedActionExecutionPath(workspaceRoot: string, executionId: string): string {
  if (!/^[0-9a-f]{64}$/u.test(executionId)) {
    throw new McpGuardedActionError("guarded_action_state_invalid", "Guarded action execution identity is invalid.");
  }
  return path.join(workspaceRoot, ".service-lasso", "mcp", "idempotency", `${executionId}.json`);
}

export function guardedActionPolicy(action: McpGuardedActionName): Readonly<ActionPolicy> {
  return policyByAction[action];
}

export async function assertMcpGuardedActionAuthorization(input: {
  workspaceRoot: string;
  operatingMode: "disabled" | "read-only" | "guarded";
  authorization: McpHttpAuthorization | undefined;
  action: McpGuardedActionName;
  correlationId?: string;
}): Promise<void> {
  const correlationId = input.correlationId ?? `mcp-action-${randomUUID()}`;
  if (!input.authorization) {
    await audit(input.workspaceRoot, input.action, "denied", "mcp-unauthenticated", "mcp-unauthenticated", correlationId, [], "authorization_required");
    throw new McpGuardedActionError("authorization_required", "A validated MCP identity is required.");
  }
  try {
    assertAuthorized(input.operatingMode, input.authorization, policyByAction[input.action]);
  } catch (error) {
    await audit(
      input.workspaceRoot,
      input.action,
      "denied",
      input.authorization.actor.actorId,
      input.authorization.actor.clientId,
      correlationId,
      [],
      error instanceof McpGuardedActionError ? error.code : "forbidden",
    );
    throw error;
  }
}

export async function readMcpGuardedActionExecution(input: {
  workspaceRoot: string;
  executionId: string;
  expectedCorrelationId: string;
}): Promise<McpGuardedActionResponse | null> {
  const statePath = guardedActionStatePath(input.workspaceRoot);
  const idempotencyPath = guardedActionExecutionPath(input.workspaceRoot, input.executionId);
  const existing = await withStateLock(statePath, async () =>
    await readIdempotencyRecord(input.workspaceRoot, idempotencyPath));
  if (!existing || existing.correlationId !== input.expectedCorrelationId) return null;
  if (existing.response) return existing.response;
  if (!existing.pendingResponse) return null;
  return await finalizePendingTerminal({
    workspaceRoot: input.workspaceRoot,
    statePath,
    idempotencyPath,
    expectedCorrelationId: input.expectedCorrelationId,
  });
}

export async function auditMcpGuardedActionSchemaDenial(input: {
  workspaceRoot: string;
  authorization: McpHttpAuthorization;
  action: McpGuardedActionName;
  parameters: unknown;
}): Promise<void> {
  const parameters = input.parameters && typeof input.parameters === "object" && !Array.isArray(input.parameters)
    ? input.parameters as McpGuardedActionParameters
    : {};
  await audit(
    input.workspaceRoot,
    input.action,
    "denied",
    input.authorization.actor.actorId,
    input.authorization.actor.clientId,
    `mcp-action-${randomUUID()}`,
    safeTargetIds(parameters),
    "invalid_request",
  );
}

export async function invokeMcpGuardedAction(input: {
  workspaceRoot: string | undefined;
  operatingMode: "disabled" | "read-only" | "guarded";
  authorization: McpHttpAuthorization | undefined;
  facade: McpGuardedActionFacade | undefined;
  action: McpGuardedActionName;
  parameters: McpGuardedActionInput;
  now?: () => Date;
  correlationId?: string;
  signal?: AbortSignal;
  reportProgress?: McpGuardedActionExecutionOptions["reportProgress"];
}): Promise<McpGuardedActionResponse> {
  const now = input.now ?? (() => new Date());
  const correlationId = input.correlationId ?? `mcp-action-${randomUUID()}`;
  const workspaceRoot = input.workspaceRoot;
  const authorization = input.authorization;
  const policy = policyByAction[input.action];

  if (!workspaceRoot || !input.facade) {
    throw new McpGuardedActionError("feature_unavailable", "Guarded actions are unavailable for this runtime.");
  }

  await assertMcpGuardedActionAuthorization({
    workspaceRoot,
    operatingMode: input.operatingMode,
    authorization,
    action: input.action,
    correlationId,
  });
  if (!authorization) throw new McpGuardedActionError("authorization_required", "A validated MCP identity is required.");

  let normalized: McpGuardedActionParameters;
  let idempotencyKey: string | null;
  try {
    normalized = normalizeParameters(input.action, input.parameters);
    idempotencyKey = input.parameters.execute === true
      ? normalizeIdempotencyKey(input.parameters.idempotencyKey)
      : null;
  } catch (error) {
    await audit(
      workspaceRoot,
      input.action,
      "denied",
      authorization.actor.actorId,
      authorization.actor.clientId,
      correlationId,
      safeTargetIds(input.parameters),
      error instanceof McpGuardedActionError ? error.code : "invalid_request",
    );
    throw error;
  }
  const requestFingerprint = fingerprint({ action: input.action, parameters: normalized });
  const idempotencyKeyId = idempotencyKey
    ? `mcp-idempotency-${fingerprint({
        actorId: authorization.actor.actorId,
        clientId: authorization.actor.clientId,
        idempotencyKey,
      }).slice(0, 32)}`
    : null;
  const statePath = guardedActionStatePath(workspaceRoot);
  const idempotencyPath = idempotencyKey
    ? guardedActionIdempotencyPath(workspaceRoot, authorization.actor.actorId, authorization.actor.clientId, idempotencyKey)
    : null;

  if (idempotencyKey && idempotencyPath) {
    let existing: StoredIdempotencyRecord | null;
    try {
      existing = await withStateLock(statePath, async () => {
        return await readIdempotencyRecord(workspaceRoot, idempotencyPath);
      });
    } catch (error) {
      await audit(workspaceRoot, input.action, "failed", authorization.actor.actorId, authorization.actor.clientId, correlationId, safeTargetIds(normalized), "idempotency_state_unavailable");
      throw error;
    }
    if (existing) {
      if (existing.requestFingerprint !== requestFingerprint) {
        await audit(workspaceRoot, input.action, "denied", authorization.actor.actorId, authorization.actor.clientId, correlationId, safeTargetIds(normalized), "idempotency_conflict");
        throw new McpGuardedActionError("idempotency_conflict", "The idempotency key is already bound to different action parameters.");
      }
      if (!existing.response) {
        if (existing.pendingResponse) {
          const reconciled = await finalizePendingTerminal({
            workspaceRoot,
            statePath,
            idempotencyPath,
            expectedCorrelationId: existing.correlationId,
          });
          await audit(
            workspaceRoot,
            input.action,
            "replayed",
            authorization.actor.actorId,
            authorization.actor.clientId,
            reconciled.correlationId,
            reconciled.preflight.targets,
            "idempotent_replay_after_audit_reconciliation",
          );
          return replayResponse(reconciled, now());
        }
        await audit(workspaceRoot, input.action, "denied", authorization.actor.actorId, authorization.actor.clientId, correlationId, safeTargetIds(normalized), "idempotency_in_progress");
        throw new McpGuardedActionError("idempotency_in_progress", "The idempotent action is already in progress or has an uncertain terminal state.");
      }
      await audit(
        workspaceRoot,
        input.action,
        "replayed",
        authorization.actor.actorId,
        authorization.actor.clientId,
        existing.response.correlationId,
        existing.response.preflight.targets,
        "idempotent_replay",
      );
      return replayResponse(existing.response, now());
    }
  }

  let authoritativePlan: McpGuardedActionPlan;
  let plan: McpGuardedActionPlan;
  try {
    await input.reportProgress?.({ phase: "preflight", progress: 10, summary: "Guarded action preflight is running." });
    input.signal?.throwIfAborted();
    authoritativePlan = await input.facade.preflight(input.action, normalized);
    plan = normalizePlan(input.action, authoritativePlan);
    await input.reportProgress?.({
      phase: "preflight_complete",
      progress: 15,
      summary: "Guarded action preflight completed.",
      targetIds: plan.targets,
    });
  } catch {
    await audit(workspaceRoot, input.action, "failed", authorization.actor.actorId, authorization.actor.clientId, correlationId, safeTargetIds(normalized), "preflight_failed");
    throw new McpGuardedActionError("preflight_failed", "The guarded action preflight could not be completed.");
  }

  const planFingerprint = fingerprint({
    action: authoritativePlan.action,
    targets: authoritativePlan.targets,
    effects: authoritativePlan.effects,
    executable: authoritativePlan.executable,
    skippedReason: authoritativePlan.skippedReason,
    revision: authoritativePlan.revision ?? null,
  });
  const safePlanFingerprint = fingerprint({
    action: input.action,
    targets: plan.targets,
    effects: plan.effects,
    executable: plan.executable,
    skippedReason: plan.skippedReason,
  });
  const planId = `mcp-plan-${safePlanFingerprint.slice(0, 32)}`;
  const parameterFingerprint = fingerprint(normalized);
  const targetFingerprint = fingerprint(plan.targets);
  const preflight = {
    planId,
    targets: plan.targets,
    effects: plan.effects,
    executable: plan.executable,
    skippedReason: plan.skippedReason,
    requiredProfile: policy.requiredProfile,
  };

  if (input.parameters.execute !== true) {
    let confirmation: McpGuardedActionResponse["confirmation"];
    try {
      confirmation = policy.confirmationRequired && plan.executable
        ? await issueConfirmation({
            workspaceRoot,
            action: input.action,
            authorization,
            targetFingerprint,
            parameterFingerprint,
            planFingerprint,
            correlationId,
            ttlSeconds: normalizeTtl(input.parameters.confirmationTtlSeconds),
            now,
          })
        : { required: false as const, id: null, status: "not_required" as const, expiresAt: null };
    } catch (error) {
      await audit(
        workspaceRoot,
        input.action,
        "denied",
        authorization.actor.actorId,
        authorization.actor.clientId,
        correlationId,
        plan.targets,
        error instanceof McpGuardedActionError ? error.code : "confirmation_state_unavailable",
      );
      throw error;
    }
    await audit(workspaceRoot, input.action, "preflight", authorization.actor.actorId, authorization.actor.clientId, correlationId, plan.targets, plan.executable ? "planned" : "skipped");
    return response({
      action: input.action,
      status: "preflight",
      ok: true,
      correlationId,
      preflight,
      confirmation,
      idempotencyKeyId: null,
      replayed: false,
      summary: plan.executable ? "Guarded action preflight completed." : "Guarded action preflight found no mutation to perform.",
      result: null,
    });
  }

  if (!idempotencyKey || !idempotencyPath || !idempotencyKeyId) {
    throw new McpGuardedActionError("invalid_idempotency_key", "Execution requires a bounded idempotency key of at least eight safe characters.");
  }
  const claim = await withStateLock<GuardedActionClaim>(statePath, async () => {
    const state = await readState(workspaceRoot, statePath);
    const existing = await readIdempotencyRecord(workspaceRoot, idempotencyPath);
    if (existing) {
      if (existing.requestFingerprint !== requestFingerprint) {
        throw new McpGuardedActionError("idempotency_conflict", "The idempotency key is already bound to different action parameters.");
      }
      if (existing.response) return { replay: existing.response } as const;
      throw new McpGuardedActionError("idempotency_in_progress", "The idempotent action is already in progress or has an uncertain terminal state.");
    }

    if (!plan.executable) {
      const skipped = response({
        action: input.action,
        status: "skipped",
        ok: true,
        correlationId,
        preflight,
        confirmation: { required: false, id: null, status: "not_required", expiresAt: null },
        idempotencyKeyId,
        replayed: false,
        summary: "Guarded action skipped because preflight found no mutation to perform.",
        result: {
          targets: [],
          effects: [],
          resultingState: [],
        },
      });
      const idempotency: StoredIdempotencyRecord = {
        keyId: idempotencyKeyId,
        actorId: authorization.actor.actorId,
        clientId: authorization.actor.clientId,
        requestFingerprint,
        status: "in_progress",
        correlationId,
        response: null,
        pendingResponse: skipped,
        createdAt: now().toISOString(),
        completedAt: null,
      };
      trimState(state);
      await writeState(workspaceRoot, statePath, state);
      await writeIdempotencyRecord(workspaceRoot, idempotencyPath, idempotency);
      return { pendingTerminal: skipped } as const;
    }

    let claimedConfirmationId: string | null = null;
    if (policy.confirmationRequired) {
      const confirmationId = normalizeConfirmationId(input.parameters.confirmationId);
      const phrase = normalizeConfirmationPhrase(input.parameters.confirmationPhrase);
      const record = state.confirmations.find((entry) => entry.id === confirmationId);
      try {
        validateConfirmation(record, {
          action: input.action,
          authorization,
          targetFingerprint,
          parameterFingerprint,
          planFingerprint,
          phrase,
          now: now(),
        });
      } catch (error) {
        if (record?.status === "expired") await writeState(workspaceRoot, statePath, state);
        throw error;
      }
      record.status = "claimed";
      claimedConfirmationId = record.id;
    }

    const idempotency: StoredIdempotencyRecord = {
      keyId: idempotencyKeyId,
      actorId: authorization.actor.actorId,
      clientId: authorization.actor.clientId,
      requestFingerprint,
      status: "in_progress",
      correlationId,
      response: null,
      pendingResponse: null,
      createdAt: now().toISOString(),
      completedAt: null,
    };
    trimState(state);
    await writeState(workspaceRoot, statePath, state);
    await writeIdempotencyRecord(workspaceRoot, idempotencyPath, idempotency);
    return { claimedConfirmationId } as const;
  }).catch(async (error: unknown) => {
    await audit(
      workspaceRoot,
      input.action,
      "denied",
      authorization.actor.actorId,
      authorization.actor.clientId,
      correlationId,
      plan.targets,
      error instanceof McpGuardedActionError ? error.code : "confirmation_failed",
    );
    throw error;
  });

  if ("replay" in claim) {
    await audit(workspaceRoot, input.action, "replayed", authorization.actor.actorId, authorization.actor.clientId, claim.replay.correlationId, claim.replay.preflight.targets, "idempotent_replay");
    return replayResponse(claim.replay, now());
  }

  if ("pendingTerminal" in claim) {
    return await finalizePendingTerminal({
      workspaceRoot,
      statePath,
      idempotencyPath,
      expectedCorrelationId: claim.pendingTerminal.correlationId,
    });
  }

  await audit(workspaceRoot, input.action, "started", authorization.actor.actorId, authorization.actor.clientId, correlationId, plan.targets, "authorized");
  await input.reportProgress?.({ phase: "executing", progress: 25, summary: "Guarded action is executing through the shared facade." });

  let facadeResult: McpGuardedActionFacadeResult;
  try {
    input.signal?.throwIfAborted();
    facadeResult = await input.facade.execute(input.action, normalized, authoritativePlan, {
      signal: input.signal,
      reportProgress: input.reportProgress,
    });
  } catch {
    const resultingState = input.facade.snapshot
      ? await input.facade.snapshot(plan.targets).catch(() => [])
      : [];
    facadeResult = {
      ok: false,
      status: "failed",
      targets: plan.targets,
      effects: plan.effects,
      summary: input.signal?.aborted ? "The guarded action was cancelled safely." : "The guarded action failed safely.",
      resultingState,
    };
  }
  await input.reportProgress?.({ phase: "finalizing", progress: 90, summary: "Guarded action execution is finalizing." });

  const status = facadeResult.status;
  const completed = response({
    action: input.action,
    status,
    ok: facadeResult.ok,
    correlationId,
    preflight,
    confirmation: {
      required: policy.confirmationRequired,
      id: claim.claimedConfirmationId,
      status: policy.confirmationRequired ? "consumed" : "not_required",
      expiresAt: null,
    },
    idempotencyKeyId,
    replayed: false,
    summary: safeSummary(facadeResult.summary, facadeResult.ok ? "Guarded action completed." : "Guarded action failed safely."),
    result: {
      targets: normalizeResultTargets(facadeResult.targets),
      effects: normalizeResultEffects(facadeResult.effects),
      resultingState: normalizeResultingState(facadeResult.resultingState, plan.targets),
    },
  });

  try {
    await withStateLock(statePath, async () => {
      const idempotency = await readIdempotencyRecord(workspaceRoot, idempotencyPath);
      if (
        !idempotency ||
        idempotency.actorId !== authorization.actor.actorId ||
        idempotency.clientId !== authorization.actor.clientId ||
        idempotency.requestFingerprint !== requestFingerprint ||
        idempotency.correlationId !== correlationId
      ) {
        throw new McpGuardedActionError("idempotency_state_unavailable", "The guarded action terminal state could not be persisted safely.");
      }
      idempotency.pendingResponse = completed;
      await writeIdempotencyRecord(workspaceRoot, idempotencyPath, idempotency);
    });
  } catch {
    await audit(workspaceRoot, input.action, "failed", authorization.actor.actorId, authorization.actor.clientId, correlationId, plan.targets, "idempotency_state_unavailable");
    throw new McpGuardedActionError("idempotency_state_unavailable", "The guarded action terminal state could not be persisted safely.");
  }
  return await finalizePendingTerminal({
    workspaceRoot,
    statePath,
    idempotencyPath,
    expectedCorrelationId: correlationId,
  });
}

async function finalizePendingTerminal(input: {
  workspaceRoot: string;
  statePath: string;
  idempotencyPath: string;
  expectedCorrelationId: string;
}): Promise<McpGuardedActionResponse> {
  return await withStateLock(input.statePath, async () => {
    const state = await readState(input.workspaceRoot, input.statePath);
    const idempotency = await readIdempotencyRecord(input.workspaceRoot, input.idempotencyPath);
    if (!idempotency || idempotency.correlationId !== input.expectedCorrelationId) {
      throw new McpGuardedActionError("idempotency_state_unavailable", "The guarded action terminal state could not be reconciled safely.");
    }
    if (idempotency.response) return idempotency.response;
    const completed = idempotency.pendingResponse;
    if (!completed || completed.status === "preflight" || completed.status === "replayed") {
      throw new McpGuardedActionError("idempotency_in_progress", "The idempotent action is already in progress or has an uncertain terminal state.");
    }

    await audit(
      input.workspaceRoot,
      completed.action,
      completed.status,
      idempotency.actorId,
      idempotency.clientId,
      completed.correlationId,
      completed.preflight.targets,
      completed.status === "skipped" ? completed.preflight.skippedReason ?? "preflight_skip" : completed.status,
    );

    idempotency.status = completed.status;
    idempotency.response = completed;
    idempotency.pendingResponse = null;
    idempotency.completedAt = new Date().toISOString();
    if (completed.confirmation.id) {
      const confirmation = state.confirmations.find((entry) => entry.id === completed.confirmation.id);
      if (confirmation) confirmation.status = "completed";
    }
    trimState(state);
    await writeState(input.workspaceRoot, input.statePath, state);
    await writeIdempotencyRecord(input.workspaceRoot, input.idempotencyPath, idempotency);
    return completed;
  });
}

function assertAuthorized(
  operatingMode: "disabled" | "read-only" | "guarded",
  authorization: McpHttpAuthorization,
  policy: ActionPolicy,
): void {
  if (operatingMode !== "guarded") {
    throw new McpGuardedActionError("mcp_read_only_mode", "Guarded actions require guarded MCP operating mode.");
  }
  if (profileRank[authorization.actor.permissionProfile] < profileRank[policy.requiredProfile]) {
    throw new McpGuardedActionError("insufficient_profile", "The validated MCP identity does not have the required permission profile.");
  }
  if (!authorization.actor.scopes.includes(policy.requiredScope)) {
    throw new McpGuardedActionError("insufficient_scope", "The validated MCP identity does not have the required action scope.");
  }
}

function normalizeParameters(action: McpGuardedActionName, input: McpGuardedActionInput): McpGuardedActionParameters {
  const serviceAction = !action.startsWith("runtime_");
  const serviceId = normalizeSafeId(input.serviceId, "serviceId", serviceAction);
  const stepId = normalizeSafeId(input.stepId, "stepId", action === "setup_step_run");
  if (action !== "setup_step_run" && input.stepId !== undefined) {
    throw new McpGuardedActionError("invalid_request", "stepId is accepted only by setup-step execution.");
  }
  if (action !== "update_install" && input.force !== undefined) {
    throw new McpGuardedActionError("invalid_request", "force is accepted only by update installation.");
  }
  return {
    ...(serviceId ? { serviceId } : {}),
    ...(stepId ? { stepId } : {}),
    ...(action === "update_install" && input.force !== undefined ? { force: input.force === true } : {}),
  };
}

function normalizeSafeId(value: unknown, name: string, required: boolean): string | undefined {
  if (value === undefined && !required) return undefined;
  const pattern = name === "stepId"
    ? /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,199}$/u
    : /^@?[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
  if (typeof value !== "string" || !pattern.test(value)) {
    throw new McpGuardedActionError("invalid_request", `${name} must be a bounded Service Lasso identifier.`);
  }
  return value;
}

function normalizePlan(action: McpGuardedActionName, plan: McpGuardedActionPlan): McpGuardedActionPlan {
  if (plan.action !== action || !Array.isArray(plan.targets) || !Array.isArray(plan.effects)) {
    throw new McpGuardedActionError("preflight_failed", "The action facade returned an invalid preflight.");
  }
  if (plan.targets.length > 100 || plan.effects.length > 100) {
    throw new McpGuardedActionError("preflight_failed", "The guarded action preflight exceeds the bounded target or effect limit.");
  }
  const targets = [...new Set(plan.targets.map((entry) => normalizeSafeId(entry, "target", true) as string))];
  const effects = plan.effects.map((entry) => safeSummary(entry, "Planned guarded action effect."));
  if (targets.length === 0 && plan.executable) {
    throw new McpGuardedActionError("preflight_failed", "Executable preflight must identify at least one target.");
  }
  if (plan.revision !== undefined && !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$/u.test(plan.revision)) {
    throw new McpGuardedActionError("preflight_failed", "The guarded action preflight revision is invalid.");
  }
  return {
    action,
    targets,
    effects,
    executable: plan.executable === true,
    skippedReason: plan.executable ? null : safeSummary(plan.skippedReason, "no_mutation_required"),
    ...(plan.revision ? { revision: plan.revision } : {}),
  };
}

async function issueConfirmation(input: {
  workspaceRoot: string;
  action: McpGuardedActionName;
  authorization: McpHttpAuthorization;
  targetFingerprint: string;
  parameterFingerprint: string;
  planFingerprint: string;
  correlationId: string;
  ttlSeconds: number;
  now: () => Date;
}): Promise<McpGuardedActionResponse["confirmation"]> {
  const id = `mcp-confirmation-${randomUUID()}`;
  const phrase = `confirm ${input.action.replaceAll("_", "-")} ${randomBytes(16).toString("hex")}`;
  const issuedAt = input.now();
  const expiresAt = new Date(issuedAt.getTime() + input.ttlSeconds * 1_000);
  const record: StoredConfirmation = {
    id,
    action: input.action,
    actorId: input.authorization.actor.actorId,
    clientId: input.authorization.actor.clientId,
    targetFingerprint: input.targetFingerprint,
    parameterFingerprint: input.parameterFingerprint,
    planFingerprint: input.planFingerprint,
    phraseHash: fingerprint(phrase),
    issuedAt: issuedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    status: "pending",
    correlationId: input.correlationId,
  };
  const statePath = guardedActionStatePath(input.workspaceRoot);
  await withStateLock(statePath, async () => {
    const state = await readState(input.workspaceRoot, statePath);
    state.confirmations = state.confirmations.filter((entry) =>
      entry.status === "pending" && Date.parse(entry.expiresAt) > issuedAt.getTime()
    );
    if (state.confirmations.length >= MAX_CONFIRMATIONS) {
      throw new McpGuardedActionError("confirmation_capacity", "Too many guarded confirmations are pending; allow one to expire or complete before retrying.");
    }
    state.confirmations.unshift(record);
    trimState(state);
    await writeState(input.workspaceRoot, statePath, state);
  });
  return {
    required: true,
    id,
    status: "pending",
    expiresAt: expiresAt.toISOString(),
    confirmationPhrase: phrase,
  };
}

function validateConfirmation(
  record: StoredConfirmation | undefined,
  expected: {
    action: McpGuardedActionName;
    authorization: McpHttpAuthorization;
    targetFingerprint: string;
    parameterFingerprint: string;
    planFingerprint: string;
    phrase: string;
    now: Date;
  },
): asserts record is StoredConfirmation {
  if (!record) throw new McpGuardedActionError("confirmation_not_found", "The server confirmation was not found.");
  if (record.status !== "pending") throw new McpGuardedActionError("confirmation_already_used", "The server confirmation is no longer pending.");
  if (Date.parse(record.expiresAt) <= expected.now.getTime()) {
    record.status = "expired";
    throw new McpGuardedActionError("confirmation_expired", "The server confirmation expired before execution.");
  }
  if (record.actorId !== expected.authorization.actor.actorId || record.clientId !== expected.authorization.actor.clientId) {
    throw new McpGuardedActionError("confirmation_actor_mismatch", "The server confirmation is bound to another validated actor or client.");
  }
  if (record.action !== expected.action) throw new McpGuardedActionError("confirmation_action_mismatch", "The server confirmation is bound to another action.");
  if (record.targetFingerprint !== expected.targetFingerprint) throw new McpGuardedActionError("confirmation_target_mismatch", "The server confirmation targets changed after preflight.");
  if (record.parameterFingerprint !== expected.parameterFingerprint) throw new McpGuardedActionError("confirmation_parameter_mismatch", "The server confirmation parameters changed after preflight.");
  if (record.planFingerprint !== expected.planFingerprint) throw new McpGuardedActionError("confirmation_plan_mismatch", "The authoritative preflight changed before execution.");
  if (record.phraseHash !== fingerprint(expected.phrase)) throw new McpGuardedActionError("confirmation_phrase_mismatch", "The server confirmation phrase did not match.");
}

function normalizeIdempotencyKey(value: unknown): string {
  if (
    typeof value !== "string" ||
    !IDEMPOTENCY_KEY_PATTERN.test(value) ||
    secretLikePattern.test(value) ||
    /^(?:gh[pousr]_|sk-(?:proj-|svcacct-)?|xox[baprs]-)/iu.test(value)
  ) {
    throw new McpGuardedActionError("invalid_idempotency_key", "Execution requires a bounded idempotency key of at least eight safe characters.");
  }
  return value;
}

function normalizeConfirmationId(value: unknown): string {
  if (typeof value !== "string" || !CONFIRMATION_ID_PATTERN.test(value)) {
    throw new McpGuardedActionError("confirmation_required", "Execution requires the server-issued confirmation id.");
  }
  return value;
}

function normalizeConfirmationPhrase(value: unknown): string {
  if (typeof value !== "string" || value.length < 10 || value.length > 200 || secretLikePattern.test(value)) {
    throw new McpGuardedActionError("confirmation_required", "Execution requires the matching bounded server confirmation phrase.");
  }
  return value;
}

function normalizeTtl(value: unknown): number {
  if (value === undefined) return DEFAULT_CONFIRMATION_TTL_SECONDS;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > MAX_CONFIRMATION_TTL_SECONDS) {
    throw new McpGuardedActionError("invalid_request", `confirmationTtlSeconds must be an integer from 1 to ${MAX_CONFIRMATION_TTL_SECONDS}.`);
  }
  return value;
}

function response(input: {
  action: McpGuardedActionName;
  status: McpGuardedActionStatus;
  ok: boolean;
  correlationId: string;
  preflight: McpGuardedActionResponse["preflight"];
  confirmation: McpGuardedActionResponse["confirmation"];
  idempotencyKeyId: string | null;
  replayed: boolean;
  summary: string;
  result: McpGuardedActionResponse["result"];
}): McpGuardedActionResponse {
  return {
    contractVersion: "service-lasso-mcp-guarded-action.v1",
    generatedAt: new Date().toISOString(),
    action: input.action,
    status: input.status,
    ok: input.ok,
    correlationId: input.correlationId,
    preflight: input.preflight,
    confirmation: input.confirmation,
    idempotency: { keyId: input.idempotencyKeyId, replayed: input.replayed },
    summary: input.summary,
    result: input.result,
    safety: {
      mutating: input.status === "succeeded" || input.status === "failed",
      redacted: true,
      omittedSensitiveFields: [
        "secret values and credentials",
        "configuration bodies and environment values",
        "filesystem paths and raw command output",
        "tokens, cookies, private keys, and protocol bodies",
      ],
    },
  };
}

function normalizeResultTargets(targets: string[]): string[] {
  if (!Array.isArray(targets) || targets.length > 100) {
    throw new McpGuardedActionError("preflight_failed", "The guarded action result exceeds the bounded target limit.");
  }
  const normalized = targets.map((entry) => normalizeSafeId(entry, "target", true) as string);
  if (new Set(normalized).size !== normalized.length) {
    throw new McpGuardedActionError("preflight_failed", "The guarded action result contains duplicate targets.");
  }
  return normalized;
}

function normalizeResultEffects(effects: string[]): string[] {
  if (!Array.isArray(effects) || effects.length > 100) {
    throw new McpGuardedActionError("preflight_failed", "The guarded action result exceeds the bounded effect limit.");
  }
  return effects.map((entry) => safeSummary(entry, "Guarded action effect completed."));
}

function normalizeResultingState(
  states: McpGuardedActionServiceState[] | undefined,
  approvedTargets: string[],
): McpGuardedActionServiceState[] {
  if (states === undefined) return [];
  if (!Array.isArray(states) || states.length > 100) {
    throw new McpGuardedActionError("preflight_failed", "The guarded action result exceeds the bounded state limit.");
  }
  const approved = new Set(approvedTargets);
  if (states.length !== approved.size) {
    throw new McpGuardedActionError("preflight_failed", "The guarded action result state does not cover every approved target.");
  }
  const seen = new Set<string>();
  return states.map((state) => {
    if (!state || typeof state !== "object") {
      throw new McpGuardedActionError("preflight_failed", "The guarded action result contains invalid lifecycle state.");
    }
    const serviceId = normalizeSafeId(state.serviceId, "serviceId", true) as string;
    if (!approved.has(serviceId) || seen.has(serviceId)) {
      throw new McpGuardedActionError("preflight_failed", "The guarded action result state does not match the approved targets.");
    }
    if (typeof state.installed !== "boolean" || typeof state.configured !== "boolean" || typeof state.running !== "boolean") {
      throw new McpGuardedActionError("preflight_failed", "The guarded action result contains invalid lifecycle booleans.");
    }
    seen.add(serviceId);
    return { serviceId, installed: state.installed, configured: state.configured, running: state.running };
  });
}

function replayResponse(recorded: McpGuardedActionResponse, replayedAt: Date): McpGuardedActionResponse {
  return {
    ...recorded,
    generatedAt: replayedAt.toISOString(),
    status: "replayed",
    idempotency: {
      ...recorded.idempotency,
      replayed: true,
    },
    safety: {
      ...recorded.safety,
      mutating: false,
    },
  };
}

async function audit(
  workspaceRoot: string,
  action: McpGuardedActionName,
  event: "preflight" | "started" | "succeeded" | "failed" | "denied" | "skipped" | "replayed",
  actorId: string,
  clientId: string,
  correlationId: string,
  targets: string[],
  reason: string,
): Promise<void> {
  try {
    await appendAuditEvent({
      workspaceRoot,
      source: "runtime-mcp",
      action: `mcp.action.${event}`,
      actor: actorId,
      subject: action,
      method: "MCP",
      routeTemplate: `tool:${action}`,
      outcome: event === "failed" || event === "denied" ? "failure" : "success",
      statusCode: event === "denied" ? 403 : event === "failed" ? 500 : 200,
      summary: `Guarded MCP action ${event}.`,
      reason,
      correlationId,
      metadata: {
        clientId,
        action,
        targetIds: targets,
        targetCount: targets.length,
      },
    });
  } catch {
    throw new McpGuardedActionError("mcp_audit_unavailable", "Guarded MCP execution stopped because durable Audit is unavailable.");
  }
}

function safeTargetIds(parameters: McpGuardedActionParameters): string[] {
  return parameters.serviceId && /^@?[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(parameters.serviceId)
    ? [parameters.serviceId]
    : [];
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

function fingerprint(value: unknown): string {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "undefined";
  if (Array.isArray(value)) return `[${value.map((entry) => stableJson(entry)).join(",")}]`;
  return `{${Object.keys(value as Record<string, unknown>).sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`)
    .join(",")}}`;
}

async function readState(workspaceRoot: string, statePath: string): Promise<GuardedActionState> {
  const parsed = await readPrivateJson(workspaceRoot, statePath);
  if (parsed === null) return { version: STATE_VERSION, confirmations: [] };
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new McpGuardedActionError("guarded_action_state_invalid", "Guarded action state is invalid.");
  }
  const state = parsed as Partial<GuardedActionState>;
  if (
    state.version !== STATE_VERSION ||
    !Array.isArray(state.confirmations) ||
    state.confirmations.some((entry) => !isStoredConfirmation(entry))
  ) {
    throw new McpGuardedActionError("guarded_action_state_invalid", "Guarded action state is invalid.");
  }
  return state as GuardedActionState;
}

function isStoredConfirmation(value: unknown): value is StoredConfirmation {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Partial<StoredConfirmation>;
  return (
    typeof record.id === "string" &&
    typeof record.action === "string" &&
    (MCP_GUARDED_ACTION_NAMES as readonly string[]).includes(record.action) &&
    typeof record.actorId === "string" &&
    typeof record.clientId === "string" &&
    typeof record.targetFingerprint === "string" &&
    typeof record.parameterFingerprint === "string" &&
    typeof record.planFingerprint === "string" &&
    typeof record.phraseHash === "string" &&
    typeof record.issuedAt === "string" &&
    typeof record.expiresAt === "string" &&
    ["pending", "claimed", "completed", "expired"].includes(record.status ?? "") &&
    typeof record.correlationId === "string"
  );
}

async function readIdempotencyRecord(workspaceRoot: string, recordPath: string): Promise<StoredIdempotencyRecord | null> {
  const parsed = await readPrivateJson(workspaceRoot, recordPath);
  if (parsed === null) return null;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new McpGuardedActionError("guarded_action_state_invalid", "Guarded action idempotency state is invalid.");
  }
  const record = parsed as Partial<StoredIdempotencyRecord>;
  if (
    typeof record.keyId !== "string" ||
    typeof record.actorId !== "string" ||
    typeof record.clientId !== "string" ||
    typeof record.requestFingerprint !== "string" ||
    typeof record.correlationId !== "string" ||
    !["in_progress", "succeeded", "failed", "skipped"].includes(record.status ?? "") ||
    (record.status === "in_progress" && record.response !== null) ||
    (record.pendingResponse !== null && (typeof record.pendingResponse !== "object" || Array.isArray(record.pendingResponse))) ||
    (record.status !== "in_progress" && (
      !record.response ||
      typeof record.response !== "object" ||
      Array.isArray(record.response) ||
      record.pendingResponse !== null
    ))
  ) {
    throw new McpGuardedActionError("guarded_action_state_invalid", "Guarded action idempotency state is invalid.");
  }
  return record as StoredIdempotencyRecord;
}

async function writeIdempotencyRecord(
  workspaceRoot: string,
  recordPath: string,
  record: StoredIdempotencyRecord,
): Promise<void> {
  await writePrivateJson(workspaceRoot, recordPath, record);
}

async function writeState(workspaceRoot: string, statePath: string, state: GuardedActionState): Promise<void> {
  await writePrivateJson(workspaceRoot, statePath, state);
}

function trimState(state: GuardedActionState): void {
  state.confirmations = state.confirmations.slice(0, MAX_CONFIRMATIONS);
}

async function withStateLock<T>(statePath: string, work: () => Promise<T>): Promise<T> {
  const previous = stateQueues.get(statePath) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const queued = previous.then(() => gate);
  stateQueues.set(statePath, queued);
  await previous;
  const lockPath = `${statePath}.lock`;
  const lockNonce = randomBytes(16).toString("hex");
  let lockHandle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    await mkdir(path.dirname(lockPath), { recursive: true });
    const deadline = Date.now() + STATE_LOCK_TIMEOUT_MS;
    while (!lockHandle) {
      if (await stateLockRecoveryInProgress(lockPath)) {
        if (Date.now() >= deadline) {
          throw new McpGuardedActionError(
            "idempotency_state_unavailable",
            "The guarded action state lock is busy; no mutation was attempted.",
          );
        }
        await delay(20 + Math.floor(Math.random() * 31));
        continue;
      }
      try {
        lockHandle = await open(lockPath, "wx", 0o600);
        await lockHandle.writeFile(JSON.stringify({
          pid: process.pid,
          nonce: lockNonce,
          createdAt: new Date().toISOString(),
        }), { encoding: "utf8" });
        if (await stateLockRecoveryInProgress(lockPath)) {
          await lockHandle.close();
          lockHandle = null;
          await removeOwnedStateLock(lockPath, lockNonce);
          await delay(20 + Math.floor(Math.random() * 31));
        }
      } catch (error) {
        if (!isNodeError(error) || error.code !== "EEXIST") throw error;
        await recoverStaleStateLock(lockPath);
        if (Date.now() >= deadline) {
          throw new McpGuardedActionError(
            "idempotency_state_unavailable",
            "The guarded action state lock is busy; no mutation was attempted.",
          );
        }
        await delay(20 + Math.floor(Math.random() * 31));
      }
    }
    return await work();
  } finally {
    if (lockHandle) {
      await lockHandle.close().catch(() => undefined);
      await removeOwnedStateLock(lockPath, lockNonce);
    }
    release();
    if (stateQueues.get(statePath) === queued) stateQueues.delete(statePath);
  }
}

async function recoverStaleStateLock(lockPath: string): Promise<void> {
  const recoveryPath = `${lockPath}.recovery`;
  const recoveryNonce = randomBytes(16).toString("hex");
  let recoveryHandle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    recoveryHandle = await open(recoveryPath, "wx", 0o600);
    await recoveryHandle.writeFile(JSON.stringify({
      pid: process.pid,
      nonce: recoveryNonce,
      createdAt: new Date().toISOString(),
    }), { encoding: "utf8" });
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
        // The inspected malformed file is still identified by its file metadata.
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
      await removeOwnedStateLock(recoveryPath, recoveryNonce);
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

async function removeOwnedStateLock(lockPath: string, lockNonce: string): Promise<void> {
  try {
    const parsed = JSON.parse(await readFile(lockPath, "utf8")) as { nonce?: unknown };
    if (parsed.nonce === lockNonce) await rm(lockPath, { force: true });
  } catch (error) {
    if (!isNodeError(error) || error.code !== "ENOENT") {
      // Never remove a lock whose ownership cannot be proved.
    }
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
