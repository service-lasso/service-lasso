import { createDefaultServiceRootConfig, describeRuntimeBoundary } from "./layout.js";
import { startApiServer, type ApiServerOptions, type RunningApiServer } from "../server/index.js";

export interface RuntimeApp {
  mode: "development";
  boundary: ReturnType<typeof describeRuntimeBoundary>;
  serviceRoot: ReturnType<typeof createDefaultServiceRootConfig>;
  apiServer: RunningApiServer;
}

export async function startRuntimeApp(options: ApiServerOptions = {}): Promise<RuntimeApp> {
  const serviceRoot = createDefaultServiceRootConfig();
  const apiServer = await startApiServer({
    servicesRoot: options.servicesRoot ?? serviceRoot.servicesRoot,
    port: options.port,
    version: options.version,
  });

  return {
    mode: "development",
    boundary: describeRuntimeBoundary(),
    serviceRoot,
    apiServer,
  };
}
