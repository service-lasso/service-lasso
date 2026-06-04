import { resolveDemoOptions, runDemoRecycle } from "./demo-instance-lib.mjs";

const options = resolveDemoOptions();
const result = await runDemoRecycle(options);

console.log("[service-lasso demo] recycle passed");
console.log(`- api: ${result.apiUrl}`);
console.log(`- serviceAdmin: ${result.serviceAdminUrl}`);
console.log(`- servicesRoot: ${result.servicesRoot}`);
console.log(`- workspaceRoot: ${result.workspaceRoot}`);
console.log(`- git: ${result.git.branch}@${result.git.commit}`);
console.log(`- services: ${result.services.map((service) => `${service.id}:running=${service.running}:healthy=${service.healthy}`).join(", ")}`);
console.log("- endpoints:");
for (const [name, endpoint] of Object.entries(result.endpoints)) {
  console.log(`  - ${name}: ${endpoint.status} ${endpoint.url}`);
}
