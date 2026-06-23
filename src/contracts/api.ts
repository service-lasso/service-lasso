import type { LifecycleAction, ServiceLifecycleState, ServiceStartTraceState } from "../runtime/lifecycle/types.js";
import type { ServiceHealthResult } from "../runtime/health/types.js";
import type { ProviderExecutionPlan } from "../runtime/providers/types.js";
import type { ServiceStatePaths } from "../runtime/state/paths.js";
import type { ServiceUpdateState } from "../runtime/updates/state.js";
import type { ServiceRecoveryHistoryState } from "../runtime/recovery/history.js";
import type { ServiceHealthHistoryState } from "../runtime/health/history.js";
import type { ConfigDriftReport } from "../runtime/operator/config-drift.js";
import type { RuntimeLogShippingPreview } from "../runtime/operator/log-shipping.js";
import type { RuntimeTelemetryPreview, ServiceTelemetryPreview, TelemetryExportTestResult } from "../runtime/operator/telemetry.js";
import type { ServiceCatalogProvenance } from "./service.js";

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
  healthHistory?: ServiceHealthHistoryState;
  updates?: ServiceUpdateState;
  recovery?: ServiceRecoveryHistoryState;
  catalogProvenance?: ServiceCatalogProvenance;
  statePaths?: ServiceStatePaths;
  provider?: ProviderExecutionPlan;
  compatibility?: ServiceCompatibilityReport;
  operator?: {
    logPath: string;
    variableCount: number;
    endpointCount: number;
  };
}

export interface ServiceCompatibilityPortRequirement {
  name: string;
  port: number;
}

export interface ServiceCompatibilityRequirementStatus {
  kind: "dependency" | "provider" | "port";
  id: string;
  status: "satisfied" | "missing" | "declared";
  detail?: string;
}

export interface ServiceCompatibilityWarning {
  kind: "release-stale" | "release-metadata-unavailable";
  severity: "warning";
  id: string;
  detail: string;
  sourceRepo?: string | null;
  manifestTag?: string | null;
  latestTag?: string | null;
}

