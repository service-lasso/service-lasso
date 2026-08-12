import { prepareCanonicalDemoOptions } from "./demo-canonical-root.mjs";
import { resolveDemoOptions, runDemoSmoke } from "./demo-instance-lib.mjs";

const options = await prepareCanonicalDemoOptions(resolveDemoOptions(), { replace: true });
const result = await runDemoSmoke(options);

console.log("[service-lasso demo] smoke passed");
console.log(`- api: ${result.url}`);
console.log(`- servicesRoot: ${result.servicesRoot}`);
console.log(`- workspaceRoot: ${result.workspaceRoot}`);
console.log(`- exercised: ${result.summary.demoServicesExercised.join(", ")}`);
