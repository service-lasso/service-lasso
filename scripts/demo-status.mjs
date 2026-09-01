import { prepareCanonicalDemoOptions } from "./demo-canonical-root.mjs";
import { formatCanonicalDemoReport, runCanonicalDemoStatus } from "./demo-canonical-lifecycle.mjs";
import { printDemoStatus, resolveDemoOptions } from "./demo-instance-lib.mjs";

const options = resolveDemoOptions();
const result = await runCanonicalDemoStatus(options);

if (options.json) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(formatCanonicalDemoReport(result));
  if (result.status) {
    printDemoStatus(result.status);
  }
}
