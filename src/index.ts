import { createRuntimeLayoutReport } from "./runtime/app.js";

function main(): void {
  const report = createRuntimeLayoutReport();

  console.log("[service-lasso] core runtime scaffold ready");
  console.log(JSON.stringify(report, null, 2));
}

main();
