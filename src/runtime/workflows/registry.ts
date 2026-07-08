import { createHash } from "node:crypto";
import type {
  ManagedWorkflowRegistryEntry,
  ManagedWorkflowRegistryResponse,
  ManagedWorkflowRegistryStep,
} from "../../contracts/api.js";
import type { DiscoveredService, ServiceActionDefinition } from "../../contracts/service.js";

const registryVersion = 1;

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableJson(entry)).join(",")}]`;
  }

  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .filter((key) => record[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(",")}}`;
}

function checksumWorkflowEntry(entry: Omit<ManagedWorkflowRegistryEntry, "checksum">): string {
  return createHash("sha256").update(stableJson(entry)).digest("hex");
}

function buildWorkflowSteps(
  serviceId: string,
  actionId: string,
  action: ServiceActionDefinition,
): ManagedWorkflowRegistryStep[] {
  const steps = action.steps?.length
    ? action.steps
    : [
        {
          id: actionId,
          type: "service-lasso-action" as const,
          actionId,
        },
      ];

  return steps.map((step) => ({
    id: step.id,
    type: "service-lasso-action",
    actionId: step.actionId,
    endpoint: `/api/services/${encodeURIComponent(serviceId)}/actions/${encodeURIComponent(step.actionId)}/runs`,
    run: step.run,
    condition: step.condition,
    parameters: step.parameters,
  }));
}

export function buildManagedWorkflowRegistry(services: DiscoveredService[]): ManagedWorkflowRegistryResponse {
  const workflows = services
    .filter((service) => service.manifest.enabled !== false)
    .flatMap((service) =>
      Object.entries(service.manifest.actions ?? {}).flatMap(([actionId, action]) =>
        Object.entries(action.schedules ?? {})
          .filter(([, schedule]) => schedule.enabled !== false)
          .map(([scheduleId, schedule]) => {
            const entry = {
              id: `${service.manifest.id}.${actionId}.${scheduleId}`,
              managedBy: "service-lasso" as const,
              registryVersion,
              serviceId: service.manifest.id,
              serviceName: service.manifest.name,
              serviceVersion: service.manifest.version,
              actionId,
              actionLabel: action.label,
              scheduleId,
              scheduleLabel: schedule.label,
              cron: schedule.cron,
              timezone: schedule.timezone,
              enabled: true as const,
              tags: ["service-lasso", `service:${service.manifest.id}`, `action:${actionId}`],
              concurrencyPolicy: schedule.concurrencyPolicy,
              failurePolicy: schedule.failurePolicy,
              parameters: schedule.parameters,
              steps: buildWorkflowSteps(service.manifest.id, actionId, action),
              source: {
                manifestPath: service.manifestPath,
                serviceRoot: service.serviceRoot,
              },
            };

            return {
              ...entry,
              checksum: checksumWorkflowEntry(entry),
            };
          }),
      ),
    )
    .sort((left, right) => left.id.localeCompare(right.id));

  return {
    managedBy: "service-lasso",
    registryVersion,
    generatedAt: new Date().toISOString(),
    workflows,
  };
}
