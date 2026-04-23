import { createDefaultServiceRootConfig, describeRuntimeBoundary } from "./layout.js";
import { startApiServer, type ApiServerOptions, type RunningApiServer } from "../server/index.js";
import { ensureRuntimeConfig, resolveRuntimeConfig } from "./config.js";

export interface RuntimeApp {
  mode: "development";
  boundary: ReturnType<typeof describeRuntimeBoundary>;
  serviceRoot: ReturnType<typeof createDefaultServiceRootConfig>;
  apiServer: RunningApiServer;
}

export async function startRuntimeApp(options: ApiServerOptions = {}): Promise<RuntimeApp> {
  const defaults = createDefaultServiceRootConfig();
  const serviceRoot = await ensureRuntimeConfig(
    resolveRuntimeConfig({
      servicesRoot: options.servicesRoot ?? defaults.servicesRoot,
      workspaceRoot: options.workspaceRoot ?? defaults.workspaceRoot,
      version: options.version,
    }),
  );
  const apiServer = await startApiServer({
    servicesRoot: serviceRoot.servicesRoot,
    workspaceRoot: serviceRoot.workspaceRoot,
    port: options.port,
    version: serviceRoot.version,
  });

  return {
    mode: "development",
    boundary: describeRuntimeBoundary(),
    serviceRoot,
    apiServer,
  };
}
