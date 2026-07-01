import { getDemoGateReport, printDemoGateReport, resolveDemoOptions } from "./demo-instance-lib.mjs";

const options = resolveDemoOptions();
const report = await getDemoGateReport(options);

if (options.json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  printDemoGateReport(report);
}

if (!report.ok) {
  process.exitCode = 1;
}
