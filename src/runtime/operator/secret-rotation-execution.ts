import { createHash } from "node:crypto";
import { mkdir, open, readFile, readdir, rename, unlink } from "node:fs/promises";
import path from "node:path";
import type { DiscoveredService } from "../../contracts/service.js";
import { ApiError } from "../../server/errors.js";
import { listServiceActionRuns, runServiceAction } from "../actions/runs.js";
import type { SecretsBrokerRuntimeContext } from "../broker/runtime.js";
import { waitForServiceReadiness } from "../health/waitForReadiness.js";
import { configService, startService, stopService, type ServiceLifecycleActionOptions } from "../lifecycle/actions.js";
import { getLifecycleState } from "../lifecycle/store.js";
import type { ServiceRegistry } from "../manager/ServiceRegistry.js";
import { collectRuntimeGlobalEnv } from "./variables.js";
import { writeServiceState } from "../state/writeState.js";
import {
  buildSecretRotationImpactPlan,
  type SecretRotationImpactOperation,
  type SecretRotationImpactPlan,
} from "./secret-rotation-plan.js";

const ROTATION_STATE_SCHEMA = "service-lasso.secret-rotation-operation.v1";
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const SAFE_ACTOR_ID = /^[A-Za-z0-9][A-Za-z0-9@._:-]{0,127}$/u;
const SAFE_REF = /^[A-Za-z0-9@._-]+(?:\/[A-Za-z0-9@._-]+)*$/u;
const TERMINAL_PHASES = new Set(["committed", "rolled_back", "blocked"]);

export type SecretRotationExecutionPhase =
  | "planned"
  | "staged"
  | "consumers_stopped"
  | "activated"
  | "converging"
  | "committed"
  | "rolling_back"
  | "rolled_back"
  | "blocked";

export interface SecretRotationExecutionState {
  schema: typeof ROTATION_STATE_SCHEMA;
  operationId: string;
  ref: string;
  planFingerprint: string;
  phase: SecretRotationExecutionPhase;
  outcome: "in_progress" | "committed" | "rolled_back" | "blocked";
  actorId: string;
  runtimeGenerationId: string | null;
  allocationId: string | null;
  createdAt: string;
  updatedAt: string;
  previousVersionId: string | null;
  stagedVersionId: string | null;
  activeVersionId: string | null;
  initialRunningServiceIds: string[];
  stoppedServiceIds: string[];
  completedOperations: string[];
  rollbackCompletedOperations: string[];
  ownerActionCompleted: boolean;
  ownerRollbackCompleted: boolean;
  failureCode: string | null;
  plan: SecretRotationImpactPlan;
}

export interface SecretRotationExecutionRequest {
  operationId: string;
  ref: string;
  planFingerprint: string;
  reason: string;
  confirm: boolean;
  value?: string;
  actorId: string;
}

export interface SecretRotationExecutionOptions {
  workspaceRoot: string;
  services: DiscoveredService[];
  registry: ServiceRegistry;
  brokerRuntime: SecretsBrokerRuntimeContext;
  runtimeGenerationId?: string | null;
  runtimeInstanceId?: string | null;
  allocationId?: string | null;
  plannedPortsByService?: Record<string, Record<string, number>>;
  operations?: Partial<SecretRotationExecutionOperations>;
}

export interface SecretRotationExecutionOperations {
  stop(service: DiscoveredService): Promise<void>;
  config(service: DiscoveredService): Promise<void>;
  start(service: DiscoveredService): Promise<boolean>;
  action(service: DiscoveredService, actionId: string, parentActionId: string, actorId: string): Promise<boolean>;
  ready(service: DiscoveredService): Promise<boolean>;
}

function rotationRoot(workspaceRoot: string): string {
  return path.join(workspaceRoot, ".service-lasso", "secret-rotations");
}

function operationPath(workspaceRoot: string, operationId: string): string {
  return path.join(rotationRoot(workspaceRoot), `${operationId}.json`);
}

