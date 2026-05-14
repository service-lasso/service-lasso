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
  const apiPort = options.port ?? Number(process.env.SERVICE_LASSO_PORT ?? 18080);
  process.env.SERVICE_LASSO_RUNTIME_API_BASE_URL = `http://127.0.0.1:${apiPort}`;

  const serviceRoot = await ensureRuntimeConfig(
    resolveRuntimeConfig({
      servicesRoot: options.servicesRoot,
      workspaceRoot: options.workspaceRoot,
      version: options.version,
    }),
  );
  const apiServer = await startApiServer({
    servicesRoot: serviceRoot.servicesRoot,
    workspaceRoot: serviceRoot.workspaceRoot,
    port: apiPort,
    version: serviceRoot.version,
  });

  return {
    mode: "development",
    boundary: describeRuntimeBoundary(),
    serviceRoot,
    apiServer,
  };
}
