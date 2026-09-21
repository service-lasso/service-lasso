import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { readFile, writeFile, rm } from "node:fs/promises";
import { discoverServices } from "../dist/runtime/discovery/discoverServices.js";
import { installService, configService, startService } from "../dist/runtime/lifecycle/actions.js";
import { stopManagedProcess, waitForManagedProcessFinalization } from "../dist/runtime/execution/supervisor.js";
import { resetLifecycleState } from "../dist/runtime/lifecycle/store.js";
import { makeTempServicesRoot, writeExecutableFixtureService } from "./test-helpers.js";
import { startApiServer } from "../dist/server/index.js";

test("AC-4AJ.4d a failed start releases the queue for recovery", async () => {
  const fixture = await makeTempServicesRoot("lasso-start-recovery-");
  const id = "recovery-service";
  try {
    await writeExecutableFixtureService(fixture.servicesRoot, id);
    const [service] = await discoverServices(fixture.servicesRoot);
    const failures = await Promise.allSettled([startService(service), startService(service)]);
    assert.ok(failures.every(result => result.status === "rejected"));
    await installService(service);
    await configService(service);
    assert.equal((await startService(service)).ok, true);
  } finally {
    await stopManagedProcess(id);
    await waitForManagedProcessFinalization(id, 60000);
    resetLifecycleState();
    await rm(fixture.tempRoot, { recursive: true, force: true });
  }
});

test("AC-4AJ.4d automatic startup and HTTP start converge without duplicate initialization", async () => {
  const fixture = await makeTempServicesRoot("lasso-auto-http-start-");
  const id = "auto-http-service";
  const previous = process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS;
  process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS = "1";
  let server, request, apiUrl;
  try {
    await writeExecutableFixtureService(fixture.servicesRoot, id, { autostart: true, readyFileAfterMs: 800,
      healthcheck: { type: "file", file: "./runtime/ready.txt", retries: 100, interval: 25 } });
    const script = path.join(fixture.servicesRoot, id, "runtime/fixture-service.mjs");
    await writeFile(script, `import { appendFileSync } from 'node:fs'; appendFileSync(new URL('./launches.txt', import.meta.url), 'launch\\n');\n` + await readFile(script, "utf8"));
    server = await startApiServer({ port: 0, servicesRoot: fixture.servicesRoot, workspaceRoot: fixture.workspaceRoot, autostart: true,
      endpointAllocationTestHooks: { beforeApiBind: async ({ endpoint }) => { apiUrl = endpoint.selectors.url.replace(/\/$/, ""); } },
      startupTransactionTestHooks: { afterPhase: async ({ phase }) => {
        if (phase === "process_spawned") {
          request = fetch(`${apiUrl}/api/services/${id}/start`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}", signal: AbortSignal.timeout(20000) });
          void request.catch(() => undefined);
        }
      } },
    });
    const response = await request;
    assert.ok([200, 409].includes(response.status), `expected successful adoption or deterministic conflict, got ${response.status}`);
    const launches = await readFile(path.join(fixture.servicesRoot, id, "runtime/launches.txt"), "utf8");
    assert.equal(launches.split("launch").length - 1, 1);
    const detail = await (await fetch(`${server.url}/api/services/${id}`)).json();
    assert.equal(detail.service.lifecycle.running, true);
  } finally {
    await request?.catch(() => undefined);
    await server?.stop();
    await stopManagedProcess(id);
    await waitForManagedProcessFinalization(id, 60000);
    if (previous === undefined) delete process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS;
    else process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS = previous;
    resetLifecycleState();
    await rm(fixture.tempRoot, { recursive: true, force: true });
  }
});

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