function refLockPath(workspaceRoot: string, ref: string): string {
  const digest = createHash("sha256").update(ref).digest("hex");
  return path.join(rotationRoot(workspaceRoot), `ref-${digest}.lock`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function safeFailureCode(error: unknown): string {
  if (error instanceof ApiError) return error.code;
  if (isRecord(error) && typeof error.code === "string" && SAFE_ID.test(error.code)) return error.code;
  return "rotation_execution_failed";
}

function processIsRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return isRecord(error) && error.code === "EPERM";
  }
}

async function acquireRefLock(workspaceRoot: string, ref: string): Promise<() => Promise<void>> {
  const root = rotationRoot(workspaceRoot);
  const lockPath = refLockPath(workspaceRoot, ref);
  await mkdir(root, { recursive: true, mode: 0o700 });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = await open(lockPath, "wx", 0o600);
      await handle.writeFile(JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }), "utf8");
      await handle.sync();
      await handle.close();
      return async () => {
        await unlink(lockPath).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== "ENOENT") throw error;
        });
      };
    } catch (error) {
      if (!isRecord(error) || error.code !== "EEXIST") throw error;
      let ownerPid: number | null = null;
      try {
        const owner = JSON.parse(await readFile(lockPath, "utf8")) as unknown;
        ownerPid = isRecord(owner) && Number.isInteger(owner.pid) ? owner.pid as number : null;
      } catch {
        ownerPid = null;
      }
      if (ownerPid !== null && processIsRunning(ownerPid)) {
        throw new ApiError("rotation_in_progress", 409, "A rotation transaction for this ref is already running.");
      }
      await unlink(lockPath).catch((unlinkError: NodeJS.ErrnoException) => {
        if (unlinkError.code !== "ENOENT") throw unlinkError;
      });
    }
  }
  throw new ApiError("rotation_in_progress", 409, "A rotation transaction for this ref is already running.");
}