export interface ServiceCompatibilityReport {
  hostPlatform: string;
  status: "compatible" | "unsupported" | "missing-requirements";
  supportedPlatforms: string[];
  requiredProviders: string[];
  requiredPorts: ServiceCompatibilityPortRequirement[];
  requirements: ServiceCompatibilityRequirementStatus[];
  blockers: string[];
  warnings: ServiceCompatibilityWarning[];
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

export interface ServiceConfigDriftResponse {
  drift: ConfigDriftReport;
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

export type RuntimeInstanceStatus = "active" | "stale" | "unknown";

export interface RuntimeInstanceRecord {
  instanceId: string;
  servicesRoot: string;
  workspaceRoot: string;
  pid: number;
  apiPort: number;
  apiUrl: string;
  advertisedUrls: string[];
  startedAt: string;
  updatedAt: string;
  heartbeatAt: string;
  leaseExpiresAt: string;
  leaseTtlMs: number;
  version: string;
  status: RuntimeInstanceStatus;
  statusReason?: string;
  staleReason?: string;
}

export interface RuntimeInstanceRegistrySnapshot {
  path: string;
  activeCount: number;
  staleCount: number;
  unknownCount: number;
  instances: RuntimeInstanceRecord[];
}

export interface RuntimeInstanceResponse {
  instance: RuntimeInstanceRecord | null;
  registry: RuntimeInstanceRegistrySnapshot;
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
  operatorTelemetry: boolean;
  operatorLogShipping: boolean;
  operatorLogs: boolean;
  operatorMcp: boolean;
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

export type OperatorCommandKind =
  | "status"
  | "services"
  | "service.status"
  | "service.logs.tail"
  | "updates.check.plan"
  | "diagnostics.bundle.preview"
  | "restart.plan";

export type OperatorCommandErrorCode =
  | "invalid_command"
  | "invalid_log_tail"
  | "missing_service_id"
  | "mutating_command_blocked"
  | "service_not_found"
  | "unsupported_command";

export interface OperatorCommandRequest {
  command?: string;
  args?: string[];
  serviceId?: string;
  tail?: number;
  actor?: OperatorCommandActorEnvelope;
}

export type OperatorCommandActorSource = "api" | "shell" | "web" | "chat-bridge";
export type OperatorCommandChatChannel = "telegram" | "custom";

export interface OperatorCommandActorEnvelope {
  source?: OperatorCommandActorSource;
  actorId?: string;
  roles?: string[];
  channel?: OperatorCommandChatChannel;
  chatId?: string;
  senderId?: string;
  senderDisplay?: string | null;
  sourceMessageId?: string | null;
  planId?: string | null;
  confirmationId?: string | null;
}

export interface NormalizedOperatorCommandActorEnvelope {
  source: OperatorCommandActorSource;
  actorId: string;
  roles: string[];
  channel?: OperatorCommandChatChannel;
  chatId?: string;
  senderId?: string;
  senderDisplay?: string | null;
  sourceMessageId?: string | null;
  planId?: string | null;
  confirmationId?: string | null;
}

export interface OperatorCommandAuditEvent {
  contractVersion: "operator-command-audit.v1";
  id: string;
  at: string;
  source: OperatorCommandActorSource;
  actorId: string;
  roles: string[];
  channel: OperatorCommandChatChannel | null;
  chatId: string | null;
  senderId: string | null;
  senderDisplay: string | null;
  sourceMessageId: string | null;
  command: OperatorCommandKind | "unsupported";
  commandClass: "read" | "plan" | "blocked";
  targetServiceId: string | null;
  resultStatus: "success" | "denied" | "failed";
  statusCode: number;
  errorCode: OperatorCommandErrorCode | null;
  redacted: boolean;
  truncated: boolean;
  planId: string | null;
  confirmationId: string | null;
}

export interface OperatorCommandResponse {
  contractVersion: "operator-command.v1";
  ok: boolean;
  statusCode: number;
  command: OperatorCommandKind | "unsupported";
  commandClass: "read" | "plan" | "blocked";
  generatedAt: string;
  summary: string;
  data: unknown;
  error: {
    code: OperatorCommandErrorCode;
    message: string;
  } | null;
  safety: {
    mutating: false;
    redacted: boolean;
    truncated: boolean;
    omittedSensitiveFields: string[];
  };
  audit: OperatorCommandAuditEvent;
}

export type OperatorCommandConfirmationStatus = "pending" | "confirmed" | "expired" | "denied" | "executed";
export type OperatorCommandConfirmationEventKind = "issued" | "confirmed" | "expired" | "denied" | "executed";

export interface OperatorCommandConfirmationIssueRequest {
  command?: string;
  args?: string[];
  serviceId?: string;
  actor?: OperatorCommandActorEnvelope;
  planId?: string;
  plan?: unknown;
  expiresInSeconds?: number;
}

export interface OperatorCommandConfirmationConfirmRequest {
  actor?: OperatorCommandActorEnvelope;
  plan?: unknown;
  confirmationPhrase?: string;
}

export interface OperatorCommandConfirmationExecuteRequest {
  actor?: OperatorCommandActorEnvelope;
  plan?: unknown;
}

export interface OperatorCommandConfirmationRecord {
  contractVersion: "operator-command-confirmation.v1";
  id: string;
  status: OperatorCommandConfirmationStatus;
  command: "restart" | "start" | "stop";
  canonicalCommand: string;
  targetServiceId: string;
  planId: string;
  planFingerprint: string;
  capabilityFingerprint: string;
  actor: NormalizedOperatorCommandActorEnvelope;
  issuedAt: string;
  expiresAt: string;
  confirmedAt: string | null;
  deniedAt: string | null;
  denialReason: string | null;
  executedAt: string | null;
}

export interface OperatorCommandConfirmationAuditEvent {
  contractVersion: "operator-command-confirmation-audit.v1";
  id: string;
  at: string;
  confirmationId: string;
  event: OperatorCommandConfirmationEventKind;
  resultStatus: "success" | "denied" | "failed";
  errorCode: string | null;
  actorId: string;
  channel: OperatorCommandChatChannel | null;
  chatId: string | null;
  senderId: string | null;
  sourceMessageId: string | null;
  command: OperatorCommandConfirmationRecord["command"];
  targetServiceId: string;
  planId: string;
}

export interface OperatorCommandConfirmationResponse {
  contractVersion: "operator-command-confirmation-response.v1";
  ok: boolean;
  confirmation: OperatorCommandConfirmationRecord;
  confirmationPhrase?: string;
  audit: OperatorCommandConfirmationAuditEvent;
}

export interface OperatorCommandConfirmationExecutionResponse {
  contractVersion: "operator-command-confirmation-execution-response.v1";
  ok: boolean;
  confirmation: OperatorCommandConfirmationRecord;
  audit: OperatorCommandConfirmationAuditEvent;
  action: LifecycleActionResponse;
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

export interface DependencyReverseLookupResponse {
  dependencies: {
    target: {
      id: string;
      name: string | null;
      exists: boolean;
    };
    dependents: Array<{
      id: string;
      name: string;
      relation: "direct" | "transitive";
      depth: number;
      path: string[];
      blockedBy: Array<{
        id: string;
        name: string | null;
        missing: boolean;
      }>;
    }>;
    summary: {
      total: number;
      direct: number;
      transitive: number;
      missingTarget: boolean;
    };
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
  healthHistory?: ServiceHealthHistoryState;
  statePaths?: ServiceStatePaths;
  provider?: ProviderExecutionPlan;
}

export interface ServiceHealthResponse {
  serviceId: string;
  health: ServiceHealthResult;
  history: ServiceHealthHistoryState;
}

export interface ServiceHealthHistoryResponse {
  serviceId: string;
  history: ServiceHealthHistoryState;
}

export interface ServiceStartTraceResponse {
  serviceId: string;
  trace: ServiceStartTraceState["current"];
  history: ServiceStartTraceState["history"];
}

export interface SecretReferenceAuditFindingResponse {
  serviceId: string;
  ref: string;
  namespace?: string;
  key?: string;
  status: "present" | "missing" | "malformed";
  source:
    | "env"
    | "globalenv"
    | "install"
    | "config"
    | "broker.import"
    | "broker.export"
    | "broker.writeback";
  location: string;
  required?: boolean;
  reason: string;
}

export interface ServiceSecretReferenceAuditResponse {
  serviceId: string;
  manifestPath: string;
  findings: SecretReferenceAuditFindingResponse[];
  summary: {
    present: number;
    missing: number;
    malformed: number;
  };
}

export interface SecretReferenceAuditResponse {
  services: ServiceSecretReferenceAuditResponse[];
  summary: {
    services: number;
    references: number;
    present: number;
    missing: number;
    malformed: number;
  };
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

export interface RuntimeDryRunPlanStep {
  order: number;
  serviceId: string;
  action: "start" | "stop" | "updateInstall" | "importService";
  status: "would_run" | "skipped" | "blocked";
  reason: string | null;
  prerequisites: string[];
  expectedStateChanges: string[];
  actionEndpoint: string;
  metadata?: Record<string, string | number | boolean | null | string[]>;
}

export interface RuntimeDryRunPlanResponse {
  action: "startAll" | "stopAll" | "autostart" | "updateInstall" | "importService";
  dryRun: true;
  ok: boolean;
  generatedAt: string;
  order: string[];
  steps: RuntimeDryRunPlanStep[];
  skipped: RuntimeOrchestrationSkippedService[];
  blockers: RuntimeOrchestrationSkippedService[];
  mutations: [];
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
  available: boolean;
  availableTypes: Array<"default" | "stdout" | "stderr">;
  sources: ServiceLogSourceResponse[];
}

export interface ServiceLogChunkResponse {
  serviceId: string;
  type: "default" | "stdout" | "stderr";
  path: string;
  available: boolean;
  source: ServiceLogSourceResponse;
  totalLines: number;
  start: number;
  end: number;
  hasMore: boolean;
  nextBefore: number;
  cursor: string;
  nextCursor: string | null;
  limit: number;
  entries: ServiceLogLineResponse[];
  lines: string[];
}

export interface ServiceLogLineResponse {
  source: {
    kind: "current" | "archive";
    archiveId?: string;
    path: string;
    lineNumber: number;
  };
  stream: "stdout" | "stderr" | "unknown";
  message: string;
  text: string;
  truncated: boolean;
}

export interface ServiceLogSearchResponse {
  serviceId: string;
  type: "default" | "stdout" | "stderr";
  path: string;
  query: string;
  includeArchives: boolean;
  limit: number;
  cursor: string;
  nextCursor: string | null;
  hasMore: boolean;
  totalScanned: number;
  matches: ServiceLogLineResponse[];
}

export interface ServiceLogSourceResponse {
  kind: "current" | "archive";
  stream: "combined" | "stdout" | "stderr";
  runId: string;
  archiveId?: string;
  path: string;
  available: boolean;
}

export interface RuntimeLogShippingPreviewResponse {
  logShipping: RuntimeLogShippingPreview;
}

export interface RuntimeTelemetryPreviewResponse {
  telemetry: RuntimeTelemetryPreview;
}

export interface ServiceTelemetryPreviewResponse {
  telemetry: ServiceTelemetryPreview;
}

export interface RuntimeTelemetryExportTestResponse {
  exportTest: TelemetryExportTestResult;
}
