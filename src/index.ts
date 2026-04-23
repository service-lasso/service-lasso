import { startRuntimeApp } from "./runtime/app.js";
import { resolveRuntimeVersion } from "./runtime/version.js";

async function main(): Promise<void> {
  const app = await startRuntimeApp({
    port: Number(process.env.SERVICE_LASSO_PORT ?? 18080),
    version: resolveRuntimeVersion(),
  });

  console.log("[service-lasso] core API spine started");
  console.log(`- api: ${app.apiServer.url}`);
  console.log(`- servicesRoot: ${app.serviceRoot.servicesRoot}`);
  console.log(`- workspaceRoot: ${app.serviceRoot.workspaceRoot}`);
}

main().catch((error: unknown) => {
  console.error("[service-lasso] failed to start core API spine");
  console.error(error);
  process.exitCode = 1;
});
