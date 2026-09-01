import { prepareCanonicalDemoOptions } from "./demo-canonical-root.mjs";
import {
  getDemoStatus,
  printDemoStatus,
  resolveDemoOptions,
  runCoreWorkspaceLifecycle,
  writeDemoLifecycleState,
} from "./demo-instance-lib.mjs";

const options = await prepareCanonicalDemoOptions(resolveDemoOptions());
const result = await runCoreWorkspaceLifecycle("stop", options);
const status = await getDemoStatus(options);
const lifecycleState = await writeDemoLifecycleState(status, { phase: "stopped" });

if (options.json) {
  console.log(JSON.stringify({ ...result, status, lifecycleState }, null, 2));
} else {
  console.log(`[service-lasso demo] runtime ${result.outcome}`);
  printDemoStatus({ ...status, lifecycleState });
  console.log(`- ownership: ${result.ownership}`);
  console.log(`- stopMode: ${result.stopMode}`);
}

if (!result.ok) {
  process.exitCode = 1;
}
