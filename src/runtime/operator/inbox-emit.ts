import type { RecordedHealthTransition } from "../health/history.js";
import type { ServiceHealthResult } from "../health/types.js";
import { getLifecycleState } from "../lifecycle/store.js";
import type { ServiceRegistry } from "../manager/ServiceRegistry.js";
import type { RuntimeSetupStatus } from "../setup/first-run.js";
import type { UpdateInstallActionResult } from "../updates/actions.js";
import type { UpdateSchedulerEvent } from "../updates/scheduler.js";
import {
  emitOperatorInboxBrokerEvent,
  emitOperatorInboxServiceEvent,
  emitOperatorInboxSystemEvent,
  emitOperatorInboxUpdateEvent,
  type OperatorInboxServiceEvent,
  type OperatorInboxStateFile,
  type OperatorInboxUpdateEvent,
} from "./inbox.js";

const SECRETS_BROKER_SERVICE_ID = "@secretsbroker";
const SERVICE_ROUTE_PREFIX = "/services/";
const SETUP_STATUS_ROUTE = "/api/setup/status";
const CURRENT_CORRELATION_KEY = "current";

export interface KnownBrokerInboxFacts {
  discovered: boolean;
  running: boolean;
  vaultReady: boolean;
}

export interface InboxLifecycleEmitInput {
  serviceId: string;
  action: string;
  ok: boolean;
  running: boolean;
  health: ServiceHealthResult;
  healthTransition: RecordedHealthTransition;
  observedAt?: string;
}

export interface InboxHealthEmitInput {
  serviceId: string;
  running: boolean;
  health: ServiceHealthResult;
  transition: RecordedHealthTransition;
  observedAt?: string;
}

/**
 * Builds a service deep-link route without filesystem or query material.
 *
 * @param serviceId Canonical service id.
 * @returns Inbox-safe related-target route.
 */
function serviceRoute(serviceId: string): string {
  return SERVICE_ROUTE_PREFIX + encodeURIComponent(serviceId);
}

/**
 * Builds an update deep-link route for a service.
 *
 * @param serviceId Canonical service id.
 * @returns Inbox-safe updates route.
 */
function serviceUpdateRoute(serviceId: string): string {
  return serviceRoute(serviceId) + "/updates";
}

/**
 * Emits first-run setup required when Core already reports setup mode.
 * Healthy completed boots do not create a new completed item on every start.
 *
 * @param workspaceRoot Workspace Inbox store root.
 * @param setup Runtime setup status already computed by Core.
 * @param observedAt Optional observation timestamp.
 * @returns Persisted Inbox state when an item is emitted, otherwise null.
 */
export async function emitInboxRuntimeSetup(
  workspaceRoot: string,
  setup: Pick<RuntimeSetupStatus, "state" | "setupMode">,
  observedAt?: string,
): Promise<OperatorInboxStateFile | null> {
  if (!setup.setupMode && setup.state !== "setup_required" && setup.state !== "setup_failed") {
    return null;
  }

  return await emitOperatorInboxSystemEvent(workspaceRoot, {
    kind: "first-run.required",
    status: setup.state === "setup_failed" ? "error" : "warning",
    summary: setup.state === "setup_failed"
      ? "First-run setup failed and still needs operator attention."
      : "First-run setup is required before normal runtime operation.",
    route: SETUP_STATUS_ROUTE,
    correlationKey: CURRENT_CORRELATION_KEY,
    observedAt,
  });
}

/**
 * Emits first-run setup completed after Core records a successful bootstrap.
 *
 * @param workspaceRoot Workspace Inbox store root.
 * @param observedAt Optional observation timestamp.
 * @returns Persisted Inbox state.
 */
export async function emitInboxRuntimeSetupCompleted(
  workspaceRoot: string,
  observedAt?: string,
): Promise<OperatorInboxStateFile> {
  return await emitOperatorInboxSystemEvent(workspaceRoot, {
    kind: "first-run.completed",
    status: "success",
    summary: "First-run setup completed.",
    route: SETUP_STATUS_ROUTE,
    correlationKey: CURRENT_CORRELATION_KEY,
    observedAt,
  });
}

/**
 * Derives Secrets Broker attention facts from lifecycle and setup status Core
 * already exposes. Does not probe Broker transport or read secret material.
 *
 * @param registry Service registry used to detect `@secretsbroker`.
 * @param setup Runtime setup status already computed by Core.
 * @returns Known Broker facts for Inbox emission.
 */
export function knownBrokerFactsFromRuntime(
  registry: Pick<ServiceRegistry, "getById">,
  setup: Pick<RuntimeSetupStatus, "vault">,
): KnownBrokerInboxFacts {
  const broker = registry.getById(SECRETS_BROKER_SERVICE_ID);
  if (!broker) {
    return {
      discovered: false,
      running: false,
      vaultReady: setup.vault.ready,
    };
  }

  return {
    discovered: true,
    running: getLifecycleState(SECRETS_BROKER_SERVICE_ID).running,
    vaultReady: setup.vault.ready,
  };
}

