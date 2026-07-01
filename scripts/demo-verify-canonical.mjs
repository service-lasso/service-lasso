import { getDemoStatus, printDemoStatus, resolveDemoOptions } from "./demo-instance-lib.mjs";

const options = resolveDemoOptions();
const status = await getDemoStatus(options);

if (options.json) {
  console.log(JSON.stringify(status, null, 2));
} else {
  printDemoStatus(status);
}

if (!status.ok) {
  process.exitCode = 1;
}
