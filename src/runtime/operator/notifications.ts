import type { DiscoveredService } from "../../contracts/service.js";
import type {
  OperatorNotificationResponse,
  OperatorNotificationSeverity,
} from "../../contracts/api.js";
import type { ServiceHealthResult } from "../health/types.js";
import { evaluateServiceHealth } from "../health/evaluateHealth.js";
import { getLifecycleState } from "../lifecycle/store.js";
import type { ServiceLifecycleState } from "../lifecycle/types.js";
import type { ServiceRegistry } from "../manager/ServiceRegistry.js";
import { readServiceRecoveryHistory, type ServiceRecoveryHistoryEvent } from "../recovery/history.js";
import { readServiceUpdateState } from "../updates/state.js";

const SEVERITY_RANK: Record<OperatorNotificationSeverity, number> = {
  critical: 3,
  warning: 2,
  info: 1,
};

function serviceEndpoint(serviceId: string, suffix: string): string {
  return "/api/services/" + encodeURIComponent(serviceId) + suffix;
}

function pickFirstSeen(a: string, b: string): string {
  return a <= b ? a : b;
}

function pickLastSeen(a: string, b: string): string {
  return a >= b ? a : b;
}

function mergeNotification(
  notifications: Map<string, OperatorNotificationResponse>,
  notification: OperatorNotificationResponse,
): void {
  const existing = notifications.get(notification.dedupeKey);
  if (!existing) {
    notifications.set(notification.dedupeKey, notification);
    return;
  }

  const severity =
    SEVERITY_RANK[notification.severity] > SEVERITY_RANK[existing.severity]
      ? notification.severity
      : existing.severity;
  const lastSeenAt = pickLastSeen(existing.lastSeenAt, notification.lastSeenAt);

  notifications.set(notification.dedupeKey, {
    ...existing,
    severity,
    firstSeenAt: pickFirstSeen(existing.firstSeenAt, notification.firstSeenAt),
    lastSeenAt,
    message: lastSeenAt === notification.lastSeenAt ? notification.message : existing.message,
    relatedActionEndpoint: notification.relatedActionEndpoint ?? existing.relatedActionEndpoint,
  });
}

function add(
  notifications: Map<string, OperatorNotificationResponse>,
  notification: Omit<OperatorNotificationResponse, "firstSeenAt" | "lastSeenAt"> & {
    seenAt: string;
  },
): void {
  const { seenAt, ...rest } = notification;
  mergeNotification(notifications, {
    ...rest,
    firstSeenAt: seenAt,
    lastSeenAt: seenAt,
  });
}

function isRecoveryEventNeedingReview(event: ServiceRecoveryHistoryEvent): boolean {
  if (event.kind === "doctor" || event.kind === "hook") {
    return event.blocked || !event.ok || event.steps.some((step) => !step.ok);
  }

  if (event.kind === "restart") {
    return !event.ok;
  }

  return event.action === "skip" && (
    event.reason === "not_installed" ||
    event.reason === "not_configured" ||
    event.reason === "backoff" ||
    event.reason === "max_attempts" ||
    event.reason === "restart_failed"
  );
}

function addRecoveryNotification(
  notifications: Map<string, OperatorNotificationResponse>,
  event: ServiceRecoveryHistoryEvent,
): void {
  if (!isRecoveryEventNeedingReview(event)) {
    return;
  }

  const kind = event.kind === "monitor" ? "blocked_start" : "recovery_review";
  const severity: OperatorNotificationSeverity =
    event.kind === "monitor" && (event.reason === "max_attempts" || event.reason === "restart_failed")
      ? "critical"
      : event.kind === "doctor" && event.blocked
        ? "critical"
        : "warning";

  add(notifications, {
    dedupeKey: kind + ":" + event.serviceId,
    kind,
    severity,
    serviceId: event.serviceId,
    message:
      kind === "blocked_start"
        ? "Service \"" + event.serviceId + "\" has a monitored start/restart blocker."
        : "Recovery history for service \"" + event.serviceId + "\" needs review.",
    seenAt: event.at,
    relatedActionEndpoint: serviceEndpoint(event.serviceId, "/recovery"),
    source: "recovery",
  });
}

function addLifecycleNotifications(
  notifications: Map<string, OperatorNotificationResponse>,
  service: DiscoveredService,
  lifecycle: ServiceLifecycleState,
  nowIso: string,
): void {
  if (lifecycle.runtime.lastTermination === "crashed" && !lifecycle.running) {
    add(notifications, {
      dedupeKey: "lifecycle_crashed:" + service.manifest.id,
      kind: "lifecycle_crashed",
      severity: "critical",
      serviceId: service.manifest.id,
      message: "Service \"" + service.manifest.id + "\" crashed and is not running.",
      seenAt: lifecycle.runtime.finishedAt ?? nowIso,
      relatedActionEndpoint: serviceEndpoint(service.manifest.id, "/restart"),
      source: "lifecycle",
    });
  }
}

