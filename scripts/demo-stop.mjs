import { prepareCanonicalDemoOptions } from "./demo-canonical-root.mjs";
import { formatCanonicalDemoReport, runCanonicalDemoStop } from "./demo-canonical-lifecycle.mjs";
import { resolveDemoOptions } from "./demo-instance-lib.mjs";

const options = await prepareCanonicalDemoOptions(resolveDemoOptions());
const result = await runCanonicalDemoStop(options);

if (options.json) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(formatCanonicalDemoReport(result));
}

if (!result.ok) {
  process.exitCode = 1;
}
