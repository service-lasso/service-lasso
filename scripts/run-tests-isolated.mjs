import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { glob } from "node:fs/promises";
import { spawn } from "node:child_process";

const testRoot = await mkdtemp(path.join(os.tmpdir(), "service-lasso-test-host-state-"));
const workspaceRoot = path.join(testRoot, "workspace");
await mkdir(workspaceRoot, { recursive: true });
const testFiles = [];
for await (const filePath of glob("tests/**/*.test.js")) {
  testFiles.push(filePath);
}
testFiles.sort();

if (testFiles.length === 0) {
  throw new Error("No test files were found.");
}

try {
  const child = spawn(process.execPath, ["--test", "--test-concurrency=1", ...testFiles], {
    stdio: "inherit",
    env: {
      ...process.env,
      SERVICE_LASSO_INSTANCE_REGISTRY_PATH: path.join(testRoot, "instances.json"),
      SERVICE_LASSO_HOST_PORT_REGISTRY_PATH: path.join(testRoot, "endpoint-allocations.json"),
      SERVICE_LASSO_WORKSPACE_ROOT: workspaceRoot,
    },
  });
  const [code, signal] = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (exitCode, exitSignal) => resolve([exitCode, exitSignal]));
  });
  if (code !== 0) {
    throw new Error(signal
      ? `Test runner terminated by ${signal}.`
      : `Test runner exited with code ${code ?? "unknown"}.`);
  }
} finally {
  await rm(testRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