function shouldReportUnhealthy(lifecycle: ServiceLifecycleState, health: ServiceHealthResult): boolean {
  if (health.healthy) {
    return false;
  }

  return lifecycle.running || lifecycle.runtime.lastTermination !== null || lifecycle.lastAction !== null;
}

function addHealthNotifications(
  notifications: Map<string, OperatorNotificationResponse>,
  service: DiscoveredService,
  lifecycle: ServiceLifecycleState,
  health: ServiceHealthResult,
  nowIso: string,
): void {
  if (!shouldReportUnhealthy(lifecycle, health)) {
    return;
  }

  add(notifications, {
    dedupeKey: "health_unhealthy:" + service.manifest.id,
    kind: "health_unhealthy",
    severity: lifecycle.runtime.lastTermination === "crashed" ? "critical" : "warning",
    serviceId: service.manifest.id,
    message: "Service \"" + service.manifest.id + "\" healthcheck is unhealthy.",
    seenAt: lifecycle.runtime.finishedAt ?? nowIso,
    relatedActionEndpoint: serviceEndpoint(service.manifest.id, "/health"),
    source: "health",
  });
}

function addDiagnosticWarnings(
  notifications: Map<string, OperatorNotificationResponse>,
  services: Array<{ service: DiscoveredService; lifecycle: ServiceLifecycleState; health: ServiceHealthResult }>,
  nowIso: string,
): void {
  const unhealthyCount = services.filter(({ lifecycle, health }) => shouldReportUnhealthy(lifecycle, health)).length;
  const crashedCount = services.filter(({ lifecycle }) => lifecycle.runtime.lastTermination === "crashed" && !lifecycle.running).length;

  if (unhealthyCount > 0) {
    add(notifications, {
      dedupeKey: "diagnostic_warning:unhealthy-services",
      kind: "diagnostic_warning",
      severity: crashedCount > 0 ? "critical" : "warning",
      serviceId: null,
      message: "One or more services need operator attention.",
      seenAt: nowIso,
      relatedActionEndpoint: "/api/dashboard",
      source: "diagnostics",
    });
  }
}

export async function buildOperatorNotifications(
  services: DiscoveredService[],
  registry: ServiceRegistry,
  sharedGlobalEnv: Record<string, string>,
  nowIso = new Date().toISOString(),
): Promise<OperatorNotificationResponse[]> {
  const notifications = new Map<string, OperatorNotificationResponse>();
  const serviceStates: Array<{
    service: DiscoveredService;
    lifecycle: ServiceLifecycleState;
    health: ServiceHealthResult;
  }> = [];

  void registry;

  for (const service of services) {
    const serviceId = service.manifest.id;
    const lifecycle = getLifecycleState(serviceId);
    const updates = await readServiceUpdateState(service);
    const recovery = await readServiceRecoveryHistory(service);
    const health = await evaluateServiceHealth(service.manifest, lifecycle, service.serviceRoot, service, sharedGlobalEnv);
    serviceStates.push({ service, lifecycle, health });

    if (updates.state === "available" && updates.available) {
      add(notifications, {
        dedupeKey: "update_available:" + serviceId,
        kind: "update_available",
        severity: "info",
        serviceId,
        message: "Update available for service \"" + serviceId + "\".",
        seenAt: updates.updatedAt || nowIso,
        relatedActionEndpoint: serviceEndpoint(serviceId, "/update/download"),
        source: "updates",
      });
    }

    if (updates.state === "failed" && updates.failed) {
      add(notifications, {
        dedupeKey: "update_failed:" + serviceId,
        kind: "update_failed",
        severity: "warning",
        serviceId,
        message: "Update check or install failed for service \"" + serviceId + "\".",
        seenAt: updates.failed.failedAt || updates.updatedAt || nowIso,
        relatedActionEndpoint: serviceEndpoint(serviceId, "/updates"),
        source: "updates",
      });
    }

    if (updates.state === "installDeferred" && updates.installDeferred) {
      add(notifications, {
        dedupeKey: "install_deferred:" + serviceId,
        kind: "install_deferred",
        severity: "warning",
        serviceId,
        message: "Update install is deferred for service \"" + serviceId + "\".",
        seenAt: updates.installDeferred.deferredAt || updates.updatedAt || nowIso,
        relatedActionEndpoint: serviceEndpoint(serviceId, "/update/install"),
        source: "updates",
      });
    }

    for (const event of recovery.events) {
      addRecoveryNotification(notifications, event);
    }

    addLifecycleNotifications(notifications, service, lifecycle, nowIso);
    addHealthNotifications(notifications, service, lifecycle, health, nowIso);
  }

  addDiagnosticWarnings(notifications, serviceStates, nowIso);

  return [...notifications.values()].sort((left, right) => {
    const severityDelta = SEVERITY_RANK[right.severity] - SEVERITY_RANK[left.severity];
    if (severityDelta !== 0) {
      return severityDelta;
    }

    const timeDelta = right.lastSeenAt.localeCompare(left.lastSeenAt);
    if (timeDelta !== 0) {
      return timeDelta;
    }

    return left.dedupeKey.localeCompare(right.dedupeKey);
  });
}
