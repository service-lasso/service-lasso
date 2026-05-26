import type { LifecycleAction, ServiceLifecycleState } from "../runtime/lifecycle/types.js";
import type { ServiceHealthResult } from "../runtime/health/types.js";
import type { ProviderExecutionPlan } from "../runtime/providers/types.js";
import type { ServiceStatePaths } from "../runtime/state/paths.js";
import type { ServiceUpdateState } from "../runtime/updates/state.js";
import type { ServiceRecoveryHistoryState } from "../runtime/recovery/history.js";

export interface HealthResponse {
  service: "service-lasso";
  status: "ok";
  mode: "development";
  api: {
    status: "up";
    version: string;
  };
}

export interface ApiErrorResponse {
  error: string;
  message: string;
  statusCode: number;
}

export interface ServiceSummary {
  id: string;
  name: string;
  description: string;
  status: "discovered" | "fixture";
  source: "manifest" | "fixture";
  manifestPath?: string;
  serviceRoot?: string;
  enabled?: boolean;
  version?: string;
  dependencies?: string[];
  dependents?: string[];
  lifecycle?: ServiceLifecycleState;
  health?: ServiceHealthResult;
  updates?: ServiceUpdateState;
  recovery?: ServiceRecoveryHistoryState;
  statePaths?: ServiceStatePaths;
  provider?: ProviderExecutionPlan;
  operator?: {
    logPath: string;
    variableCount: number;
    endpointCount: number;
  };
}

export interface GlobalEnvResponse {
  globalenv: Record<string, string>;
}

export interface ServicesResponse {
  services: ServiceSummary[];
}

export interface ServiceDetailResponse {
  service: ServiceSummary;
}

export interface ServiceMetaResponse {
  serviceId: string;
  meta: {
    favorite: boolean;
    dependencyGraphPosition: {
      x: number;
      y: number;
    } | null;
  };
}

export interface ServicesMetaResponse {
  services: Array<{
    id: string;
    favorite: boolean;
    dependencyGraphPosition: {
      x: number;
      y: number;
    } | null;
  }>;
}

export interface RuntimeSummaryResponse {
  runtime: {
    servicesRoot: string;
    workspaceRoot?: string;
    totalServices: number;
    enabledServices: number;
    dependencyEdges: number;
    runningServices: number;
    healthyServices: number;
  };
}

export interface RuntimeFeatureFlags {
  serviceDiscovery: boolean;
  lifecycleActions: boolean;
  runtimeOrchestration: boolean;
  dashboardAdapter: boolean;
  serviceMetadata: boolean;
  updates: boolean;
  recovery: boolean;
  setupSteps: boolean;
  dependencyGraph: boolean;
  operatorVariables: boolean;
  operatorNetwork: boolean;
  operatorMetrics: boolean;
  operatorLogs: boolean;
  providerConnections: boolean;
  workflowFacade: boolean;
  localRouteGeneration: boolean;
  lanBinding: boolean;
  autostart: boolean;
  monitor: boolean;
  updateScheduler: boolean;
}

export interface RuntimeEndpointGroupResponse {
  id: string;
  label: string;
  methods: string[];
  pathPrefix: string;
  mutating: boolean;
}

export interface RuntimeBaselineServiceRoleResponse {
  id: string;
  role: "service" | "provider";
  enabled: boolean;
  defaultBaseline: boolean;
}

export interface RuntimeCapabilitiesResponse {
  capabilities: {
    runtime: {
      version: string;
    };
    api: {
      contractVersion: string;
      endpointGroups: RuntimeEndpointGroupResponse[];
    };
    features: RuntimeFeatureFlags;
    baseline: {
      defaultServiceIds: string[];
      discoveredServiceCount: number;
      serviceRoles: RuntimeBaselineServiceRoleResponse[];
    };
    compatibility: {
      serviceAdmin: {
        minimumApiContractVersion: string;
        runtimeApiBaseUrlRequired: boolean;
        supportsDashboardAdapter: boolean;
        supportsSafeSecretMetadataOnly: boolean;
        preferredEndpointGroups: string[];
        notes: string[];
      };
    };
  };
}

