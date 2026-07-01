import {
  getDemoStatus,
  printDemoStatus,
  resetDemoInstance,
  resolveDemoOptions,
  startDemoRuntime,
  writeDemoLifecycleState,
} from "./demo-instance-lib.mjs";

const options = resolveDemoOptions();
const status = await getDemoStatus(options);

if (status.ok) {
  const lifecycleState = await writeDemoLifecycleState(status, {
    phase: "recycle_verified_existing",
  });

  if (options.json) {
    console.log(JSON.stringify({ ...status, lifecycleState }, null, 2));
  } else {
    console.log("[service-lasso demo] recycle verified existing runtime");
    printDemoStatus({ ...status, lifecycleState });
    console.log(`- lifecyclePhase: ${lifecycleState.phase}`);
  }
} else {
  await resetDemoInstance(options);

  const runtime = await startDemoRuntime(options);
  const recycledStatus = await getDemoStatus({
    ...options,
    runtimeUrl: runtime.apiServer.url,
  });
  const lifecycleState = await writeDemoLifecycleState(recycledStatus, {
    phase: "recycled_started",
  });

  console.log("[service-lasso demo] recycle started runtime");
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
