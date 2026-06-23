import type { ProviderKind } from "../providers/types.js";
import type { ScopedBrokerIdentityMetadata } from "../broker/identity.js";

export type LifecycleAction = "install" | "config" | "setup" | "start" | "stop" | "restart";

export type SetupStepStatus = "succeeded" | "failed" | "timeout" | "skipped";

export type ServiceStartTracePhase =
  | "dependency_resolution"
  | "port_selection"
  | "artifact_acquisition"
  | "env_merge"
  | "process_spawn"
  | "health_check"
  | "terminal_outcome";

export type ServiceStartTraceEventStatus = "completed" | "blocked" | "failed" | "skipped";

export interface ServiceStartTraceEvent {
  order: number;
  phase: ServiceStartTracePhase;
  status: ServiceStartTraceEventStatus;
  serviceId: string;
  startedAt: string;
  finishedAt: string;
  message: string;
  metadata: Record<string, string | number | boolean | null | string[]>;
}

export interface ServiceStartTraceAttempt {
  attemptId: string;
  serviceId: string;
  action: "start" | "restart";
  startedAt: string;
  finishedAt: string | null;
  status: "running" | "succeeded" | "failed" | "blocked";
  events: ServiceStartTraceEvent[];
}

export interface ServiceStartTraceState {
  current: ServiceStartTraceAttempt | null;
  history: ServiceStartTraceAttempt[];
}

export interface ServiceSetupStepRunState {
  runId: string;
  serviceId: string;
  stepId: string;
  status: SetupStepStatus;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  command: string;
  exitCode: number | null;
  signal: string | null;
  message: string;
  logs: {
    logPath: string;
    stdoutPath: string;
    stderrPath: string;
  };
}

export interface ServiceSetupState {
  updatedAt: string | null;
  steps: Record<string, {
    status: SetupStepStatus;
    lastRun: ServiceSetupStepRunState | null;
    history: ServiceSetupStepRunState[];
  }>;
}

export interface ServiceMaterializedArtifactsState {
  files: string[];
  updatedAt: string | null;
  artifact?: {
    sourceType: "github-release" | null;
    repo: string | null;
    channel: string | null;
    tag: string | null;
    assetName: string | null;
    assetUrl: string | null;
    archiveType: "zip" | "tar.gz" | "tgz" | null;
    archivePath: string | null;
    extractedPath: string | null;
    command: string | null;
    args: string[];
    checksum: {
      algorithm: "sha256";
      source: "manifest" | "release-asset";
      expected: string;
      actual: string;
      assetName: string;
      checksumAssetName: string | null;
      verifiedAt: string;
    } | null;
  };
}

export interface ServiceRuntimeMetricsState {
  launchCount: number;
  stopCount: number;
  exitCount: number;
  crashCount: number;
  restartCount: number;
  totalRunDurationMs: number;
  lastRunDurationMs: number | null;
}

export interface ServiceRuntimeState {
  pid: number | null;
  startedAt: string | null;
  finishedAt: string | null;
  exitCode: number | null;
  command: string | null;
  provider: ProviderKind | null;
  providerServiceId: string | null;
  lastTermination: "stopped" | "exited" | "crashed" | null;
  ports: Record<string, number>;
  logs: {
    runId: string | null;
    logPath: string | null;
    stdoutPath: string | null;
    stderrPath: string | null;
  };
  metrics: ServiceRuntimeMetricsState;
  brokerIdentity: ScopedBrokerIdentityMetadata | null;
  startTrace: ServiceStartTraceState;
}

export interface ServiceLifecycleState {
  installed: boolean;
  configured: boolean;
  running: boolean;
  lastAction: LifecycleAction | null;
  actionHistory: LifecycleAction[];
  installArtifacts: ServiceMaterializedArtifactsState;
  configArtifacts: ServiceMaterializedArtifactsState;
  setup: ServiceSetupState;
  runtime: ServiceRuntimeState;
}

export interface LifecycleActionResult {
  ok: boolean;
  action: LifecycleAction;
  serviceId: string;
  state: ServiceLifecycleState;
  message: string;
}
