import type { RuntimeDryRunPlanResponse, RuntimeDryRunPlanStep } from "../../contracts/api.js";
import type { DiscoveredService, ServiceUpdateInstallWindow } from "../../contracts/service.js";
import { getLifecycleState } from "../lifecycle/store.js";
import type { DependencyGraph } from "../manager/DependencyGraph.js";
import type { ServiceRegistry } from "../manager/ServiceRegistry.js";
import { readServiceUpdateState } from "../updates/state.js";

type RuntimePlanAction = "startAll" | "stopAll" | "autostart";

function createPlanResponse(
  action: RuntimeDryRunPlanResponse["action"],
  steps: RuntimeDryRunPlanStep[],
): RuntimeDryRunPlanResponse {
  const skipped = steps
    .filter((step) => step.status === "skipped")
    .map((step) => ({ serviceId: step.serviceId, reason: step.reason ?? "skipped" }));
  const blockers = steps
    .filter((step) => step.status === "blocked")
    .map((step) => ({ serviceId: step.serviceId, reason: step.reason ?? "blocked" }));

  return {
    action,
    dryRun: true,
    ok: blockers.length === 0,
    generatedAt: new Date().toISOString(),
    order: steps.filter((step) => step.status === "would_run").map((step) => step.serviceId),
    steps,
    skipped,
    blockers,
    mutations: [],
  };
}

function createStep(input: Omit<RuntimeDryRunPlanStep, "prerequisites"> & { prerequisites?: string[] }): RuntimeDryRunPlanStep {
  return {
    prerequisites: [],
    ...input,
  };
}

export function buildRuntimeOrchestrationDryRunPlan(
  action: RuntimePlanAction,
  graph: DependencyGraph,
  registry: ServiceRegistry,
): RuntimeDryRunPlanResponse {
  const orderedServiceIds = action === "stopAll" ? graph.getGlobalShutdownOrder() : graph.getGlobalStartupOrder();
  const steps: RuntimeDryRunPlanStep[] = [];

  for (const serviceId of orderedServiceIds) {
    const service = registry.getById(serviceId);
    const order = steps.length + 1;
    const plannedAction = action === "stopAll" ? "stop" : "start";
    const actionEndpoint = "/api/runtime/actions/" + action;

    if (!service) {
      steps.push(createStep({
        order,
        serviceId,
        action: plannedAction,
        status: "blocked",
        reason: "missing_service",
        expectedStateChanges: [],
        actionEndpoint,
      }));
      continue;
    }

    if (service.manifest.enabled === false) {
      steps.push(createStep({
        order,
        serviceId,
        action: plannedAction,
        status: "skipped",
        reason: "disabled",
        expectedStateChanges: [],
        actionEndpoint,
      }));
      continue;
    }

    const lifecycle = getLifecycleState(serviceId);

    if (action !== "stopAll") {
      if (action === "autostart" && service.manifest.autostart !== true) {
        steps.push(createStep({
          order,
          serviceId,
          action: "start",
          status: "skipped",
          reason: "autostart_disabled",
          expectedStateChanges: [],
          actionEndpoint,
        }));
        continue;
      }

      if (lifecycle.running) {
        steps.push(createStep({
          order,
          serviceId,
          action: "start",
          status: "skipped",
          reason: "already_running",
          expectedStateChanges: [],
          actionEndpoint,
        }));
        continue;
      }

      if (!lifecycle.installed) {
        steps.push(createStep({
          order,
          serviceId,
          action: "start",
          status: "blocked",
          reason: "not_installed",
          prerequisites: ["install"],
          expectedStateChanges: [],
          actionEndpoint,
        }));
        continue;
      }

      if (!lifecycle.configured) {
        steps.push(createStep({
          order,
          serviceId,
          action: "start",
          status: "blocked",
          reason: "not_configured",
          prerequisites: ["config"],
          expectedStateChanges: [],
          actionEndpoint,
        }));
        continue;
      }

      steps.push(createStep({
        order,
        serviceId,
        action: "start",
        status: "would_run",
        reason: null,
        expectedStateChanges: ["running=true", "runtime.pid assigned", "runtime.startedAt updated"],
        actionEndpoint,
      }));
      continue;
    }

    if (!lifecycle.running) {
      steps.push(createStep({
        order,
        serviceId,
        action: "stop",
        status: "skipped",
        reason: "not_running",
        expectedStateChanges: [],
        actionEndpoint,
      }));
      continue;
    }

    steps.push(createStep({
      order,
      serviceId,
      action: "stop",
      status: "would_run",
      reason: null,
      expectedStateChanges: ["running=false", "runtime.finishedAt updated", "runtime.pid cleared"],
      actionEndpoint,
    }));
  }

  return createPlanResponse(action, steps);
}

function describeInstallWindow(window: ServiceUpdateInstallWindow | undefined): string | null {
  if (!window) {
    return null;
  }

  return "updates.installWindow " + window.start + "-" + window.end + (window.timezone ? " " + window.timezone : "");
}

export async function buildUpdateInstallDryRunPlan(
  service: DiscoveredService,
  options: { force?: boolean } = {},
): Promise<RuntimeDryRunPlanResponse> {
  const serviceId = service.manifest.id;
  const lifecycle = getLifecycleState(serviceId);
  const update = await readServiceUpdateState(service);
  const blockers: string[] = [];
  const prerequisites: string[] = [];
  const expectedStateChanges: string[] = [];

  if (!update.downloadedCandidate) {
    blockers.push("no_downloaded_candidate");
    prerequisites.push("updates download");
  }

  if (service.manifest.updates?.mode !== "install" && options.force !== true) {
    blockers.push("updates_mode_not_install");
    prerequisites.push("set updates.mode=install or pass force");
  }

  if (lifecycle.running && options.force !== true) {
    const runningPolicy = service.manifest.updates?.runningService ?? "skip";
    if (runningPolicy === "skip" || runningPolicy === "require-stopped") {
      blockers.push("running_service_policy_" + runningPolicy);
      prerequisites.push("stop service or pass force");
    } else {
      expectedStateChanges.push("running service would be stopped before install");
      expectedStateChanges.push("service would be restarted after install");
    }
  }

  const installWindow = describeInstallWindow(service.manifest.updates?.installWindow);
  if (installWindow && options.force !== true) {
    prerequisites.push("current time must be inside " + installWindow);
  }

  if (update.downloadedCandidate) {
    expectedStateChanges.push("install artifact tag would become " + update.downloadedCandidate.tag);
    expectedStateChanges.push("update state would become installed");
  }

  const step = createStep({
    order: 1,
    serviceId,
    action: "updateInstall",
    status: blockers.length > 0 ? "blocked" : "would_run",
    reason: blockers.length > 0 ? blockers.join(",") : null,
    prerequisites,
    expectedStateChanges,
    actionEndpoint: "/api/services/" + encodeURIComponent(serviceId) + "/update/install",
  });

  return createPlanResponse("updateInstall", [step]);
}
