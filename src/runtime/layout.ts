import {
  DEFAULT_SERVICES_ROOT,
  DEFAULT_WORKSPACE_ROOT,
  type RuntimeBoundarySummary,
  type ServiceRootConfig,
} from "../contracts/service-root.js";

export function createDefaultServiceRootConfig(): ServiceRootConfig {
  return {
    servicesRoot: DEFAULT_SERVICES_ROOT,
    workspaceRoot: DEFAULT_WORKSPACE_ROOT,
  };
}

export function describeRuntimeBoundary(): RuntimeBoundarySummary {
  return {
    entrypoint: "src/index.ts",
    runtimeModule: "src/runtime/layout.ts",
    contractsModule: "src/contracts/service-root.ts",
    fixturesModule: "src/fixtures/README.md",
    status: "layout-only",
  };
}
