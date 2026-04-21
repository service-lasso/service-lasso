export type LifecycleAction = "install" | "config" | "start" | "stop" | "restart";

export interface ServiceMaterializedArtifactsState {
  files: string[];
  updatedAt: string | null;
}

export interface ServiceRuntimeState {
  pid: number | null;
  startedAt: string | null;
  finishedAt: string | null;
  exitCode: number | null;
  command: string | null;
  provider: "direct" | "node" | "python" | null;
  providerServiceId: string | null;
  lastTermination: "stopped" | "exited" | "crashed" | null;
  ports: Record<string, number>;
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
