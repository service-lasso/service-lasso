export interface ServiceRootConfig {
  servicesRoot: string;
  dataRoot: string;
  stateRoot: string;
}

export interface RuntimeBoundarySummary {
  entrypoint: string;
  runtimeModule: string;
  contractsModule: string;
  fixturesModule: string;
  status: "layout-only";
}

export const DEFAULT_SERVICES_ROOT = "./services";
export const DEFAULT_DATA_ROOT = "./.local/data";
export const DEFAULT_STATE_ROOT = "./.state";
