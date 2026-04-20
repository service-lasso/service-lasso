export type LifecycleAction = "install" | "config" | "start" | "stop" | "restart";

export interface ServiceRuntimeState {
  pid: number | null;
  startedAt: string | null;
  exitCode: number | null;
  command: string | null;
}

export interface ServiceLifecycleState {
  installed: boolean;
  configured: boolean;
  running: boolean;
  lastAction: LifecycleAction | null;
  actionHistory: LifecycleAction[];
  runtime: ServiceRuntimeState;
}

export interface LifecycleActionResult {
  ok: boolean;
  action: LifecycleAction;
  serviceId: string;
  state: ServiceLifecycleState;
  message: string;
}
