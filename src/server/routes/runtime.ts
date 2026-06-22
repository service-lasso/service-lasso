import type {
  RuntimeCapabilitiesResponse,
  RuntimeEndpointGroupResponse,
  RuntimeFeatureFlags,
  RuntimeInstanceResponse,
  RuntimeSummaryResponse,
} from "../../contracts/api.js";
import type { DiscoveredService } from "../../contracts/service.js";
import { DEFAULT_BASELINE_SERVICE_IDS } from "../../runtime/cli/bootstrap.js";

export function createRuntimeSummaryResponse(input: RuntimeSummaryResponse["runtime"]): RuntimeSummaryResponse {
  return {
    runtime: input,
  };
}

export function createRuntimeInstanceResponse(input: RuntimeInstanceResponse): RuntimeInstanceResponse {
  return input;
}

export const RUNTIME_CAPABILITIES_CONTRACT_VERSION = "service-lasso.runtime-capabilities.v1";

export interface RuntimeCapabilitiesInput {
  version: string;
  services: DiscoveredService[];
  features?: Partial<Pick<RuntimeFeatureFlags, "autostart" | "monitor" | "updateScheduler">>;
}

const endpointGroups: RuntimeEndpointGroupResponse[] = [
  {
    id: "health",
    label: "Health",
    methods: ["GET"],
    pathPrefix: "/api/health",
    mutating: false,
  },
  {
    id: "runtime",
    label: "Runtime",
    methods: ["GET", "POST"],
    pathPrefix: "/api/runtime",
    mutating: true,
  },
  {
    id: "services",
    label: "Services",
    methods: ["GET", "POST", "PATCH"],
    pathPrefix: "/api/services",
    mutating: true,
  },
  {
    id: "dashboard",
    label: "Dashboard adapter",
    methods: ["GET"],
    pathPrefix: "/api/dashboard",
    mutating: false,
  },
  {
    id: "dependencies",
    label: "Dependency graph",
    methods: ["GET"],
    pathPrefix: "/api/dependencies",
    mutating: false,
  },
  {
    id: "updates",
    label: "Service updates",
    methods: ["GET", "POST"],
    pathPrefix: "/api/updates",
    mutating: true,
  },
  {
    id: "recovery",
    label: "Recovery",
    methods: ["GET", "POST"],
    pathPrefix: "/api/recovery",
    mutating: true,
  },
  {
    id: "operator-data",
    label: "Operator data",
    methods: ["GET"],
    pathPrefix: "/api/variables",
    mutating: false,
  },
  {
    id: "telemetry",
    label: "Redacted telemetry",
    methods: ["GET", "POST"],
    pathPrefix: "/api/telemetry",
    mutating: true,
  },
  {
    id: "log-shipping",
    label: "Log shipping preview",
    methods: ["GET"],
    pathPrefix: "/api/log-shipping",
    mutating: false,
  },
  {
    id: "operator-mcp",
    label: "Operator MCP",
    methods: ["GET", "POST"],
    pathPrefix: "/api/mcp",
    mutating: false,
  },
];

function createDefaultFeatureFlags(
  input: RuntimeCapabilitiesInput,
): RuntimeCapabilitiesResponse["capabilities"]["features"] {
  return {
    serviceDiscovery: true,
    lifecycleActions: true,
    runtimeOrchestration: true,
    dashboardAdapter: true,
    serviceMetadata: true,
    updates: true,
    recovery: true,
    setupSteps: true,
    dependencyGraph: true,
    operatorVariables: true,
    operatorNetwork: true,
    operatorMetrics: true,
    operatorTelemetry: true,
    operatorLogShipping: true,
    operatorLogs: true,
    operatorMcp: true,
    providerConnections: false,
    workflowFacade: false,
    localRouteGeneration: true,
    lanBinding: true,
    autostart: input.features?.autostart === true,
    monitor: input.features?.monitor === true,
    updateScheduler: input.features?.updateScheduler === true,
  };
}

export function createRuntimeCapabilitiesResponse(input: RuntimeCapabilitiesInput): RuntimeCapabilitiesResponse {
  const defaultBaseline = new Set<string>(DEFAULT_BASELINE_SERVICE_IDS);
  const serviceRoles = input.services
    .map((service) => ({
      id: service.manifest.id,
      role: service.manifest.role === "provider" ? "provider" as const : "service" as const,
      enabled: service.manifest.enabled !== false,
      defaultBaseline: defaultBaseline.has(service.manifest.id),
    }))
    .sort((left, right) => left.id.localeCompare(right.id));

  return {
    capabilities: {
      runtime: {
        version: input.version,
      },
      api: {
        contractVersion: RUNTIME_CAPABILITIES_CONTRACT_VERSION,
        endpointGroups,
      },
      features: createDefaultFeatureFlags(input),
      baseline: {
        defaultServiceIds: [...DEFAULT_BASELINE_SERVICE_IDS],
        discoveredServiceCount: input.services.length,
        serviceRoles,
      },
      compatibility: {
        serviceAdmin: {
          minimumApiContractVersion: RUNTIME_CAPABILITIES_CONTRACT_VERSION,
          runtimeApiBaseUrlRequired: true,
          supportsDashboardAdapter: true,
          supportsSafeSecretMetadataOnly: true,
          preferredEndpointGroups: [
            "runtime",
            "dashboard",
            "services",
            "dependencies",
            "updates",
            "recovery",
            "telemetry",
            "log-shipping",
          ],
          notes: [
            "Use this endpoint before enabling runtime-dependent controls.",
            "Use Secrets Broker references and metadata only; do not request or render raw secret values from capability discovery.",
          ],
        },
      },
    },
  };
}
