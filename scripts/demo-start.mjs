import { prepareCanonicalDemoOptions } from "./demo-canonical-root.mjs";
import {
  getDemoStatus,
  printDemoStatus,
  repoRoot,
  resolveDemoOptions,
  runCoreWorkspaceLifecycle,
  writeDemoLifecycleState,
} from "./demo-instance-lib.mjs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const options = await prepareCanonicalDemoOptions(resolveDemoOptions());
const result = await runCoreWorkspaceLifecycle("start", {
  ...options,
  port: options.port,
  portPolicy: "preferred",
});

const startedStatus = await getDemoStatus({
  ...options,
  runtimeUrl: result.apiUrl ?? options.runtimeUrl,
});
const lifecycleState = await writeDemoLifecycleState(startedStatus, {
  phase: result.outcome === "already_running" ? "already_healthy" : "started",
});

if (options.json) {
  console.log(JSON.stringify({ ...result, status: startedStatus, lifecycleState }, null, 2));
} else if (result.outcome === "already_running") {
  console.log("[service-lasso demo] runtime already healthy");
  printDemoStatus({ ...startedStatus, lifecycleState });
  console.log(`- lifecyclePhase: ${lifecycleState.phase}`);
} else {
  console.log("[service-lasso demo] runtime started");
  console.log(`- api: ${result.apiUrl ?? "unknown"}`);
  console.log(`- servicesRoot: ${result.servicesRoot}`);
  console.log(`- workspaceRoot: ${result.workspaceRoot}`);
  console.log(`- lifecycleState: ${lifecycleState.paths.lifecycleStatePath}`);
  console.log("- stop: Ctrl+C or npm run demo:stop");
}

if (!result.ok) {
  process.exitCode = 1;
} else if (result.outcome === "started" || result.outcome === "restarted") {
  const shutdownModule = await import(
    pathToFileURL(path.join(repoRoot, "dist", "runtime", "lifecycle", "runtime-shutdown.js")).href
  );
  const shutdown = () => {
    void shutdownModule.invokeRegisteredRuntimeShutdown(result.workspaceRoot).finally(() => {
      process.exit(0);
    });
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  await shutdownModule.armRuntimeExitWait(result.workspaceRoot);
}
