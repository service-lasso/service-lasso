import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execute = promisify(execFile);
const helper = new URL("./hard-crash-child-exit.js", import.meta.url).href;

test("hard-crash exit releases the default two-minute timer and Node exits naturally", async () => {
  const source = `
    import { spawn } from "node:child_process";
    import { observeHardCrashChildExit } from ${JSON.stringify(helper)};
    const child = spawn(process.execPath, ["-e", "process.exit(86)"], { stdio: "ignore" });
    const result = await observeHardCrashChildExit(child);
    if (result.kind !== "exit" || result.code !== 86) throw new Error("Unexpected crash outcome");
    if (child.listenerCount("exit") !== 0 || child.listenerCount("error") !== 0) throw new Error("Retained observer");
    console.log("natural-exit");
  `;
  const result = await execute(process.execPath, ["--input-type=module", "-e", source], { timeout: 4_000 });
  assert.equal(result.stdout.trim(), "natural-exit");
});

test("hard-crash timeout removes its observer while leaving child termination to the caller", async () => {
  const source = `
    import { spawn } from "node:child_process";
    import { once } from "node:events";
    import { observeHardCrashChildExit } from ${JSON.stringify(helper)};
    const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
    try {
      const result = await observeHardCrashChildExit(child, 40);
      if (result.kind !== "timeout" || child.exitCode !== null || child.signalCode !== null) throw new Error("Changed timeout semantics");
      if (child.listenerCount("exit") !== 0 || child.listenerCount("error") !== 0) throw new Error("Retained observer");
    } finally {
      const exit = once(child, "exit");
      child.kill();
      await exit;
    }
    console.log("caller-cleanup");
  `;
  const result = await execute(process.execPath, ["--input-type=module", "-e", source], { timeout: 4_000 });
  assert.equal(result.stdout.trim(), "caller-cleanup");
});
