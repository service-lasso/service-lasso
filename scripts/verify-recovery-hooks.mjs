import { execFile as execFileCallback } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

await execFile(
  process.execPath,
  ["--test", "--test-concurrency=1", "tests/recovery-e2e.test.js"],
  {
    cwd: repoRoot,
    stdio: "inherit",
    env: {
      ...process.env,
      npm_package_version: "0.1.0-verify-recovery-hooks",
    },
  },
);

console.log("[service-lasso] recovery and hook verification passed");

