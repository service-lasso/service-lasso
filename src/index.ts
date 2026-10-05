import { startRuntimeApp } from "./runtime/app.js";
import { resolveRuntimeVersion } from "./runtime/version.js";

async function main(): Promise<void> {
  const stdioMcp = process.env.SERVICE_LASSO_MCP_STDIO === "1";
  let inputEnded = false;
  let stopRuntime: (() => Promise<void>) | undefined;
  const onInputEnd = () => {
    inputEnded = true;
    void stopRuntime?.();
  };
  if (stdioMcp) {
    process.stdin.once("end", onInputEnd);
    // The SDK may send SIGTERM while EOF shutdown is still settling managed
    // children. Preserve that same shutdown rather than abandoning it.
    process.on("SIGTERM", onInputEnd);
  }
  const noAutostart = process.argv.includes("--noautostart");
  const app = await startRuntimeApp({
    port: Number(process.env.SERVICE_LASSO_PORT ?? 18080),
    version: resolveRuntimeVersion(),
    autostart: noAutostart ? false : true,
    noAutostart,
  });

  const report = stdioMcp ? console.error : console.log;
  let shutdown: Promise<void> | undefined;
  stopRuntime = () => shutdown ??= app.apiServer.stop().catch((error: unknown) => {
    console.error("[service-lasso] failed to stop stdio runtime");
    console.error(error);
    process.exitCode = 1;
  });
  // EOF can arrive while startup is still acquiring the runtime. Stop only
  // after that exact runtime exists, using its ordinary awaited shutdown.
  if (stdioMcp && (inputEnded || process.stdin.readableEnded)) await stopRuntime();
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
