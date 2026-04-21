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
      provider: "direct" | "node" | "python" | null;
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
  type: "default";
  path: string;
  availableTypes: ["default"];
}

export interface ServiceLogChunkResponse {
  serviceId: string;
  type: "default";
  path: string;
  totalLines: number;
  start: number;
  end: number;
  hasMore: boolean;
  nextBefore: number;
  limit: number;
  lines: string[];
}