/**
 * Emits Broker needs-attention from facts Core already reports. Recovered
 * notices update the same correlation key only when a prior item exists.
 *
 * @param workspaceRoot Workspace Inbox store root.
 * @param facts Known Broker discovery/running/vault facts.
 * @param observedAt Optional observation timestamp.
 * @returns Persisted Inbox state.
 */
export async function emitInboxBrokerAttentionFromKnownFacts(
  workspaceRoot: string,
  facts: KnownBrokerInboxFacts,
  observedAt?: string,
): Promise<OperatorInboxStateFile> {
  if (!facts.discovered) {
    return await emitOperatorInboxBrokerEvent(workspaceRoot, {
      status: "needs_attention",
      reason: "not_discovered",
      summary: "Secrets Broker is not discovered in this runtime.",
      route: SETUP_STATUS_ROUTE,
      observedAt,
    });
  }

  if (!facts.vaultReady) {
    return await emitOperatorInboxBrokerEvent(workspaceRoot, {
      status: "needs_attention",
      reason: "vault_not_ready",
      summary: "Secrets Broker vault is not ready.",
      route: SETUP_STATUS_ROUTE,
      observedAt,
    });
  }

  if (!facts.running) {
    return await emitOperatorInboxBrokerEvent(workspaceRoot, {
      status: "needs_attention",
      reason: "not_running",
      summary: "Secrets Broker is not running.",
      route: serviceRoute(SECRETS_BROKER_SERVICE_ID),
      observedAt,
    });
  }

  return await emitOperatorInboxBrokerEvent(workspaceRoot, {
    status: "recovered",
    reason: "healthy",
    summary: "Secrets Broker is ready.",
    route: serviceRoute(SECRETS_BROKER_SERVICE_ID),
    observedAt,
  });
}

/**
 * Emits a service health Inbox item only when a durable health transition was
 * appended. First healthy observations do not create a recovered item.
 *
 * @param workspaceRoot Workspace Inbox store root.
 * @param input Service health transition facts.
 * @returns Persisted Inbox state when emitted, otherwise null.
 */
export async function emitInboxForHealthTransition(
  workspaceRoot: string,
  input: InboxHealthEmitInput,
): Promise<OperatorInboxStateFile | null> {
  if (!input.transition.appended) {
    return null;
  }

  if (input.transition.nextStatus === "healthy") {
    if (input.transition.previousStatus === null) {
      return null;
    }

    return await emitOperatorInboxServiceEvent(workspaceRoot, {
      serviceId: input.serviceId,
      kind: "health.recovered",
      summary: `Service "${input.serviceId}" health recovered.`,
      route: serviceRoute(input.serviceId),
      correlationKey: CURRENT_CORRELATION_KEY,
      observedAt: input.observedAt,
    });
  }

  const kind: OperatorInboxServiceEvent["kind"] = input.running ? "health.degraded" : "health.unhealthy";
  return await emitOperatorInboxServiceEvent(workspaceRoot, {
    serviceId: input.serviceId,
    kind,
    summary: input.running
      ? `Service "${input.serviceId}" is running with degraded health.`
      : `Service "${input.serviceId}" healthcheck is unhealthy.`,
    route: serviceRoute(input.serviceId),
    correlationKey: CURRENT_CORRELATION_KEY,
    observedAt: input.observedAt,
  });
}

/**
 * Emits lifecycle failure and health-transition Inbox items for one action.
 * Successful starts do not create recovered items unless health actually
 * transitioned.
 *
 * @param workspaceRoot Workspace Inbox store root.
 * @param input Lifecycle action and health transition facts.
 */
export async function emitInboxForLifecycleAction(
  workspaceRoot: string,
  input: InboxLifecycleEmitInput,
): Promise<void> {
  if (!input.ok) {
    await emitOperatorInboxServiceEvent(workspaceRoot, {
      serviceId: input.serviceId,
      kind: "lifecycle.failed",
      summary: `Service "${input.serviceId}" ${input.action} failed.`,
      severity: "error",
      route: serviceRoute(input.serviceId),
      correlationKey: CURRENT_CORRELATION_KEY,
      observedAt: input.observedAt,
    });
  }

  await emitInboxForHealthTransition(workspaceRoot, {
    serviceId: input.serviceId,
    running: input.running,
    health: input.health,
    transition: input.healthTransition,
    observedAt: input.observedAt,
  });
}

/**
 * Emits a lifecycle-failed Inbox item when a lifecycle action throws before a
 * result payload is produced.
 *
 * @param workspaceRoot Workspace Inbox store root.
 * @param serviceId Canonical service id.
 * @param action Lifecycle action name.
 * @param observedAt Optional observation timestamp.
 */
export async function emitInboxLifecycleFailure(
  workspaceRoot: string,
  serviceId: string,
  action: string,
  observedAt?: string,
): Promise<OperatorInboxStateFile> {
  return await emitOperatorInboxServiceEvent(workspaceRoot, {
    serviceId,
    kind: "lifecycle.failed",
    summary: `Service "${serviceId}" ${action} failed.`,
    severity: "error",
    route: serviceRoute(serviceId),
    correlationKey: CURRENT_CORRELATION_KEY,
    observedAt,
  });
}

