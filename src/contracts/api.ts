import type { LifecycleAction, ServiceLifecycleState } from "../runtime/lifecycle/types.js";
import type { ServiceHealthResult } from "../runtime/health/types.js";
import type { ProviderExecutionPlan } from "../runtime/providers/types.js";
import type { ServiceStatePaths } from "../runtime/state/paths.js";

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
