import { startRuntimeApp } from "./runtime/app.js";
import { resolveRuntimeVersion } from "./runtime/version.js";

async function main(): Promise<void> {
  const stdioMcp = process.env.SERVICE_LASSO_MCP_STDIO === "1";
  const app = await startRuntimeApp({
    port: Number(process.env.SERVICE_LASSO_PORT ?? 18080),
    version: resolveRuntimeVersion(),
  });

  const report = stdioMcp ? console.error : console.log;
  report("[service-lasso] core API spine started");
  report(`- api: ${app.apiServer.url}`);
  report(`- servicesRoot: ${app.serviceRoot.servicesRoot}`);
  report(`- workspaceRoot: ${app.serviceRoot.workspaceRoot}`);
}

main().catch((error: unknown) => {
  console.error("[service-lasso] failed to start core API spine");
  console.error(error);
  process.exitCode = 1;
});
