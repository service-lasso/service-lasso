import type { DiscoveredService } from "../../contracts/service.js";
import type { RuntimeCapabilitiesResponse, RuntimeSummaryResponse } from "../../contracts/api.js";

export interface RuntimeCapabilitiesInput {
  version: string;
  servicesRoot: string;
  workspaceRoot: string;
  services: DiscoveredService[];
  enabledServices: number;
  autostartRequested?: boolean;
  monitorEnabled?: boolean;
  updateSchedulerEnabled?: boolean;
}

const API_CONTRACT_VERSION = "2026-05-runtime-capabilities-v1";

const endpointGroups: RuntimeCapabilitiesResponse["capabilities"]["endpointGroups"] = [
  {
    id: "runtime",
    basePath: "/api/runtime",
    methods: ["GET /api/runtime", "GET /api/runtime/capabilities", "POST /api/runtime/actions/:action"],
  },
  {
    id: "services",
    basePath: "/api/services",
    methods: ["GET /api/services", "GET /api/services/:serviceId", "POST /api/services/:serviceId/:action"],
  },
  {
    id: "dashboard",
    basePath: "/api/dashboard",
    methods: ["GET /api/dashboard", "GET /api/dashboard/services", "GET /api/dashboard/services/:serviceId"],
  },
  {
    id: "operator",
    basePath: "/api",
    methods: [
      "GET /api/dependencies",
      "GET /api/globalenv",
      "GET /api/logs/read",
      "GET /api/metrics",
      "GET /api/network",
      "GET /api/variables",
    ],
  },
  {
    id: "maintenance",
    basePath: "/api",
    methods: [
      "GET /api/recovery",
      "GET /api/setup",
      "GET /api/updates",
      "POST /api/updates/check",
      "POST /api/services/:serviceId/recovery/doctor",
      "POST /api/services/:serviceId/setup/run/:stepId?",
      "POST /api/services/:serviceId/update/download",
      "POST /api/services/:serviceId/update/install",
    ],
  },
];

export function createRuntimeSummaryResponse(input: RuntimeSummaryResponse["runtime"]): RuntimeSummaryResponse {
  return {
    runtime: input,
  };
}

export function createRuntimeCapabilitiesResponse(input: RuntimeCapabilitiesInput): RuntimeCapabilitiesResponse {
  const roles = new Map<string, string[]>();

  for (const service of input.services) {
    const role = service.manifest.role ?? "service";
    const serviceIds = roles.get(role) ?? [];
    serviceIds.push(service.manifest.id);
    roles.set(role, serviceIds);
  }

  return {
    capabilities: {
      runtime: {
        version: input.version,
        apiContractVersion: API_CONTRACT_VERSION,
        servicesRoot: input.servicesRoot,
        workspaceRoot: input.workspaceRoot,
      },
      features: {
        lifecycleActions: true,
        runtimeOrchestration: true,
        dashboardAdapter: true,
        serviceMetadata: true,
        logReader: true,
        serviceMetrics: true,
        serviceVariables: true,
        serviceNetwork: true,
        updates: true,
        recovery: true,
        setupSteps: true,
        dependencyGraph: true,
        globalEnv: true,
        lanBinding: true,
        localRouteGeneration: true,
        autostartRequested: input.autostartRequested === true,
        monitorEnabled: input.monitorEnabled === true,
        updateSchedulerEnabled: input.updateSchedulerEnabled === true,
      },
      endpointGroups,
      baseline: {
        totalServices: input.services.length,
        enabledServices: input.enabledServices,
        roles: Array.from(roles.entries())
          .map(([role, serviceIds]) => ({
            role,
            count: serviceIds.length,
            serviceIds: serviceIds.sort((left, right) => left.localeCompare(right)),
          }))
          .sort((left, right) => left.role.localeCompare(right.role)),
      },
      compatibility: {
        serviceAdmin: {
          minimumApiContractVersion: API_CONTRACT_VERSION,
          supportedDashboardAdapter: true,
          preferredRoutes: [
            "/api/dashboard",
            "/api/dashboard/services",
            "/api/dashboard/services/:serviceId",
            "/api/runtime/capabilities",
          ],
          notes: [
            "Use this endpoint before enabling runtime-backed UI controls.",
            "Treat missing or false feature flags as unavailable and fail closed for mutating actions.",
          ],
        },
      },
    },
  };
}
