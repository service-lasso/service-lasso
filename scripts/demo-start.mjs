import { prepareCanonicalDemoOptions } from "./demo-canonical-root.mjs";
import { resolveDemoOptions, startDemoRuntime } from "./demo-instance-lib.mjs";

const options = await prepareCanonicalDemoOptions(resolveDemoOptions());
const runtime = await startDemoRuntime(options);

console.log("[service-lasso demo] ready");
console.log("- Service Admin: http://127.0.0.1:17700/");
console.log(`- Runtime API: ${runtime.apiServer.url}`);
console.log("- Stop: Ctrl+C");

const shutdown = async () => {
  await runtime.apiServer.stop();
  process.exit(0);
};

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
