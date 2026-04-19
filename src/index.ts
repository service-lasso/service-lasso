import { startRuntimeApp } from "./runtime/app.js";

async function main(): Promise<void> {
  const app = await startRuntimeApp({
    port: Number(process.env.SERVICE_LASSO_PORT ?? 18080),
    version: process.env.npm_package_version ?? "0.1.0",
  });

  console.log("[service-lasso] core API spine started");
  console.log(`- api: ${app.apiServer.url}`);
  console.log(`- servicesRoot: ${app.serviceRoot.servicesRoot}`);
  console.log(`- stateRoot: ${app.serviceRoot.stateRoot}`);
}

main().catch((error: unknown) => {
  console.error("[service-lasso] failed to start core API spine");
  console.error(error);
  process.exitCode = 1;
});