/**
 * Maps a completed update install onto installed or restart-required Inbox
 * status using the same correlation key for that update id.
 *
 * @param workspaceRoot Workspace Inbox store root.
 * @param result Update install action result already produced by Core.
 * @returns Persisted Inbox state.
 */
export async function emitInboxUpdateInstallOutcome(
  workspaceRoot: string,
  result: Pick<
    UpdateInstallActionResult,
    "serviceId" | "restartRequired" | "restartedAfterInstall" | "update" | "state"
  >,
): Promise<OperatorInboxStateFile> {
  const restartRequired = result.restartRequired && !result.restartedAfterInstall;
  const updateId = result.state.installArtifacts.artifact?.tag
    ?? result.update.available?.tag
    ?? result.update.downloadedCandidate?.tag
    ?? result.update.provenance?.tag
    ?? CURRENT_CORRELATION_KEY;
  const status: OperatorInboxUpdateEvent["status"] = restartRequired ? "restart_required" : "installed";
  return await emitOperatorInboxUpdateEvent(workspaceRoot, {
    serviceId: result.serviceId,
    status,
    summary: restartRequired
      ? `Update installed for service "${result.serviceId}"; restart is required.`
      : `Update candidate installed for service "${result.serviceId}".`,
    updateId,
    route: serviceUpdateRoute(result.serviceId),
    observedAt: result.update.updatedAt,
  });
}

/**
 * Emits an update-failed Inbox item without raw logs, paths, or tokens.
 *
 * @param workspaceRoot Workspace Inbox store root.
 * @param serviceId Canonical service id.
 * @param summary Safe operator-facing failure summary.
 * @param updateId Optional update correlation id.
 * @param observedAt Optional observation timestamp.
 * @returns Persisted Inbox state.
 */
export async function emitInboxUpdateFailure(
  workspaceRoot: string,
  serviceId: string,
  summary: string,
  updateId?: string | null,
  observedAt?: string,
): Promise<OperatorInboxStateFile> {
  return await emitOperatorInboxUpdateEvent(workspaceRoot, {
    serviceId,
    status: "failed",
    summary,
    updateId: updateId ?? CURRENT_CORRELATION_KEY,
    route: serviceUpdateRoute(serviceId),
    observedAt,
  });
}

/**
 * Emits Inbox items for scheduler-owned update outcomes. Interval/in-flight
 * skips are ignored so polling does not storm the Inbox.
 *
 * @param workspaceRoot Workspace Inbox store root.
 * @param event Scheduler event already recorded by Core.
 * @param updateId Optional update tag for correlation.
 * @returns Persisted Inbox state when emitted, otherwise null.
 */
export async function emitInboxFromUpdateSchedulerEvent(
  workspaceRoot: string,
  event: UpdateSchedulerEvent,
  updateId?: string | null,
): Promise<OperatorInboxStateFile | null> {
  if (
    event.reason === "updates_disabled" ||
    event.reason === "interval_not_elapsed" ||
    event.reason === "in_flight" ||
    event.reason === "latest" ||
    event.reason === "pinned"
  ) {
    return null;
  }

  if (event.reason === "update_available") {
    return await emitOperatorInboxUpdateEvent(workspaceRoot, {
      serviceId: event.serviceId,
      status: "available",
      summary: `An update is available for service "${event.serviceId}".`,
      updateId: updateId ?? CURRENT_CORRELATION_KEY,
      route: serviceUpdateRoute(event.serviceId),
      observedAt: event.at,
    });
  }

  if (event.reason === "downloaded") {
    return await emitOperatorInboxUpdateEvent(workspaceRoot, {
      serviceId: event.serviceId,
      status: "downloaded",
      summary: `An update candidate was downloaded for service "${event.serviceId}".`,
      updateId: updateId ?? CURRENT_CORRELATION_KEY,
      route: serviceUpdateRoute(event.serviceId),
      observedAt: event.at,
    });
  }

  if (event.reason === "installed") {
    return await emitOperatorInboxUpdateEvent(workspaceRoot, {
      serviceId: event.serviceId,
      status: "installed",
      summary: `An update candidate was installed for service "${event.serviceId}".`,
      updateId: updateId ?? CURRENT_CORRELATION_KEY,
      route: serviceUpdateRoute(event.serviceId),
      observedAt: event.at,
    });
  }

  if (event.reason === "install_deferred") {
    return await emitOperatorInboxUpdateEvent(workspaceRoot, {
      serviceId: event.serviceId,
      status: "deferred",
      summary: `Update install is deferred for service "${event.serviceId}".`,
      updateId: updateId ?? CURRENT_CORRELATION_KEY,
      route: serviceUpdateRoute(event.serviceId),
      observedAt: event.at,
    });
  }

  return await emitInboxUpdateFailure(
    workspaceRoot,
    event.serviceId,
    `Update ${event.action} failed for service "${event.serviceId}".`,
    updateId,
    event.at,
  );
}
