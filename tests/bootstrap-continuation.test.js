import test from "node:test";
import assert from "node:assert/strict";
import { rm, readFile, writeFile, readdir } from "node:fs/promises";
import { continuePreparedBaselineServices } from "../dist/server/index.js";
import { discoverServices } from "../dist/runtime/discovery/discoverServices.js";
import { createServiceRegistry, DependencyGraph } from "../dist/runtime/manager/DependencyGraph.js";
import { getLifecycleState, setLifecycleState, resetLifecycleState } from "../dist/runtime/lifecycle/store.js";
import { stopAllManagedProcesses } from "../dist/runtime/execution/supervisor.js";
import { makeTempServicesRoot, writeExecutableFixtureService } from "./test-helpers.js";

test("continuation starts selected prepared daemons in dependency order without optional/provider/preparation mutations", async () => {
  const fixture = await makeTempServicesRoot("core-2007-continuation-");
  try {
    for (const [id, options] of [["dependency", {}], ["consumer", { depend_on: ["dependency"] }], ["optional", {}], ["unprepared", {}], ["provider", { role: "provider" }], ["disabled", { enabled: false }]]) {
      await writeExecutableFixtureService(fixture.servicesRoot, id, options);
      if (id !== "unprepared") setLifecycleState(id, { ...getLifecycleState(id), installed: true, configured: true });
    }
    const discovered = await discoverServices(fixture.servicesRoot);
    const registry = createServiceRegistry(discovered);
    const model = { servicesRoot: fixture.servicesRoot, discovered, registry, graph: new DependencyGraph(registry) };
    const selected = new Set(["consumer", "dependency", "unprepared", "provider", "disabled"]);
    const result = await continuePreparedBaselineServices(model, selected, { workspaceRoot: fixture.workspaceRoot });
    assert.equal(result.ok, false); // selected unprepared daemon remains incomplete
    assert.deepEqual(result.results.map(row => row.serviceId), ["dependency", "consumer"]);
    for (const id of ["optional", "unprepared", "provider", "disabled"]) assert.equal(getLifecycleState(id).running, false, id);
    assert.equal(getLifecycleState("unprepared").installed, false);
    const again = await continuePreparedBaselineServices(model, selected, { workspaceRoot: fixture.workspaceRoot });
    assert.equal(again.results.length, 0);
    assert.doesNotMatch(JSON.stringify(result), /statePaths|startTrace|fixture-service|executable|environment/);
    assert.equal(again.skipped.filter(row => row.reason === "already_running").length, 2);
    assert.deepEqual((await continuePreparedBaselineServices(model, new Set(), { workspaceRoot: fixture.workspaceRoot })).results, []);
  } finally {
    await stopAllManagedProcesses(); resetLifecycleState(); await rm(fixture.tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test("continuation preserves failed start evidence and refuses to start an unselected stopped dependency", async () => {
  const fixture = await makeTempServicesRoot("core-2007-failure-");
  try {
    await writeExecutableFixtureService(fixture.servicesRoot, "dependency");
    await writeExecutableFixtureService(fixture.servicesRoot, "consumer", { depend_on: ["dependency"] });
    const brokenRoot = await writeExecutableFixtureService(fixture.servicesRoot, "broken");
    const brokenManifestPath = `${brokenRoot.serviceRoot}/service.json`;
    const brokenManifest = JSON.parse(await readFile(brokenManifestPath, "utf8"));
    brokenManifest.executable = "/core-2007-missing-executable";
    await writeFile(brokenManifestPath, JSON.stringify(brokenManifest));
    for (const id of ["dependency", "consumer", "broken"]) setLifecycleState(id, { ...getLifecycleState(id), installed: true, configured: true });
    const discovered = await discoverServices(fixture.servicesRoot);
    const registry = createServiceRegistry(discovered);
    const model = { servicesRoot: fixture.servicesRoot, discovered, registry, graph: new DependencyGraph(registry) };
    const blocked = await continuePreparedBaselineServices(model, new Set(["consumer"]), { workspaceRoot: fixture.workspaceRoot });
    assert.equal(blocked.ok, false);
    assert.equal(blocked.skipped[0].reason, "dependency_not_ready");
    assert.equal(getLifecycleState("dependency").running, false);
    const failed = await continuePreparedBaselineServices(model, new Set(["broken"]), { workspaceRoot: fixture.workspaceRoot });
    assert.equal(failed.ok, false);
    assert.deepEqual(failed.results, [{ serviceId: "broken", ok: false }]);
    assert.equal(getLifecycleState("broken").running, false);
    assert.ok(getLifecycleState("broken").runtime.startTrace.current);
  } finally {
    await stopAllManagedProcesses(); resetLifecycleState(); await rm(fixture.tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test("managed bootstrap arriving before runtime commit fails safely before mutation", async () => {
  const fixture = await makeTempServicesRoot("core-2007-early-bootstrap-");
  const { createApiServer } = await import("../dist/server/index.js");
  const server = createApiServer({ servicesRoot: fixture.servicesRoot, workspaceRoot: fixture.workspaceRoot,
    host: "127.0.0.1", baselineBootstrap: { serviceIds: [] } });
  try {
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/setup/bootstrap`, { method: "POST", body: "{}" });
    assert.equal(response.status, 503);
    const body = await response.json();
    assert.equal(body.error, "runtime_startup_not_ready");
    assert.doesNotMatch(JSON.stringify(body), /store\.json|master-key|broker-token|signing-key/);
    assert.deepEqual(await readdir(fixture.servicesRoot), []);
  } finally {
    await new Promise(resolve => server.close(resolve));
    await rm(fixture.tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});
