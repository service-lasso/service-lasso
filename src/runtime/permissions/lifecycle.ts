export type ServiceLifecycleAction = "install" | "config" | "start" | "stop" | "restart";

export interface ServiceLifecycleActionPolicy {
  permission: "service:install" | "service:configure" | "service:start" | "service:stop" | "service:restart";
  sensitive: boolean;
}

const lifecycleActionPolicies: Record<ServiceLifecycleAction, ServiceLifecycleActionPolicy> = {
  install: { permission: "service:install", sensitive: false },
  config: { permission: "service:configure", sensitive: false },
  start: { permission: "service:start", sensitive: false },
  stop: { permission: "service:stop", sensitive: true },
  restart: { permission: "service:restart", sensitive: true },
};

export function getServiceLifecycleActionPolicy(action: string): ServiceLifecycleActionPolicy | null {
  return Object.prototype.hasOwnProperty.call(lifecycleActionPolicies, action)
    ? lifecycleActionPolicies[action as ServiceLifecycleAction]
    : null;
}