export interface DashboardLinkResponse {
  label: string;
  url: string;
  kind?: "local" | "lan" | "remote" | "admin" | "docs" | "metrics";
}

export interface DashboardRuntimeHealthResponse {
  state: "running" | "available" | "stopped" | "degraded";
  health: "healthy" | "warning" | "critical";
  uptime: string;
  lastCheckAt: string;
  lastRestartAt?: string | null;
  summary: string;
}

export interface DashboardEndpointResponse {
  label: string;
  url: string;
  bind: string;
  port: number;
  protocol: "http" | "https" | "tcp";
  exposure: "local" | "lan" | "public";
}

export interface DashboardEnvironmentVariableResponse {
  key: string;
  value: string;
  scope: "global" | "service";
  secret?: boolean;
  source?: string;
}

export interface DashboardMetadataResponse {
  serviceType: string;
  runtime: string;
  version: string;
  build: string;
  packageId?: string;
  installPath?: string;
  configPath?: string;
  dataPath?: string;
  logPath?: string;
  workPath?: string;
  profile?: string;
  imageUrl?: string;
}

export interface DashboardDependencyResponse {
  id: string;
  name: string;
  status: "running" | "available" | "stopped" | "degraded";
  relation: "depends_on" | "dependent";
  note?: string;
}

export interface DashboardLogPreviewEntryResponse {
  timestamp: string;
  level: "info" | "warn" | "error";
  source: "supervisor" | "healthcheck" | "stdout" | "stderr" | "app";
  message: string;
}

export interface DashboardActionResponse {
  id: string;
  label: string;
  kind:
    | "start"
    | "stop"
    | "restart"
    | "reload"
    | "install"
    | "uninstall"
    | "open_logs"
    | "open_config"
    | "open_admin";
}

export interface DashboardServiceResponse {
  id: string;
  name: string;
  status: "running" | "available" | "stopped" | "degraded";
  favorite: boolean;
  note: string;
  links: DashboardLinkResponse[];
  installed: boolean;
  role: string;
  runtimeHealth: DashboardRuntimeHealthResponse;
  endpoints: DashboardEndpointResponse[];
  metadata: DashboardMetadataResponse;
  dependencies: DashboardDependencyResponse[];
  dependents: DashboardDependencyResponse[];
  environmentVariables: DashboardEnvironmentVariableResponse[];
  recentLogs: DashboardLogPreviewEntryResponse[];
  actions: DashboardActionResponse[];
}

export interface DashboardSummaryResponse {
  summary: {
    runtime: {
      status: "healthy" | "warning";
      lastReloadedAt: string;
      warningCount: number;
    };
    servicesTotal: number;
    servicesRunning: number;
    servicesAvailable: number;
    servicesStopped: number;
    servicesDegraded: number;
    networkExposureCount: number;
    installedCount: number;
    favorites: DashboardServiceResponse[];
    others: DashboardServiceResponse[];
    warnings: string[];
    problemServices: DashboardServiceResponse[];
  };
}

export interface DashboardServicesResponse {
  services: DashboardServiceResponse[];
}

export interface DashboardServiceDetailResponse {
  service: DashboardServiceResponse;
}

export type OperatorNotificationSeverity = "critical" | "warning" | "info";

export type OperatorNotificationKind =
  | "update_available"
  | "update_failed"
  | "install_deferred"
  | "recovery_review"
  | "lifecycle_crashed"
  | "health_unhealthy"
  | "blocked_start"
  | "diagnostic_warning";

export interface OperatorNotificationResponse {
  dedupeKey: string;
  kind: OperatorNotificationKind;
  severity: OperatorNotificationSeverity;
  serviceId: string | null;
  message: string;
  firstSeenAt: string;
  lastSeenAt: string;
  relatedActionEndpoint: string | null;
  source: "updates" | "recovery" | "lifecycle" | "health" | "diagnostics";
}

export interface OperatorNotificationsResponse {
  notifications: OperatorNotificationResponse[];
  summary: {
    generatedAt: string;
    total: number;
    critical: number;
    warning: number;
    info: number;
  };
}

