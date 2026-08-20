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
import type { EffectiveServiceRouteMetadataSummary } from "../runtime/operator/endpoints.js";
import type { ServiceCatalogProvenance } from "./service.js";
import type { ServiceActionRunState } from "../runtime/actions/runs.js";
import type { ServiceWorkspaceRegistry } from "../runtime/files/workspace-registry.js";
import type {
  OperatorInboxCounts,
  OperatorInboxItem,
} from "../runtime/operator/inbox.js";

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

export interface RuntimeSetupStatusResponse {
  setup: {
    contractVersion: "service-lasso.setup-status.v1";
    state:
      | "not_required"
      | "setup_required"
      | "setup_in_progress"
      | "setup_complete"
      | "setup_failed";
    setupMode: boolean;
    vault: {
      required: boolean;
      ready: boolean;
      path: string;
    };
    operator: {
      osUsername: string;
      identitySource: "vault";
    };
    trustBoundary: {
      bindHost: string;
      localOnly: boolean;
      localhostBootstrapAllowed: boolean;
      remoteBootstrapAllowed: boolean;
      setupTokenConfigured: boolean;
      blockers: string[];
    };
    auth: RuntimeAuthStatusResponse["auth"];
  };
}

export interface RuntimeAuthStatusResponse {
  auth: {
    contractVersion: "service-lasso.auth-status.v1";
    request: {
      clientAddress: string | null;
      local: boolean;
    };
    policy: {
      bindHost: string;
      remoteAuthRequired: boolean;
      trustProxyHeaders: boolean;
      zitadelEnabled: boolean;
      localTokenConfigured: boolean;
      localOperatorConfigured: boolean;
      forceSso: boolean;
      firstRunPending: boolean;
      credentialsAcknowledged: boolean;
      identityProviders: Array<{
        id: string;
        label: string;
        kind: "zitadel";
        startUrl: string | null;
      }>;
    };
    actor: {
      authenticated: boolean;
      kind: "local-root" | "zitadel" | "local-token" | null;
      actorId: string | null;
    };
    mode: "local-root" | "zitadel" | "local-token" | "blocked";
    blockers: string[];
  };
}

export interface RuntimeLocalAuthResponse {
  auth: RuntimeAuthStatusResponse["auth"];
  session: {
    kind: "local-token";
    token: string;
  };
}

export interface RuntimeLocalAuthFirstRunResponse {
  firstRun: {
    pending: true;
    username: string;
    token: string;
    password: string;
  };
}

export interface RuntimeLocalAuthFirstRunAcknowledgeResponse {
  firstRun: {
    pending: false;
    credentialsAcknowledged: true;
  };
}

export interface RuntimeSetupBootstrapResponse {
  bootstrap: {
    ok: true;
    state: "setup_complete";
  };
  setup: RuntimeSetupStatusResponse["setup"];
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
  providerCapabilities?: Record<string, string>;
  providerRequirements?: Array<{
    capability: string;
    requirement: string;
    serviceId: string;
    version: string;
  }>;
  lifecycle?: ServiceLifecycleState;
  health?: ServiceHealthResult;
  healthHistory?: ServiceHealthHistoryState;
  updates?: ServiceUpdateState;
  recovery?: ServiceRecoveryHistoryState;
  catalogProvenance?: ServiceCatalogProvenance;
  statePaths?: ServiceStatePaths;
  provider?: ProviderExecutionPlan;
  routeMetadata?: EffectiveServiceRouteMetadataSummary;
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
  status: "satisfied" | "missing" | "not-ready" | "declared";
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
  metadata?: Record<string, AuditSafeMetadataValue>;
  chainId: string;
  sequence: number;
  previousHash: string | null;
  eventHash: string;
  chainStatus: "verified" | "broken" | "unavailable";
}

export type AuditSafeMetadataValue =
  | string
  | number
  | boolean
  | null
  | AuditSafeMetadataValue[]
  | { [key: string]: AuditSafeMetadataValue };

export type AuditChainStatus = "verified" | "broken" | "unavailable" | "mixed";

export interface AuditQuery {
  serviceId?: string;
  actor?: string;
  action?: string;
  outcome?: AuditEventOutcome;
  subjectType?: string;
  source?: string;
  since?: string;
  until?: string;
  query?: string;
  limit?: string;
  cursor?: string;
}