async function writeState(workspaceRoot: string, state: SecretRotationExecutionState): Promise<void> {
  const root = rotationRoot(workspaceRoot);
  const target = operationPath(workspaceRoot, state.operationId);
  const temporary = `${target}.${process.pid}.tmp`;
  await mkdir(root, { recursive: true, mode: 0o700 });
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(JSON.stringify(state), "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporary, target);
}

function validateState(value: unknown, expectedOperationId?: string): SecretRotationExecutionState {
  if (!isRecord(value) || value.schema !== ROTATION_STATE_SCHEMA || typeof value.operationId !== "string" ||
      !SAFE_ID.test(value.operationId) || (expectedOperationId && value.operationId !== expectedOperationId) ||
      typeof value.ref !== "string" || !SAFE_REF.test(value.ref) || typeof value.planFingerprint !== "string" ||
      !value.planFingerprint.startsWith("sha256:") || typeof value.phase !== "string" ||
      typeof value.outcome !== "string" || !isRecord(value.plan) ||
      (value.ownerActionCompleted !== undefined && typeof value.ownerActionCompleted !== "boolean") ||
      (value.ownerRollbackCompleted !== undefined && typeof value.ownerRollbackCompleted !== "boolean")) {
    throw new ApiError("rotation_state_invalid", 409, "Persisted rotation operation state is invalid.");
  }
  return {
    ...value,
    ownerActionCompleted: value.ownerActionCompleted === true,
    ownerRollbackCompleted: value.ownerRollbackCompleted === true,
  } as unknown as SecretRotationExecutionState;
}

export async function readSecretRotationExecutionState(
  workspaceRoot: string,
  operationId: string,
): Promise<SecretRotationExecutionState | null> {
  if (!SAFE_ID.test(operationId)) {
    throw new ApiError("invalid_request", 400, "Rotation operation id is invalid.");
  }
  try {
    return validateState(JSON.parse(await readFile(operationPath(workspaceRoot, operationId), "utf8")), operationId);
  } catch (error) {
    if (isRecord(error) && error.code === "ENOENT") return null;
    throw error;
  }
}

async function assertNoOtherActiveOperation(workspaceRoot: string, operationId: string, ref: string): Promise<void> {
  let entries: string[] = [];
  try {
    entries = await readdir(rotationRoot(workspaceRoot));
  } catch (error) {
    if (isRecord(error) && error.code === "ENOENT") return;
    throw error;
  }
  for (const entry of entries.filter((name) => name.endsWith(".json") && name !== `${operationId}.json`).slice(0, 1024)) {
    try {
      const state = validateState(JSON.parse(await readFile(path.join(rotationRoot(workspaceRoot), entry), "utf8")));
      if (state.ref === ref && !TERMINAL_PHASES.has(state.phase)) {
        throw new ApiError("rotation_recovery_required", 409, "An interrupted rotation for this ref must be resumed before starting another.");
      }
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError("rotation_state_invalid", 409, "Rotation state inventory contains invalid evidence.");
    }
  }
}

function lifecycleOptions(options: SecretRotationExecutionOptions, serviceId: string): ServiceLifecycleActionOptions {
  return {
    workspaceRoot: options.workspaceRoot,
    runtimeGenerationId: options.runtimeGenerationId,
    runtimeInstanceId: options.runtimeInstanceId,
    allocationRevision: options.allocationId,
    plannedPorts: options.plannedPortsByService?.[serviceId],
    brokerRuntime: options.brokerRuntime,
  };
}

function responseRecord(response: { statusCode: number; body: unknown }, operation: string): Record<string, unknown> {
  if (!isRecord(response.body)) {
    throw new ApiError("broker_contract_invalid", 502, `Secrets Broker ${operation} response was invalid.`);
  }
  if (response.statusCode < 200 || response.statusCode >= 300) {
    const outcome = typeof response.body.outcome === "string" ? response.body.outcome : "broker_rejected";
    throw new ApiError("broker_rotation_rejected", response.statusCode, `Secrets Broker ${operation} failed closed (${outcome}).`);
  }
  return response.body;
}

async function brokerPost(
  options: SecretRotationExecutionOptions,
  pathName: string,
  body: Record<string, unknown>,
  operation: string,
): Promise<Record<string, unknown>> {
  return responseRecord(await options.brokerRuntime.management({ method: "POST", path: pathName, body }), operation);
}

function versionId(record: Record<string, unknown>, field: string): string | null {
  const nested = record[field];
  return isRecord(nested) && typeof nested.versionId === "string" ? nested.versionId : null;
}

function operationKey(operation: SecretRotationImpactOperation): string {
  return `${operation.serviceId}:${operation.action}:${operation.actionId ?? ""}`;
}

async function persistLifecycle(service: DiscoveredService): Promise<void> {
  await writeServiceState(service, getLifecycleState(service.manifest.id));
}

function executionOperations(options: SecretRotationExecutionOptions): SecretRotationExecutionOperations {
  return {
    stop: options.operations?.stop ?? (async (service) => {
      const result = await stopService(service);
      await writeServiceState(service, result.state);
    }),
    config: options.operations?.config ?? (async (service) => {
      const result = await configService(service, options.registry, lifecycleOptions(options, service.manifest.id));
      await writeServiceState(service, result.state);
    }),
    start: options.operations?.start ?? (async (service) => {
      const result = await startService(service, options.registry, lifecycleOptions(options, service.manifest.id));
      await writeServiceState(service, result.state);
      return result.ok && result.state.running;
    }),
    action: options.operations?.action ?? (async (service, actionId, parentActionId, actorId) => {
      const priorRuns = await listServiceActionRuns(service, actionId);
      if (priorRuns.some((run) => run.status === "succeeded" && run.metadata.parentActionId === parentActionId)) return true;
      const result = await runServiceAction(service, options.registry, actionId, {
        source: "manual",
        actor: actorId,
        parentActionId,
        confirm: true,
      }, lifecycleOptions(options, service.manifest.id));
      return result.ok;
    }),
    ready: options.operations?.ready ?? (async (service) =>
      (await waitForServiceReadiness(service, collectRuntimeGlobalEnv(options.registry.list()))).ready),
  };
}

async function stopImpactedConsumers(
  state: SecretRotationExecutionState,
  options: SecretRotationExecutionOptions,
): Promise<void> {
  const restartIds = new Set(state.plan.execution.operations.filter((entry) => entry.action === "restart").map((entry) => entry.serviceId));
  for (const serviceId of state.plan.execution.stopOrder.filter((id) => restartIds.has(id))) {
    if (!state.initialRunningServiceIds.includes(serviceId) || state.stoppedServiceIds.includes(serviceId)) continue;
    const service = options.registry.getById(serviceId);
    if (!service) throw new ApiError("rotation_plan_stale", 409, `Impacted service "${serviceId}" is no longer discovered.`);
    if (getLifecycleState(serviceId).running) {
      await executionOperations(options).stop(service);
    }
    state.stoppedServiceIds.push(serviceId);
    state.updatedAt = new Date().toISOString();
    await writeState(options.workspaceRoot, state);
  }
}

async function rematerializeIfRequired(
  service: DiscoveredService,
  state: SecretRotationExecutionState,
  options: SecretRotationExecutionOptions,
): Promise<void> {
  const impact = state.plan.services.find((entry) => entry.serviceId === service.manifest.id);
  if (!impact?.sources.includes("config") || !getLifecycleState(service.manifest.id).installed) return;
  await executionOperations(options).config(service);
}

async function runPlannedOperation(
  operation: SecretRotationImpactOperation,
  state: SecretRotationExecutionState,
  options: SecretRotationExecutionOptions,
  rollback: boolean,
): Promise<void> {
  const service = options.registry.getById(operation.serviceId);
  if (!service) throw new ApiError("rotation_plan_stale", 409, `Impacted service "${operation.serviceId}" is no longer discovered.`);
  const initiallyRunning = state.initialRunningServiceIds.includes(operation.serviceId);
  await rematerializeIfRequired(service, state, options);
  if (!initiallyRunning) return;

  if (operation.action === "restart") {
    if (getLifecycleState(operation.serviceId).running) {
      await executionOperations(options).stop(service);
    }
    if (!await executionOperations(options).start(service)) {
      throw new ApiError("rotation_consumer_not_ready", 503, `Impacted service "${operation.serviceId}" did not restart.`);
    }
    return;
  }

  const actionId = operation.action === "reload" ? "reload" : operation.actionId;
  if (!actionId) {
    throw new ApiError("rotation_plan_invalid", 409, `Impacted service "${operation.serviceId}" has no executable change action.`);
  }
  const parentActionId = rollback ? `${state.operationId}:rollback` : state.operationId;
  if (!await executionOperations(options).action(service, actionId, parentActionId, state.actorId)) {
    throw new ApiError("rotation_consumer_action_failed", 503, `Impacted service "${operation.serviceId}" action failed.`);
  }
  if (!await executionOperations(options).ready(service)) {
    throw new ApiError("rotation_consumer_not_ready", 503, `Impacted service "${operation.serviceId}" did not prove readiness.`);
  }
}

async function convergeConsumers(
  state: SecretRotationExecutionState,
  options: SecretRotationExecutionOptions,
  rollback = false,
): Promise<void> {
  const completed = rollback ? state.rollbackCompletedOperations : state.completedOperations;
  for (const operation of state.plan.execution.operations) {
    const key = operationKey(operation);
    if (completed.includes(key)) continue;
    await runPlannedOperation(operation, state, options, rollback);
    completed.push(key);
    state.updatedAt = new Date().toISOString();
    await writeState(options.workspaceRoot, state);
  }
}

async function runOwnerAction(
  state: SecretRotationExecutionState,
  options: SecretRotationExecutionOptions,
): Promise<void> {
  const ownerAction = state.plan.ownerAction;
  if (!ownerAction || state.ownerActionCompleted) return;
  if (ownerAction.status !== "ready" || !ownerAction.serviceId || !ownerAction.actionId) {
    throw new ApiError("rotation_owner_action_required", 409, "Rotation requires a valid authoritative owner action.");
  }
  const service = options.registry.getById(ownerAction.serviceId);
  if (!service) {
    throw new ApiError("rotation_plan_stale", 409, `Rotation owner service "${ownerAction.serviceId}" is no longer discovered.`);
  }
  if (!await executionOperations(options).action(service, ownerAction.actionId, `${state.operationId}:owner`, state.actorId)) {
    throw new ApiError("rotation_owner_action_failed", 503, "The authoritative rotation owner action failed.");
  }
  state.ownerActionCompleted = true;
  state.updatedAt = new Date().toISOString();
  await writeState(options.workspaceRoot, state);
}

async function runOwnerRollback(
  state: SecretRotationExecutionState,
  options: SecretRotationExecutionOptions,
): Promise<void> {
  const ownerAction = state.plan.ownerAction;
  if (!ownerAction || !state.ownerActionCompleted || state.ownerRollbackCompleted) return;
  if (ownerAction.status !== "ready" || !ownerAction.serviceId || !ownerAction.rollbackActionId) {
    throw new ApiError("rotation_owner_rollback_required", 409, "Rotation requires a valid authoritative owner rollback action.");
  }
  const service = options.registry.getById(ownerAction.serviceId);
  if (!service) {
    throw new ApiError("rotation_plan_stale", 409, `Rotation owner service "${ownerAction.serviceId}" is no longer discovered.`);
  }
  if (!await executionOperations(options).action(service, ownerAction.rollbackActionId, `${state.operationId}:owner-rollback`, state.actorId)) {
    throw new ApiError("rotation_owner_rollback_failed", 503, "The authoritative rotation owner rollback action failed.");
  }
  state.ownerRollbackCompleted = true;
  state.updatedAt = new Date().toISOString();
  await writeState(options.workspaceRoot, state);
}

async function rollBackActivatedRotation(
  state: SecretRotationExecutionState,
  reason: string,
  options: SecretRotationExecutionOptions,
): Promise<void> {
  state.phase = "rolling_back";
  state.outcome = "in_progress";
  state.updatedAt = new Date().toISOString();
  await writeState(options.workspaceRoot, state);
  if (!state.previousVersionId) {
    throw new ApiError("rotation_rollback_unavailable", 503, "Broker did not provide the previous version required for rollback.");
  }
  const rolledBack = await brokerPost(options, "/v1/management/secrets/rotation/rollback", {
    requestId: `${state.operationId}-rollback`,
    serviceId: "@service-lasso",
    ref: state.ref,
    operationId: `${state.operationId}-rollback`,
    versionId: state.previousVersionId,
    reason,
    confirm: true,
  }, "rollback");
  if (rolledBack.outcome !== "rolled_back" && rolledBack.nextAction !== "already_active") {
    throw new ApiError("rotation_rollback_failed", 503, "Secrets Broker did not restore the previous active version.");
  }
  await runOwnerRollback(state, options);
  await convergeConsumers(state, options, true);
  state.activeVersionId = state.previousVersionId;
  state.phase = "rolled_back";
  state.outcome = "rolled_back";
  state.updatedAt = new Date().toISOString();
  await writeState(options.workspaceRoot, state);
}

function initialState(
  request: SecretRotationExecutionRequest,
  plan: SecretRotationImpactPlan,
  options: SecretRotationExecutionOptions,
): SecretRotationExecutionState {
  const now = new Date().toISOString();
  return {
    schema: ROTATION_STATE_SCHEMA,
    operationId: request.operationId,
    ref: request.ref,
    planFingerprint: plan.planFingerprint,
    phase: "planned",
    outcome: "in_progress",
    actorId: request.actorId,
    runtimeGenerationId: options.runtimeGenerationId ?? null,
    allocationId: options.allocationId ?? null,
    createdAt: now,
    updatedAt: now,
    previousVersionId: null,
    stagedVersionId: null,
    activeVersionId: null,
    initialRunningServiceIds: plan.services
      .filter((service) => getLifecycleState(service.serviceId).running)
      .map((service) => service.serviceId)
      .sort(),
    stoppedServiceIds: [],
    completedOperations: [],
    rollbackCompletedOperations: [],
    ownerActionCompleted: false,
    ownerRollbackCompleted: false,
    failureCode: null,
    plan,
  };
}

export async function executeSecretRotation(
  request: SecretRotationExecutionRequest,
  options: SecretRotationExecutionOptions,
): Promise<SecretRotationExecutionState> {
  if (!SAFE_ID.test(request.operationId) || !SAFE_REF.test(request.ref) ||
      !/^sha256:[a-f0-9]{64}$/u.test(request.planFingerprint) || !request.reason.trim() ||
      !request.confirm || !SAFE_ACTOR_ID.test(request.actorId)) {
    throw new ApiError("invalid_request", 400, "Rotation execution requires valid operation/ref/plan identity, audit reason, actor, and confirmation.");
  }
  const release = await acquireRefLock(options.workspaceRoot, request.ref);
  try {
    await assertNoOtherActiveOperation(options.workspaceRoot, request.operationId, request.ref);
    const livePlan = buildSecretRotationImpactPlan(options.services, request.ref);
    if (livePlan.planFingerprint !== request.planFingerprint) {
      throw new ApiError("rotation_plan_stale", 409, "Rotation impact plan changed; refresh and confirm the new plan.");
    }
    if (livePlan.status !== "ready" || livePlan.blockers.length > 0) {
      throw new ApiError("rotation_plan_blocked", 409, "Rotation impact plan contains unresolved manual or policy blockers.");
    }

    let state = await readSecretRotationExecutionState(options.workspaceRoot, request.operationId);
    if (state) {
      if (state.ref !== request.ref || state.planFingerprint !== request.planFingerprint || state.actorId !== request.actorId) {
        throw new ApiError("rotation_operation_conflict", 409, "Rotation operation id is already bound to different metadata.");
      }
      if (TERMINAL_PHASES.has(state.phase)) return state;
    } else {
      state = initialState(request, livePlan, options);
      await writeState(options.workspaceRoot, state);
    }

    try {
      if (state.phase === "planned") {
        if (!request.value || request.value.length === 0 || Buffer.byteLength(request.value) > 64 * 1024) {
          throw new ApiError("rotation_value_required", 400, "A bounded replacement value is required until the candidate version is staged.");
        }
        const preview = await brokerPost(options, "/v1/management/secrets/rotation/dry-run", {
          requestId: `${state.operationId}-preview`,
          serviceId: "@service-lasso",
          operationId: state.operationId,
          refs: [state.ref],
          reason: request.reason,
        }, "preview");
        if (preview.outcome !== "dry_run_ready" || preview.auditStatus !== "audit_ready") {
          throw new ApiError("broker_rotation_not_ready", 409, "Secrets Broker did not return an audited executable rotation preview.");
        }
        const status = await brokerPost(options, "/v1/management/secrets/rotation/status", {
          requestId: `${state.operationId}-status`,
          serviceId: "@service-lasso",
          ref: state.ref,
        }, "status");
        const currentVersion = versionId(status, "currentVersion");
        if (status.outcome !== "ready" || !currentVersion) {
          throw new ApiError("broker_rotation_not_ready", 409, "Secrets Broker current version is unavailable.");
        }
        await runOwnerAction(state, options);
        const staged = await brokerPost(options, "/v1/management/secrets/rotation/stage", {
          requestId: `${state.operationId}-stage`,
          serviceId: "@service-lasso",
          ref: state.ref,
          operationId: state.operationId,
          expectedCurrentVersion: currentVersion,
          reason: request.reason,
          confirm: true,
          value: request.value,
        }, "stage");
        const stagedVersion = versionId(staged, "stagedVersion");
        if (staged.outcome !== "staged" || staged.auditStatus !== "audit_recorded" || !stagedVersion) {
          throw new ApiError("broker_rotation_stage_failed", 503, "Secrets Broker did not durably stage the candidate version.");
        }
        state.previousVersionId = currentVersion;
        state.activeVersionId = currentVersion;
        state.stagedVersionId = stagedVersion;
        state.phase = "staged";
        state.updatedAt = new Date().toISOString();
        await writeState(options.workspaceRoot, state);
      }

      if (state.phase === "staged") {
        await stopImpactedConsumers(state, options);
        state.phase = "consumers_stopped";
        state.updatedAt = new Date().toISOString();
        await writeState(options.workspaceRoot, state);
      }

      if (state.phase === "consumers_stopped") {
        const activated = await brokerPost(options, "/v1/management/secrets/rotation/activate", {
          requestId: `${state.operationId}-activate`,
          serviceId: "@service-lasso",
          ref: state.ref,
          operationId: state.operationId,
          versionId: state.stagedVersionId,
          expectedCurrentVersion: state.previousVersionId,
          reason: request.reason,
          confirm: true,
        }, "activate");
        const activeVersion = versionId(activated, "currentVersion");
        if (activated.outcome !== "applied" || activated.applied !== true || activated.auditStatus !== "audit_recorded" || !activeVersion) {
          throw new ApiError("broker_rotation_activate_failed", 503, "Secrets Broker did not activate the staged candidate.");
        }
        state.activeVersionId = activeVersion;
        state.phase = "activated";
        state.updatedAt = new Date().toISOString();
        await writeState(options.workspaceRoot, state);
      }

      if (state.phase === "activated" || state.phase === "converging") {
        state.phase = "converging";
        state.updatedAt = new Date().toISOString();
        await writeState(options.workspaceRoot, state);
        await convergeConsumers(state, options);
        state.phase = "committed";
        state.outcome = "committed";
        state.failureCode = null;
        state.updatedAt = new Date().toISOString();
        await writeState(options.workspaceRoot, state);
      }
      return state;
    } catch (error) {
      state.failureCode = safeFailureCode(error);
      state.updatedAt = new Date().toISOString();
      const activated = state.phase === "activated" || state.phase === "converging" || state.phase === "rolling_back";
      if (!activated) {
        if (state.ownerActionCompleted) {
          try {
            await runOwnerRollback(state, options);
            if (state.stoppedServiceIds.length > 0) {
              await convergeConsumers(state, options, true);
            }
          } catch (rollbackError) {
            state.phase = "blocked";
            state.outcome = "blocked";
            state.failureCode = safeFailureCode(rollbackError);
            state.updatedAt = new Date().toISOString();
            await writeState(options.workspaceRoot, state);
            throw new ApiError("rotation_owner_rollback_blocked", 503, "Rotation stopped before activation and authoritative owner rollback requires operator recovery.");
          }
          state.phase = "blocked";
          state.outcome = "blocked";
          state.updatedAt = new Date().toISOString();
        }
        await writeState(options.workspaceRoot, state);
        throw error;
      }
      try {
        await rollBackActivatedRotation(state, "automatic rollback after consumer convergence failure", options);
      } catch (rollbackError) {
        state.phase = "blocked";
        state.outcome = "blocked";
        state.failureCode = safeFailureCode(rollbackError);
        state.updatedAt = new Date().toISOString();
        await writeState(options.workspaceRoot, state);
        throw new ApiError("rotation_rollback_blocked", 503, "Rotation failed and automatic rollback requires operator recovery.");
      }
      return state;
    }
  } finally {
    await release();
  }
}
