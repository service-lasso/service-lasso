import { resolveDemoOptions, resetDemoInstance } from "./demo-instance-lib.mjs";

const options = resolveDemoOptions();
await resetDemoInstance(options);

console.log("[service-lasso demo] reset complete");
console.log(`- servicesRoot: ${options.servicesRoot}`);
console.log(`- workspaceRoot: ${options.workspaceRoot}`);
