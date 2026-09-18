import { startRuntimeApp } from "./runtime/app.js";
import { resolveRuntimeVersion } from "./runtime/version.js";
import { readRuntimeStartupSettings } from "./runtime/startup/settings.js";

async function main(): Promise<void> {
  const stdioMcp = process.env.SERVICE_LASSO_MCP_STDIO === "1";
  const noAutostart = process.argv.includes("--noautostart");
  const workspaceRoot = process.env.SERVICE_LASSO_WORKSPACE_ROOT;
  const autostart = noAutostart ? false : (await readRuntimeStartupSettings(workspaceRoot ?? process.cwd())).autostart;
  const app = await startRuntimeApp({
    port: Number(process.env.SERVICE_LASSO_PORT ?? 18080),
    version: resolveRuntimeVersion(),
    autostart,
    noAutostart,
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
