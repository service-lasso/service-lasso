import test from "node:test";
import assert from "node:assert/strict";
import { startupCrashFailureDiagnostic } from "./startup-crash-diagnostics.js";
import { fork } from "node:child_process";
import { once } from "node:events";
import { rm } from "node:fs/promises";
import path from "node:path";
import { makeTempServicesRoot } from "./test-helpers.js";

test("AC-4BJ.9a crash diagnostics retain only closed phase and lifecycle metadata", () => {
  const result = startupCrashFailureDiagnostic("ownership_persisted", {
    failurePhase: "target_acknowledgement",
    code: "PROCESS_CONTROL_DEADLINE_EXCEEDED",
    message: "PRIVATE-SENTINEL",
    stack: "PRIVATE-SENTINEL",
  }, { runtime: { startTrace: { current: { status: "failed", events: [
    { phase: "process_spawn", status: "failed", message: "PRIVATE-SENTINEL" },
  ] } } } });
  assert.equal(result.lastCompletedPhase, "ownership_persisted");
  assert.deepEqual(result.lifecycle.failurePhases, ["target_acknowledgement"]);
  assert.equal(result.lifecycle.deadlineExceeded, true);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE-SENTINEL/);
});

test("AC-4BJ.9a unknown values and throwing metadata do not leak or mask failure", () => {
  const error = { get cause() { throw new Error("PRIVATE-SENTINEL"); } };
  const result = startupCrashFailureDiagnostic("PRIVATE-SENTINEL", error);
  assert.equal(result.lastCompletedPhase, null);
  assert.equal(result.lifecycle.diagnostic, "metadata_unavailable");
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE-SENTINEL/);
  assert.equal(startupCrashFailureDiagnostic(null).lastCompletedPhase, null);
});

test("AC-4BJ.9a real failed fixture sends closed diagnostics and retains exit 1", { timeout: 30_000 }, async () => {
  const fixture = await makeTempServicesRoot("service-lasso-crash-diagnostic-");
  const child = fork(new URL("./fixtures/startup-crash-runner.mjs", import.meta.url), [
    fixture.servicesRoot, fixture.workspaceRoot, "owned_readiness_proven", "", "preflight_reconciliation",
  ], {
    silent: true,
    windowsHide: true,
    env: {
      ...process.env,
      SERVICE_LASSO_ENABLE_TEST_HOOKS: "1",
      SERVICE_LASSO_INSTANCE_REGISTRY_PATH: path.join(fixture.tempRoot, "instances.json"),
      SERVICE_LASSO_HOST_PORT_REGISTRY_PATH: path.join(fixture.tempRoot, "ports.json"),
    },
  });
  const closed = once(child, "close");
  let diagnostic = null;
  let leaked = false;
  child.on("message", message => { diagnostic = message; });
  for (const stream of [child.stdout, child.stderr]) {
    stream.on("data", chunk => { leaked ||= chunk.toString().includes("PRIVATE-CRASH-SENTINEL"); });
  }
  const timer = setTimeout(() => child.kill(), 20_000);
  try {
    const [code] = await closed;
    assert.equal(code, 1);
    assert.equal(diagnostic?.kind, "startup-crash-failure");
    assert.equal(diagnostic.lastCompletedPhase, "preflight_reconciliation");
    assert.equal(leaked, false);
    assert.equal(JSON.stringify(diagnostic).includes(fixture.tempRoot), false);
    assert.doesNotMatch(JSON.stringify(diagnostic), /PRIVATE-CRASH-SENTINEL/);
  } finally {
    clearTimeout(timer);
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await closed;
    await rm(fixture.tempRoot, { recursive: true, force: true });
  }
});
