import {
  getDemoStatus,
  printDemoStatus,
  resolveDemoOptions,
  startDemoRuntime,
  writeDemoLifecycleState,
} from "./demo-instance-lib.mjs";

const options = resolveDemoOptions();
const status = await getDemoStatus(options);

if (status.ok) {
  const lifecycleState = await writeDemoLifecycleState(status, {
    phase: "already_healthy",
  });

  if (options.json) {
    console.log(JSON.stringify({ ...status, lifecycleState }, null, 2));
  } else {
    console.log("[service-lasso demo] runtime already healthy");
    printDemoStatus({ ...status, lifecycleState });
    console.log(`- lifecyclePhase: ${lifecycleState.phase}`);
  }
} else {
  const runtime = await startDemoRuntime(options);
  const startedStatus = await getDemoStatus({
    ...options,
    runtimeUrl: runtime.apiServer.url,
  });
  const lifecycleState = await writeDemoLifecycleState(startedStatus, {
    phase: "started",
  });

  console.log("[service-lasso demo] runtime started");
  console.log(`- api: ${runtime.apiServer.url}`);
  console.log(`- servicesRoot: ${runtime.serviceRoot.servicesRoot}`);
  console.log(`- workspaceRoot: ${runtime.serviceRoot.workspaceRoot}`);
  console.log(`- lifecycleState: ${lifecycleState.paths.lifecycleStatePath}`);
  console.log("- stop: Ctrl+C");

  const shutdown = async () => {
    await runtime.apiServer.stop();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}
