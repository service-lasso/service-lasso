import type { ServiceHealthcheck } from "../runtime/health/types.js";

export interface ServiceEndpoint {
  label: string;
  url: string;
  kind?: string;
}

export interface ServicePortDeclaration {
  [name: string]: number;
}

export interface ServicePortMappingDeclaration {
  [name: string]: string;
}

export interface ServiceMaterializedFile {
  path: string;
  content: string;
}

export interface ServiceActionMaterialization {
  files?: ServiceMaterializedFile[];
}

export type ServiceHookFailurePolicy = "block" | "warn" | "continue";

export interface ServiceHookStep {
  name: string;
  command: string;
  args?: string[];
  cwd?: string;
  timeoutSeconds?: number;
  failurePolicy?: ServiceHookFailurePolicy;
  env?: Record<string, string>;
}

export interface ServiceMonitoringPolicy {
  enabled?: boolean;
  intervalSeconds?: number;
  unhealthyThreshold?: number;
  startupGraceSeconds?: number;
}

export interface ServiceRestartPolicy {
  enabled?: boolean;
  onCrash?: boolean;
  onUnhealthy?: boolean;
  maxAttempts?: number;
  backoffSeconds?: number;
}

export interface ServiceDoctorPolicy {
  enabled?: boolean;
  timeoutSeconds?: number;
  failurePolicy?: ServiceHookFailurePolicy;
  steps?: ServiceHookStep[];
}

export interface ServiceLifecycleHooks {
  preRestart?: ServiceHookStep[];
  postRestart?: ServiceHookStep[];
  preUpgrade?: ServiceHookStep[];
  postUpgrade?: ServiceHookStep[];
  rollback?: ServiceHookStep[];
  onFailure?: ServiceHookStep[];
}

export type ServiceSetupRerunPolicy = "manual" | "ifMissing" | "always";

export interface ServiceSetupStep {
  description?: string;
  depend_on?: string[];
  execservice?: string;
  executable?: string;
  args?: string[];
  commandline?: Record<string, string>;
  env?: Record<string, string>;
  timeoutSeconds?: number;
  rerun?: ServiceSetupRerunPolicy;
}

export interface ServiceSetupPolicy {
  steps?: Record<string, ServiceSetupStep>;
}

export type ServiceUpdateMode = "disabled" | "notify" | "download" | "install";
export type ServiceUpdateRunningServicePolicy = "skip" | "require-stopped" | "stop-start" | "restart";
export type ServiceUpdateWindowDay = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

export interface ServiceUpdateInstallWindow {
  days?: ServiceUpdateWindowDay[];
  start: string;
  end: string;
  timezone?: string;
}

export interface ServiceUpdatePolicy {
  enabled?: boolean;
  mode?: ServiceUpdateMode;
  track?: "pinned" | "latest" | (string & {});
  checkIntervalSeconds?: number;
  installWindow?: ServiceUpdateInstallWindow;
  runningService?: ServiceUpdateRunningServicePolicy;
}

export type ServiceArtifactArchiveType = "zip" | "tar.gz" | "tgz";

export interface ServiceArtifactSource {
  type: "github-release";
  repo: string;
  channel?: string;
  tag?: string;
  serviceManifestAssetUrl?: string;
  api_base_url?: string;
}

export interface ServiceArtifactPlatform {
  assetName?: string;
  assetUrl?: string;
  archiveType: ServiceArtifactArchiveType;
  command?: string;
  args?: string[];
}

export interface ServiceArchiveArtifact {
  kind: "archive";
  source: ServiceArtifactSource;
  platforms: Record<string, ServiceArtifactPlatform>;
}

export type ServiceRole = "service" | "provider";

export type ServiceBrokerBucketKind = "service" | "app" | "shared" | "global";

export interface ServiceBrokerBucket {
  namespace: string;
  kind?: ServiceBrokerBucketKind;
  description?: string;
}

export interface ServiceBrokerImport {
  namespace: string;
  ref: string;
  as?: string;
  required?: boolean;
}

export interface ServiceBrokerExport {
  namespace: string;
  ref: string;
  source: string;
  required?: boolean;
}

export type ServiceBrokerWritebackOperation = "create" | "update" | "rotate" | "delete";

export interface ServiceBrokerWritebackPolicy {
  allowedNamespaces?: string[];
  allowedOperations?: ServiceBrokerWritebackOperation[];
}

export interface ServiceBrokerPolicy {
  enabled?: boolean;
  namespace?: string;
  buckets?: ServiceBrokerBucket[];
  imports?: ServiceBrokerImport[];
  exports?: ServiceBrokerExport[];
  writeback?: ServiceBrokerWritebackPolicy;
}

export interface ServiceManifest {
  id: string;
  name: string;
  description: string;
  version?: string;
  role?: ServiceRole;
  enabled?: boolean;
  autostart?: boolean;
  depend_on?: string[];
  healthcheck?: ServiceHealthcheck;
  env?: Record<string, string>;
  globalenv?: Record<string, string>;
  broker?: ServiceBrokerPolicy;
  ports?: ServicePortDeclaration;
  portmapping?: ServicePortMappingDeclaration;
  urls?: ServiceEndpoint[];
  monitoring?: ServiceMonitoringPolicy;
  restartPolicy?: ServiceRestartPolicy;
  doctor?: ServiceDoctorPolicy;
  hooks?: ServiceLifecycleHooks;
  setup?: ServiceSetupPolicy;
  updates?: ServiceUpdatePolicy;
  artifact?: ServiceArchiveArtifact;
  install?: ServiceActionMaterialization;
  config?: ServiceActionMaterialization;
  execservice?: string;
  executable?: string;
  args?: string[];
  commandline?: Record<string, string>;
}

export interface DiscoveredService {
  manifest: ServiceManifest;
  manifestPath: string;
  serviceRoot: string;
}
