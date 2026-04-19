export type LifecycleAction = "install" | "config" | "start" | "stop" | "restart";

export interface ServiceLifecycleState {
  installed: boolean;
  configured: boolean;
  running: boolean;
  lastAction: LifecycleAction | null;
  actionHistory: LifecycleAction[];
}

export interface LifecycleActionResult {
  ok: boolean;
  action: LifecycleAction;
  serviceId: string;
  state: ServiceLifecycleState;
  message: string;
}
