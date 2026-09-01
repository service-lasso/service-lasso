import path from "node:path";
import { pathToFileURL } from "node:url";
import { prepareCanonicalDemoOptions } from "./demo-canonical-root.mjs";
import { formatCanonicalDemoReport, runCanonicalDemoStart } from "./demo-canonical-lifecycle.mjs";
import { repoRoot, resolveDemoOptions } from "./demo-instance-lib.mjs";

const options = await prepareCanonicalDemoOptions(resolveDemoOptions());
const result = await runCanonicalDemoStart(options);

if (options.json) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(formatCanonicalDemoReport(result));
  if (result.stayResident) {
    console.log("- stop: Ctrl+C or npm run demo:stop");
  }
}

if (!result.ok) {
  process.exitCode = 1;
} else if (result.stayResident) {
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
