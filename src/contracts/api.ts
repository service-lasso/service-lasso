import type { LifecycleAction, ServiceLifecycleState } from "../runtime/lifecycle/types.js";
import type { ServiceHealthResult } from "../runtime/health/types.js";
import type { ProviderExecutionPlan } from "../runtime/providers/types.js";
import type { ServiceStatePaths } from "../runtime/state/paths.js";
import type { ServiceUpdateState } from "../runtime/updates/state.js";
import type { ServiceRecoveryHistoryState } from "../runtime/recovery/history.js";
import type { ServiceActionRunState } from "../runtime/actions/runs.js";

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

export interface ServiceConfigRevisionResponse {
  id: string;
  createdAt: string;
  actor: string;
  reason: string | null;
  path: string;
  previousHash: string;
  currentHash: string;
  validationStatus: "valid";
  content: string;
}

export interface ServiceConfigDocumentResponse {
  serviceId: string;
  fileName: "server.json";
  path: string;
  content: string;
  hash: string;
  updatedAt: string;
  backupCount: number;
  revisions: ServiceConfigRevisionResponse[];
  safety: {
    rawSecretValuesLoaded: false;
    omittedSensitiveFields: string[];
  };
}

export interface ServiceConfigSaveResponse {
  serviceId: string;
  fileName: "server.json";
  path: string;
  hash: string;
  savedAt: string;
  backup: ServiceConfigRevisionResponse;
  validationStatus: "valid";
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

export type AuditEventOutcome = "success" | "failure";

export interface AuditEvent {
  id: string;
  timestamp: string;
  source: string;
  action: string;
  actor: string;
  subject?: string;
  serviceId?: string;
  method?: string;
  routeTemplate?: string;
  outcome: AuditEventOutcome;
  statusCode: number;
  summary: string;
  reason: string | null;
  correlationId: string;
  relatedRevisionId: string | null;
  chainId: string;
  sequence: number;
  previousHash: string | null;
  eventHash: string;
  chainStatus: "valid";
}

export interface AuditQuery {
  serviceId?: string;
  actor?: string;
  action?: string;
  outcome?: AuditEventOutcome;
  source?: string;
  since?: string;
  until?: string;
  query?: string;
  limit?: string;
  cursor?: string;
}

export interface AuditResponse {
  events: AuditEvent[];
  pagination: {
    limit: number;
    nextCursor: string | null;
    total: number;
  };
}

export interface ManagedWorkflowRegistryStep {
  id: string;
  type: "service-lasso-action";
  actionId: string;
  endpoint: string;
  run?: "always" | "on-success";
  condition?: string;
  parameters?: Record<string, unknown>;
}

export interface ManagedWorkflowRegistryEntry {
  id: string;
  managedBy: "service-lasso";
  registryVersion: number;
  serviceId: string;
  serviceName: string;
  serviceVersion?: string;
  actionId: string;
  actionLabel?: string;
  scheduleId: string;
  scheduleLabel?: string;
  cron: string;
  timezone?: string;
  enabled: true;
  tags: string[];
  checksum: string;
  concurrencyPolicy?: "skip-if-running" | "allow-parallel";
  failurePolicy?: "record" | "retry" | "disable-schedule";
  parameters?: Record<string, unknown>;
  steps: ManagedWorkflowRegistryStep[];
  source: {
    manifestPath: string;
    serviceRoot: string;
  };
}

export interface ManagedWorkflowRegistryResponse {
  managedBy: "service-lasso";
  registryVersion: number;
  generatedAt: string;
  workflows: ManagedWorkflowRegistryEntry[];
}

export interface DashboardLinkResponse {
  label: string;
  url: string;
  kind?: "local" | "lan" | "remote" | "admin" | "docs" | "metrics";
}

export interface DashboardRuntimeHealthResponse {
  state: "running" | "stopped" | "degraded";
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
  status: "running" | "stopped" | "degraded";
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
  status: "running" | "stopped" | "degraded";
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

export interface DependenciesResponse {
  dependencies: {
    nodes: { id: string; name: string }[];
    edges: { from: string; to: string }[];
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

export interface ServiceActionRunResponse {
  ok: boolean;
  serviceId: string;
  actionId: string;
  run: ServiceActionRunState;
  message: string;
}

export interface ServiceActionRunsResponse {
  serviceId: string;
  actionId?: string;
  runs: ServiceActionRunState[];
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
  type: "default" | "stdout" | "stderr";
  path: string;
  availableTypes: Array<"default" | "stdout" | "stderr">;
}

export interface ServiceLogChunkResponse {
  serviceId: string;
  type: "default" | "stdout" | "stderr";
  path: string;
  totalLines: number;
  start: number;
  end: number;
  hasMore: boolean;
  nextBefore: number;
  limit: number;
  lines: string[];
}
