import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { readFile, writeFile, rm } from "node:fs/promises";
import { discoverServices } from "../dist/runtime/discovery/discoverServices.js";
import { installService, configService, startService } from "../dist/runtime/lifecycle/actions.js";
import { stopManagedProcess, waitForManagedProcessFinalization } from "../dist/runtime/execution/supervisor.js";
import { resetLifecycleState } from "../dist/runtime/lifecycle/store.js";
import { makeTempServicesRoot, writeExecutableFixtureService } from "./test-helpers.js";

test("AC-4AJ.4d concurrent same-service starts invoke the initializer once", async () => {
  const fixture = await makeTempServicesRoot("lasso-start-concurrency-");
  const id = "concurrent-service";
  try {
    await writeExecutableFixtureService(fixture.servicesRoot, id, { readyFileAfterMs: 300 });
    const script = path.join(fixture.servicesRoot, id, "runtime/fixture-service.mjs");
    await writeFile(script, `import { appendFileSync } from 'node:fs'; appendFileSync(new URL('./launches.txt', import.meta.url), 'launch\\n');\n` + await readFile(script, "utf8"));
    const [service] = await discoverServices(fixture.servicesRoot);
    await installService(service);
    await configService(service);
    const results = await Promise.allSettled([startService(service), startService(service)]);
    const successes = results.filter(result => result.status === "fulfilled");
    assert.ok(successes.length > 0, "at least one start must succeed");
    await new Promise(resolve => setTimeout(resolve, 500));
    const launches = await readFile(path.join(fixture.servicesRoot, id, "runtime/launches.txt"), "utf8");
    assert.equal(launches.split("launch").length - 1, 1, "only one initializer may execute");
    assert.equal(new Set(successes.map(result => result.value.state.runtime.pid)).size, 1);
    for (const result of results) if (result.status === "rejected") assert.match(result.reason.message, /already running/);
  } finally {
    await stopManagedProcess(id);
    await waitForManagedProcessFinalization(id, 60000);
    resetLifecycleState();
    await rm(fixture.tempRoot, { recursive: true, force: true });
  }
});