export interface AuditResponse {
  events: AuditEvent[];
  nextCursor: string | null;
  source: "runtime-audit";
  chainStatus: AuditChainStatus;
  rawMaterialReturned: false;
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

export interface ServiceWorkspaceRegistryResponse {
  registry: ServiceWorkspaceRegistry;
}

export interface ServiceFileExportArchiveResponse {
  ok: true;
  action: "archive-selection";
  export: {
    contractVersion: "service-lasso.file-export-artifact.v1";
    artifactId: string;
    createdAt: string;
    serviceId: string;
    sourceId: string;
    rootId: string;
    selectedPaths: string[];
    archiveFormat: "7z";
    provider: {
      serviceId: "@archive";
      actionId: "archive-selection";
      version: string | null;
      runId: string;
      status: "succeeded";
    };
    artifact: {
      id: string;
      fileName: string;
      format: "7z";
      sizeBytes: number;
      checksum: {
        algorithm: "sha256";
        value: string;
      };
      downloadUrl: string;
    };
  };
}

export interface ServiceDetailResponse {
  service: ServiceSummary;
}

export interface ServiceConfigDriftResponse {
  drift: ConfigDriftReport;
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

export type RuntimeInstanceStatus = "active" | "stale" | "unknown";
export type RuntimeGenerationPhase = "starting" | "running" | "stopping" | "stopped" | "failed" | "superseded";

export interface RuntimeSourceIdentity {
  branch: string | null;
  commit: string | null;
}

export interface RuntimeGenerationRecord {
  generationId: string;
  instanceId: string;
  servicesRoot: string;
  workspaceRoot: string;
  runtimeRoot: string;
  pid: number;
  phase: RuntimeGenerationPhase;
  startedAt: string;
  updatedAt: string;
  finishedAt: string | null;
  allocationRevision: string | null;
  endpoints: Array<{ name: string; url: string }>;
  source: RuntimeSourceIdentity;
}

export interface RuntimeGenerationRegistrySnapshot {
  path: string;
  activeGenerationId: string | null;
  generations: RuntimeGenerationRecord[];
}

export type RuntimeLaneClassification =
  | "selected"
  | "not_found"
  | "stale"
  | "ambiguous"
  | "wrong_lane"
  | "unknown_owner";

export interface RuntimeLaneSelection {
  classification: RuntimeLaneClassification;
  reason: string;
  selectedGenerationId: string | null;
  selectedInstanceId: string | null;
  workspaceRoot: string;
  servicesRoot: string;
  endpoint: string | null;
  runtimeIdentity: {
    pid: number;
    createdAt: string;
    executablePath: string;
    commandHash: string;
  } | null;
  candidateGenerationIds: string[];
}

export interface RuntimeInstanceRecord {
  instanceId: string;
  generationId: string;
  servicesRoot: string;
  workspaceRoot: string;
  runtimeRoot: string;
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
  phase: RuntimeGenerationPhase;
  source: RuntimeSourceIdentity;
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
  generations: RuntimeGenerationRegistrySnapshot;
  selection: RuntimeLaneSelection;
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
  serviceFiles: boolean;
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

export type VaultKeySourceType = "os-managed" | "file" | "env" | "cli" | "generated";

export interface VaultKeyFingerprintResponse {
  algorithm: "sha256";
  value: string;
  display: string;
}

export interface VaultKeySourceResponse {
  type: VaultKeySourceType;
  supplied: boolean;
  reveal: "never" | "once";
  envName?: string;
  filePath?: string;
  fingerprint: VaultKeyFingerprintResponse;
}

export interface VaultKeyOneTimeRevealResponse {
  key: string;
  confirmationRequired: true;
  warning: string;
}

export interface VaultKeyBootstrapResponse {
  contractVersion: "vault-key-bootstrap.v1";
  status: "ready";
  source: VaultKeySourceResponse;
  oneTimeReveal: VaultKeyOneTimeRevealResponse | null;
  warnings: string[];
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
  /** Persisted managed-process id, or null when no process is recorded. */
  pid: number | null;
  /** Current runtime log run id, or null when no run is recorded. */
  runId: string | null;
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

/**
 * Packaged Service Admin dashboard cards read `messages` and crash if this object is missing.
 */
export interface DashboardUpdateNotificationsResponse {
  latestCount: number;
  availableCount: number;
  downloadedCount: number;
  deferredCount: number;
  failedCount: number;
  messages: string[];
}

/**
 * Packaged Service Admin dashboard cards read `messages` and crash if this object is missing.
 */
export interface DashboardRecoveryNotificationsResponse {
  monitorAttentionCount: number;
  doctorBlockedCount: number;
  hookBlockedCount: number;
  restartFailureCount: number;
  messages: string[];
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
    updateNotifications: DashboardUpdateNotificationsResponse;
    recoveryNotifications: DashboardRecoveryNotificationsResponse;
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

export interface OperatorInboxListResponse {
  inbox: {
    items: OperatorInboxItem[];
    pagination: {
      limit: number;
      nextCursor: string | null;
      total: number;
    };
  };
}

export interface OperatorInboxItemResponse {
  inboxItem: OperatorInboxItem;
}

export interface OperatorInboxMutationResponse {
  inbox: {
    items: OperatorInboxItem[];
    counts: OperatorInboxCounts;
  };
}

export interface OperatorInboxCountsResponse {
  inbox: {
    counts: OperatorInboxCounts;
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

export interface ServiceStdinCapabilityResponse {
  available: boolean;
  reason?: string;
  auditRequired?: boolean;
  policy?: "allowed" | "denied" | "unavailable";
  provider?: string;
}

export interface ServiceStdinWriteResponse {
  serviceId: string;
  accepted: boolean;
  auditId?: string;
  message?: string;
}

export interface ServiceLogInfoResponse {
  serviceId: string;
  type: "default" | "stdout" | "stderr";
  path: string;
  available: boolean;
  availableTypes: Array<"default" | "stdout" | "stderr">;
  sources: ServiceLogSourceResponse[];
  stdin: ServiceStdinCapabilityResponse;
  capabilities: {
    stdin: ServiceStdinCapabilityResponse;
  };
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
  id?: string;
  label?: string;
  origin?: "builtin" | "declared" | "discovered";
  type?: "stream" | "file" | "glob";
  relativePath?: string;
  pattern?: string;
  format?: "text" | "json" | "ndjson";
  status?: "available" | "missing" | "unavailable";
  lastSeenAt?: string | null;
  sizeBytes?: number | null;
  tail?: boolean;
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

export interface ServiceCatalogRepositoryResponse {
  owner: string;
  name: string;
  url: string;
}

export interface ServiceCatalogVersionPolicyResponse {
  channel: "stable" | "preview";
  selector: "latest-semver" | "latest-release";
  allowPrerelease: boolean;
}

export interface ServiceCatalogReleaseAssetRuleResponse {
  namePattern: string;
  required: boolean;
}

export interface ServiceCatalogPackageResponse {
  packageId: string;
  displayName: string;
  summary: string;
  repository: ServiceCatalogRepositoryResponse;
  category: string;
  tags: string[];
  publisher: string;
  trustStatus: "approved" | "experimental" | "blocked";
  approved: boolean;
  defaultVersionPolicy: ServiceCatalogVersionPolicyResponse;
  releaseAsset: ServiceCatalogReleaseAssetRuleResponse;
  manifestPath: string;
}

export interface ServiceCatalogPackagesResponse {
  catalog: {
    catalogId: string;
    schemaVersion: string;
    updatedAt: string;
    source: string;
    packages: ServiceCatalogPackageResponse[];
    summary: {
      total: number;
      approved: number;
      categories: string[];
      filtered: number;
    };
  };
}

export interface ServiceCatalogReleaseAssetResponse {
  name: string;
  size: number | null;
  contentType: string | null;
  downloadUrl: string | null;
  selected: boolean;
}

export interface ServiceCatalogReleaseVersionResponse {
  tag: string;
  version: string;
  name: string | null;
  releaseUrl: string | null;
  createdAt: string | null;
  publishedAt: string | null;
  prerelease: boolean;
  draft: boolean;
  notesSummary: string | null;
  assets: ServiceCatalogReleaseAssetResponse[];
  selectedAsset: ServiceCatalogReleaseAssetResponse | null;
  default: boolean;
}

export interface ServiceCatalogPackageReleasesResponse {
  package: ServiceCatalogPackageResponse;
  versions: ServiceCatalogReleaseVersionResponse[];
  defaultVersion: ServiceCatalogReleaseVersionResponse | null;
  source: {
    type: "github-releases";
    apiBaseUrl: string;
    repository: string;
  };
  summary: {
    total: number;
    stable: number;
    prerelease: number;
    drafts: number;
  };
}

export interface ServiceCatalogInstallSelection {
  packageId: string;
  version?: string;
  assetName?: string;
}

export interface ServiceCatalogInstallRequest extends Partial<ServiceCatalogInstallSelection> {
  selections?: ServiceCatalogInstallSelection[];
  actor?: string;
}

export type ServiceCatalogInstallResultState =
  | "registered"
  | "failed"
  | "skipped/conflict";

export type ServiceCatalogInstallProgressState =
  | "pending"
  | "downloading"
  | "validating"
  | "copying"
  | "registered"
  | "failed"
  | "skipped/conflict";

export interface ServiceCatalogInstallResult {
  packageId: string;
  version: string | null;
  assetName: string | null;
  serviceId: string | null;
  serviceVersion: string | null;
  state: ServiceCatalogInstallResultState;
  ok: boolean;
  progress: ServiceCatalogInstallProgressState[];
  targetPath: string | null;
  conflict: {
    kind: "target_manifest_exists" | "target_directory_exists";
    path: string;
  } | null;
  reason: string | null;
  auditId?: string | null;
}

export interface ServiceCatalogInstallResponse {
  install: {
    ok: boolean;
    state: "completed" | "partial" | "failed";
    results: ServiceCatalogInstallResult[];
    summary: {
      total: number;
      registered: number;
      failed: number;
      conflicts: number;
    };
  };
}
