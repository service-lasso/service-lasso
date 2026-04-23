export interface ServiceRootConfig {
  servicesRoot: string;
  workspaceRoot: string;
}

export interface RuntimeBoundarySummary {
  entrypoint: string;
  runtimeModule: string;
  contractsModule: string;
  fixturesModule: string;
  status: "layout-only";
}

export const DEFAULT_SERVICES_ROOT = "./services";
export const DEFAULT_WORKSPACE_ROOT = "./workspace";
