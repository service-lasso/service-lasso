import type { ProviderKind } from "../providers/types.js";

export type LifecycleAction = "install" | "config" | "start" | "stop" | "restart";

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
    logPath: string | null;
    stdoutPath: string | null;
    stderrPath: string | null;
  };
  metrics: ServiceRuntimeMetricsState;
}

export interface ServiceLifecycleState {
  installed: boolean;
  configured: boolean;
  running: boolean;
  lastAction: LifecycleAction | null;
  actionHistory: LifecycleAction[];
  installArtifacts: ServiceMaterializedArtifactsState;
  configArtifacts: ServiceMaterializedArtifactsState;
  runtime: ServiceRuntimeState;
}

export interface LifecycleActionResult {
  ok: boolean;
  action: LifecycleAction;
  serviceId: string;
  state: ServiceLifecycleState;
  message: string;
}
