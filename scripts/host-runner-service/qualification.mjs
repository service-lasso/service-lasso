import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

for (const key of ["SERVICE_LASSO_HOST_RUNNER_WORKSPACE", "SERVICE_LASSO_HOST_RUNNER_INSTANCE", "SERVICE_LASSO_HOST_RUNNER_PORTS"]) {
  if (!process.env[key]) throw new Error(`missing required isolated qualification environment: ${key}`);
}
const root = path.resolve(import.meta.dirname);
if (process.platform === "win32") {
  execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `Add-Type -Path '${path.join(root, "windows", "HeldHandleContract.cs").replaceAll("'", "''")}'; if (-not ('HeldHandleContract' -as [type])) { exit 1 }`], { stdio: "inherit" });
} else if (process.platform === "linux") {
  const source = path.join(root, "linux", "sealed-fd-contract.c");
  if (existsSync("/usr/bin/cc")) execFileSync("/usr/bin/cc", ["-fsyntax-only", "-Wall", "-Werror", source], { stdio: "inherit" });
} else {
  process.stdout.write("native qualification unavailable on this operating system; no activation claim made.\n");
}