export interface DependenciesResponse {
  dependencies: {
    nodes: { id: string; name: string }[];
    edges: { from: string; to: string }[];
  };
}

export type BaselineDependencyDiagnosticStatus = "startable" | "blocked" | "degraded" | "running";

export type ServiceDependencyReadiness = "ready" | "blocked" | "degraded" | "running" | "disabled";

export type ServiceDependencyBlockerKind =
  | "disabled"
  | "missing_dependency"
  | "dependency_not_ready"
  | "not_installed"
  | "not_configured"
  | "port_occupied"
  | "unhealthy";

export interface ServiceDependencyDiagnosticEndpoint {
  label: string;
  url: string;
  port: number | null;
}

export interface ServiceDependencyDiagnosticDependency {
  id: string;
  name: string;
  ready: boolean;
  readiness: ServiceDependencyReadiness;
  blockingReason: ServiceDependencyBlockerKind | null;
}

export interface ServiceDependencyDiagnostic {
  id: string;
  name: string;
  enabled: boolean;
  installed: boolean;
  configured: boolean;
  running: boolean;
  readiness: ServiceDependencyReadiness;
  blockingReason: ServiceDependencyBlockerKind | null;
  blockers: string[];
  nextAction: string;
  dependencies: ServiceDependencyDiagnosticDependency[];
  dependents: string[];
  ports: Record<string, number>;
  endpoints: ServiceDependencyDiagnosticEndpoint[];
  health: ServiceHealthResult;
}

export interface BaselineDependencyDiagnosticsResponse {
  diagnostics: {
    summary: {
      status: BaselineDependencyDiagnosticStatus;
      totalServices: number;
      enabledServices: number;
      runningServices: number;
      startableServices: number;
      blockedServices: number;
      degradedServices: number;
      disabledServices: number;
    };
    services: ServiceDependencyDiagnostic[];
  };
}

export interface LifecycleActionResponse {
  action: LifecycleAction;
  serviceId: string;
  ok: boolean;
  message: string;
  state: ServiceLifecycleState;
  health?: ServiceHealthResult;
  statePaths?: ServiceStatePaths;
  provider?: ProviderExecutionPlan;
}

export interface ServiceHealthResponse {
  serviceId: string;
  health: ServiceHealthResult;
}

export interface RuntimeOrchestrationSkippedService {
  serviceId: string;
  reason: string;
}

export interface RuntimeOrchestrationResponse {
  action: "startAll" | "stopAll" | "autostart" | "reload";
  ok: boolean;
  results: LifecycleActionResponse[];
  stopped?: LifecycleActionResponse[];
  skipped: RuntimeOrchestrationSkippedService[];
}

export interface ServiceLogEntryResponse {
  level: "info" | "stdout" | "stderr";
  message: string;
}

export interface ServiceMetricsResponse {
  metrics: {
    serviceId: string;
    process: {
      running: boolean;
      pid: number | null;
      command: string | null;
      provider: ProviderExecutionPlan["provider"] | null;
      providerServiceId: string | null;
      startedAt: string | null;
      finishedAt: string | null;
      currentRunDurationMs: number | null;
      lastRunDurationMs: number | null;
      totalRunDurationMs: number;
      launchCount: number;
      stopCount: number;
      exitCount: number;
      crashCount: number;
      restartCount: number;
      lastTermination: "stopped" | "exited" | "crashed" | null;
    };
    logs: {
      current: {
        logPath: string;
        stdoutPath: string;
        stderrPath: string;
        combinedEntries: number;
        stdoutLines: number;
        stderrLines: number;
      };
      archives: {
        count: number;
        maxArchives: number;
      };
    };
  };
}

export interface ServiceLogInfoResponse {
  serviceId: string;
  type: "default";
  path: string;
  availableTypes: ["default"];
}

export interface ServiceLogChunkResponse {
  serviceId: string;
  type: "default";
  path: string;
  totalLines: number;
  start: number;
  end: number;
  hasMore: boolean;
  nextBefore: number;
  limit: number;
  lines: string[];
}
