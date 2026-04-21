import { resolveDemoOptions, startDemoRuntime } from "./demo-instance-lib.mjs";

const options = resolveDemoOptions();
const runtime = await startDemoRuntime(options);

console.log("[service-lasso demo] runtime started");
console.log(`- api: ${runtime.apiServer.url}`);
console.log(`- servicesRoot: ${runtime.serviceRoot.servicesRoot}`);
console.log(`- workspaceRoot: ${runtime.serviceRoot.workspaceRoot}`);
console.log("- stop: Ctrl+C");

const shutdown = async () => {
  await runtime.apiServer.stop();
  process.exit(0);
};

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
