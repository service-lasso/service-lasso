import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { runFixtureHistoryScenario } from "./fixture-history-scenario.js";
import { createHistoryObservation, HISTORY_CLEANUP } from "./fixture-history-observation.js";
import { protectOriginalFixture, verifyOriginalFixturePrivacy, runFixturePrivacy,
  fixturePrivacyFailureObservation, fixturePrivacyTransportFailureObservation } from "./hard-crash-fixture-custody.js";

// AC-4BJ.9c.fixture-history-failure-v1: prospective diagnostic contract proof.
// These controlled dependencies cannot qualify any real native history or F7.
const response = result => ({ schema: "service-lasso.fixture-privacy-response.v1", outcome: result === "passed" ? "passed" : "failed", operation: result === "passed" ? null : result });
const frames = result => ({ schema: "service-lasso.fixture-privacy-transport.v2", state: "complete",
  events: result === "compiler" ? ["boot_enter", "parse_enter", "parse_ok", "compiler_enter", "compiler_failed"] :
    ["boot_enter", "parse_enter", "parse_ok", "compiler_enter", "compiler_ok", "native_enter_acquire"] });
function permission(result, error, transport = frames(result)) {
  return async (_root, _protect, observe) => { observe(result, transport); if (error !== undefined) throw error; };
}
function fixture(config = {}) {
  const calls = [], localWrites = [];
  let hook, observer, observerFailed, inspector;
  const child = new EventEmitter(); Object.assign(child, { pid: 71, exitCode: null, signalCode: null,
    kill(signal) { child.signalCode = signal; child.emit("close"); } });
  const original = Object.hasOwn(config, "primary") ? config.primary : new Error("PRIVATE-ACTION", { cause: new AggregateError([new Error("PRIVATE-NESTED")], "PRIVATE-CHAIN") });
  const dependencies = {
    makeTempServicesRoot: async () => ({ tempRoot: "PRIVATE-ROOT", servicesRoot: "PRIVATE-SERVICES", workspaceRoot: "PRIVATE-WORKSPACE" }),
    writeExecutableFixtureService: async () => ({ serviceRoot: "PRIVATE-SERVICE", scriptPath: "PRIVATE-SCRIPT" }),
    writeFile: async (name, bytes, options) => { if (options?.flag === "wx") { calls.push("write"); if (config.writeError) throw config.writeError; localWrites.push(bytes); } },
    readFile: async () => "72", rm: async () => { calls.push("removal"); }, spawn: () => child,
    protectOriginalFixture: config.protect ?? ((_root, observe) => protectOriginalFixture("PRIVATE-ROOT", observe,
      permission(config.originalResult ?? "passed", config.originalError, config.originalTransport ?? frames(config.originalResult ?? "passed")))),
    verifyOriginalFixturePrivacy: config.verify ?? ((_root, observe) => verifyOriginalFixturePrivacy("PRIVATE-ROOT", observe,
      permission(config.diagnosticResult ?? "passed", config.diagnosticError, config.diagnosticTransport ?? frames(config.diagnosticResult ?? "passed")))),
    setManagedProcessEnrollmentHookForTests: (value, read, failed) => {
      if (read) { hook = value; observer = read; observerFailed = failed; }
      else { calls.push("hook"); if (config.closeError) throw config.closeError; }
    },
    setManagedWindowsTreeInspectorForTests: value => { inspector = value; if (!value) calls.push("inspector"); },
    inspectWindowsProcessTree: async () => ({ rootStatus: "running", members: [] }),
    discoverServices: async () => [{ manifest: {} }], createDirectExecutionPlan: () => ({}),
    startManagedProcess: async () => {
      if (config.success) {
        try { observer("custody-refresh-managed-held-child-rejection", () => []); } catch { observerFailed(); }
        await hook(child); throw original;
      }
      if (config.reader) { try { observer("custody-refresh-managed", config.reader); } catch { observerFailed(); } return; }
      throw original;
    },
    hasManagedProcess: () => false, inspectProcess: async () => ({ status: "running", identity: { pid: 71, createdAt: "PRIVATE-BIRTH" } }),
    recordProcessOwnership: async () => {}, adoptManagedProcess: async () => { throw original; },
    retainManagedProcessCustodyForTest: () => config.reader,
    stopManagedProcess: async (_id, deadline) => { calls.push("stop"); assert.equal(deadline, 5_000); },
    waitForManagedProcessFinalization: async () => { calls.push("finalization"); },
    resetLifecycleState: async () => { calls.push("reset"); },
  };
  return { dependencies, calls, localWrites, original, inspector: () => inspector };
}
async function failure(config = {}, options = {}, mode = "managed") {
  const model = fixture(config); let error;
  const previous = process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS;
  try { await runFixtureHistoryScenario(mode, model.dependencies, options); }
  catch (value) { error = value; }
  assert.equal(process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS, previous);
  assert.ok(error instanceof AggregateError);
  const projection = JSON.parse(error.message.slice(error.message.indexOf("{")));
  assert.deepEqual(Object.keys(projection), ["schema", "complete", "primaryStage", "cleanup", "privacy", "privateCapture"]);
  assert.deepEqual(projection.cleanup.map(entry => entry.stage), HISTORY_CLEANUP);
  assert.equal(JSON.stringify(projection).includes("PRIVATE"), false);
  return { ...model, error, projection };
}
test("actual success owner emits no record and attempts neither diagnostics nor F7", async () => {
  const model = fixture({ success: true }); let emissions = 0, capture = 0;
  await runFixtureHistoryScenario("managed-held-child-rejection", model.dependencies, {
    observe() { emissions++; }, independentCapture() { capture++; },
  });
  assert.equal(emissions, 0); assert.equal(capture, 0); assert.equal(model.localWrites.length, 0);
  assert.deepEqual(model.calls, ["hook", "inspector", "stop", "finalization", "reset", "removal"]);
});
test("cleanup-only original aggregate has null primary and preserved cleanup identity", async () => {
  const closeError = new Error("PRIVATE-CLOSE");
  const row = await failure({ success: true, closeError }, {}, "managed-held-child-rejection");
  assert.deepEqual(row.error.errors, [closeError]); assert.equal(row.projection.primaryStage, null);
  assert.equal(row.projection.complete, true);
});
for (const [stage, operation] of [["hook", "setManagedProcessEnrollmentHookForTests"], ["inspector", "setManagedWindowsTreeInspectorForTests"],
  ["stop", "stopManagedProcess"], ["finalization", "waitForManagedProcessFinalization"], ["reset", "resetLifecycleState"], ["removal", "rm"]]) {
  test(`actual owning finally ${stage} rejection occupies one fixed slot`, async () => {
    const model = fixture({ success: true }), original = new Error("PRIVATE-CLEANUP");
    const previousOperation = model.dependencies[operation];
    model.dependencies[operation] = (...args) => {
      if ((stage === "hook" || stage === "inspector") && args[0] !== null) return previousOperation(...args);
      throw original;
    };
    let error; try { await runFixtureHistoryScenario("managed-held-child-rejection", model.dependencies); } catch (value) { error = value; }
    assert.deepEqual(error.errors, [original]);
    const projection = JSON.parse(error.message.slice(error.message.indexOf("{")));
    assert.equal(projection.primaryStage, null); assert.equal(projection.complete, true);
    assert.equal(projection.cleanup.find(entry => entry.stage === stage).state, "failed");
    assert.equal(projection.cleanup.filter(entry => entry.stage === stage).length, 1);
  });
}
for (const [mode, stage, failChild] of [["adopted", "direct_child", 1], ["adopted-root-rejection", "rejected_child", 2], ["managed-held-child-rejection", "held_child", 1]]) {
  test(`actual owning ${stage} closure rejection retains original child error`, async () => {
    const model = fixture({ success: mode.startsWith("managed") }), closeError = new Error("PRIVATE-CHILD-CLOSE");
    let children = 0;
    model.dependencies.spawn = () => {
      const child = new EventEmitter(), index = ++children;
      Object.assign(child, { pid: 70 + index, exitCode: null, signalCode: null,
        kill(signal) { if (index === failChild) throw closeError; child.signalCode = signal; child.emit("close"); } });
      queueMicrotask(() => child.emit("spawn")); return child;
    };
    if (stage === "held_child") {
      const start = model.dependencies.startManagedProcess;
      // The actual held-child path enters its enrolled hook and original close.
      model.dependencies.setManagedProcessEnrollmentHookForTests = ((previous) => (...args) => {
        if (args[0]) { const hook = args[0]; args[0] = async child => { child.kill = () => { throw closeError; }; return await hook(child); }; }
        return previous(...args);
      })(model.dependencies.setManagedProcessEnrollmentHookForTests);
      model.dependencies.startManagedProcess = start;
    }
    let error; try { await runFixtureHistoryScenario(mode, model.dependencies); } catch (value) { error = value; }
    assert.equal(error.errors.includes(closeError), true);
    const projection = JSON.parse(error.message.slice(error.message.indexOf("{")));
    assert.equal(projection.cleanup.find(entry => entry.stage === stage).state, "failed");
    assert.equal(projection.complete, true);
  });
}
for (const state of ["unavailable", "incomplete", "captured"]) {
  test(`actual failed native result retains complete transport; separate surrogate F7 ${state}`, async () => {
    const original = new Error("PRIVATE-NATIVE"); let retained;
    const row = await failure({ originalResult: "security", originalError: original }, state === "unavailable" ? {} : {
      independentCapture(value) { retained = value; return { state }; },
    });
    assert.equal(row.error.errors[0].errors[0], original);
    assert.equal(row.projection.complete, true); assert.equal(row.projection.primaryStage, "original_privacy");
    assert.equal(row.projection.privateCapture.independent.state, state);
    if (retained) assert.equal(retained.primary, row.error.errors[0]);
  });
}
test("real protection fallback forwards both original transports and callback throw is neutral", async () => {
  const first = new Error("PRIVATE-VERIFY"); const calls = []; let paired;
  await protectOriginalFixture("PRIVATE-ROOT", (value, transport) => { paired = { value, transport }; throw new Error("PRIVATE-CALLBACK"); },
    async (_root, protect, observe) => { calls.push(protect); observe(protect ? "passed" : "security", frames(protect ? "passed" : "security")); if (!protect) throw first; });
  assert.deepEqual(calls, [false, true]); assert.equal(paired.value.verification, "security");
  assert.equal(paired.value.protection, "passed"); assert.equal(paired.transport.verification.state, "complete");
  assert.equal(paired.transport.protection.state, "complete");
});
test("verify observer throw retains exact native rejected value", async () => {
  const original = new Error("PRIVATE-VERIFY");
  await assert.rejects(verifyOriginalFixturePrivacy("PRIVATE-ROOT", () => { throw new Error("PRIVATE-CALLBACK"); }, permission("owner", original)), value => value === original);
});
test("actual runner-created response rejection is paired at creation", async () => {
  const prior = process.env.SystemRoot; process.env.SystemRoot ??= "C:/Windows";
  let emitted, original;
  try {
    await runFixturePrivacy("PRIVATE-ROOT", false, (result, transport) => { emitted = { result, transport }; }, (_exe, _args, options, done) => {
      const child = new EventEmitter(); child.stdout = new EventEmitter();
      queueMicrotask(() => {
        child.emit("spawn"); const nonce = options.env.SERVICE_LASSO_FIXTURE_PRIVACY_NONCE;
        const bytes = frames("owner").events.map((event, index) => `SLFP2|${nonce}|v|${index + 1}|${event}\n`).join("") + JSON.stringify(response("owner"));
        child.stdout.emit("data", Buffer.from(bytes)); done(null, bytes);
      }); return child;
    });
  } catch (error) { original = error; }
  finally { if (prior === undefined) delete process.env.SystemRoot; else process.env.SystemRoot = prior; }
  assert.equal(emitted.result, "owner"); assert.equal(fixturePrivacyFailureObservation(original).verification, "owner");
  assert.equal(fixturePrivacyTransportFailureObservation(original), emitted.transport);
});
test("actual runner callback throw and hostile execFile error keep original identity", async () => {
  const original = new Proxy({}, { get() { throw new Error("PRIVATE-GETTER"); } });
  const prior = process.env.SystemRoot; process.env.SystemRoot ??= "C:/Windows";
  let caught;
  try {
    await runFixturePrivacy("PRIVATE-ROOT", false, () => { throw new Error("PRIVATE-OBSERVER"); }, (_exe, _args, options, done) => {
      const child = new EventEmitter(); child.stdout = new EventEmitter();
      queueMicrotask(() => {
        child.emit("spawn"); const nonce = options.env.SERVICE_LASSO_FIXTURE_PRIVACY_NONCE;
        const bytes = frames("owner").events.map((event, index) => `SLFP2|${nonce}|v|${index + 1}|${event}\n`).join("") + JSON.stringify(response("owner"));
        child.stdout.emit("data", Buffer.from(bytes)); done(original, bytes);
      }); return child;
    });
  } catch (value) { caught = value; }
  finally { if (prior === undefined) delete process.env.SystemRoot; else process.env.SystemRoot = prior; }
  assert.equal(caught, original); assert.equal(fixturePrivacyFailureObservation(caught).verification, "owner");
  assert.equal(fixturePrivacyTransportFailureObservation(caught).state, "complete");
});
for (const bad of [null, { schema: "service-lasso.fixture-privacy-transport.v2", state: "unavailable", events: [] },
  { ...frames("passed"), raw: "PRIVATE-RAW" }, new Proxy({}, { ownKeys() { throw new Error("PRIVATE-PROXY"); } })]) {
  test("owning attempted privacy rejects missing/invalid/hostile transport without raw leakage", async () => {
    const row = await failure({ protect: async (_root, observe) => observe({ schema: "service-lasso.fixture-privacy-observation.v1", verification: "passed", protection: "not_attempted" }, { verification: bad, protection: null }) });
    assert.equal(row.projection.complete, false); assert.equal(row.error.errors[0], row.original);
  });
}
for (const reader of [undefined, () => [], () => { throw new Error("PRIVATE-READER"); }]) {
  test("owning genuine reader missing/empty/throwing remain distinct actual failures", async () => {
    const model = fixture({ reader: reader ?? (() => []) });
    if (!reader) model.dependencies.startManagedProcess = async () => {};
    const row = await failure({ reader: reader ?? (() => []) });
    assert.ok(["initial_reader_nonempty", "initial_reader_read"].includes(row.projection.primaryStage));
    if (!reader) {
      let rejected; try { await runFixtureHistoryScenario("managed", model.dependencies); } catch (error) { rejected = error; }
      assert.equal(JSON.parse(rejected.message.slice(rejected.message.indexOf("{"))).primaryStage, "reader_presence");
    }
  });
}
for (const stage of ["privacy_verification", "serialization", "write"]) {
  test(`actual local ${stage} rejection can be observationally complete and preserves ordering`, async () => {
    const diagnostic = new Error("PRIVATE-DIAGNOSTIC"), close = new Error("PRIVATE-CLOSE"); let retained;
    const row = await failure({ closeError: close, ...(stage === "privacy_verification" ? { diagnosticResult: "descriptor", diagnosticError: diagnostic } : stage === "write" ? { writeError: diagnostic } : {}) }, {
      ...(stage === "serialization" ? { serializePrivate() { throw diagnostic; } } : {}),
      independentCapture(value) { retained = value; return { state: "incomplete" }; },
    });
    assert.deepEqual(row.error.errors, [row.original, close, diagnostic]);
    assert.equal(retained.primary, row.original); assert.equal(retained.primary.cause.errors[0].message, "PRIVATE-NESTED");
    assert.deepEqual(retained.cleanup.map(entry => entry.error), [close, diagnostic]);
    assert.equal(row.projection.complete, true); assert.deepEqual(row.projection.privateCapture.local, { state: "failed", stage });
    assert.deepEqual(row.calls.slice(0, 4), ["hook", "inspector", "stop", "finalization"]);
  });
}
for (const mutation of ["lost_marker", "collector_loss", "overflow", "unknown_cleanup", "lost_local_stage"]) {
  test(`owning failure truth row ${mutation} dominates complete and surrogate captured`, async () => {
    const row = await failure({}, {
      createObservation() {
        const observation = createHistoryObservation();
        if (mutation === "lost_marker") observation.mark = () => {};
        if (mutation === "collector_loss") observation.lose();
        if (mutation === "overflow") for (let index = 0; index < 257; index++) observation.mark("original_privacy");
        if (mutation === "unknown_cleanup") observation.cleanupEnd = () => {};
        if (mutation === "lost_local_stage") { const begin = observation.localBegin; observation.localBegin = () => begin("unknown"); }
        return observation;
      }, independentCapture: () => ({ state: "captured" }),
    });
    assert.equal(row.projection.complete, false); assert.equal(row.projection.privateCapture.independent.state, "captured");
  });
}
for (const callback of ["original", "diagnostic"]) {
  test(`owning callback delivery loss ${callback} is neutral and forces false`, async () => {
    const row = await failure({}, { createObservation() {
      const observation = createHistoryObservation();
      observation[callback] = () => { throw new Error("PRIVATE-COLLECTOR"); };
      return observation;
    } });
    assert.equal(row.error.errors[0], row.original); assert.equal(row.projection.complete, false);
  });
}
test("lost actual diagnostic callback forces false", async () => {
  const row = await failure({ verify: async () => {} }); assert.equal(row.projection.complete, false);
});
for (const mode of ["managed", "adopted", "managed-mixed-conflict", "adopted-mixed-conflict", "adopted-pre-enrollment-failure", "adopted-root-rejection", "managed-held-child-rejection"]) {
  test(`actual ${mode} owning entry keeps its private primary and fixed finally on first refusal`, async () => {
    const original = new Error("PRIVATE-FIRST");
    const row = await failure({ originalResult: "owner", originalError: original }, {}, mode);
    assert.equal(row.projection.primaryStage, "original_privacy"); assert.equal(row.projection.complete, true);
    assert.equal(row.error.errors[0].errors[0], original);
    assert.deepEqual(row.calls.slice(0, 4), ["hook", "inspector", "stop", "finalization"]);
    assert.equal(row.projection.cleanup.find(entry => entry.stage === "reset").state, "not_attempted");
    assert.equal(row.projection.cleanup.find(entry => entry.stage === "removal").state, "not_attempted");
  });
}
test("actual fallback success accounts failed verification plus passed protection separately", async () => {
  const first = new Error("PRIVATE-FIRST");
  const row = await failure({ protect: (_root, observe) => protectOriginalFixture("PRIVATE-ROOT", observe,
    async (_name, protect, deliver) => { deliver(protect ? "passed" : "owner", frames(protect ? "passed" : "owner")); if (!protect) throw first; }) });
  assert.equal(row.projection.complete, true);
  assert.equal(row.projection.privacy.originalProtection.verification, "owner");
  assert.equal(row.projection.privacy.originalProtection.protection, "passed");
  assert.equal(row.projection.privacy.originalVerificationTransport.state, "complete");
  assert.equal(row.projection.privacy.originalProtectionTransport.state, "complete");
});
for (const shape of ["expanded", "duplicate", "contradictory", "getter"]) {
  test(`actual privacy callback ${shape} observation forces false`, async () => {
    const row = await failure({ protect: async (_root, observe) => {
      const value = { schema: "service-lasso.fixture-privacy-observation.v1", verification: "passed", protection: "not_attempted" };
      const pair = { verification: frames("passed"), protection: null };
      if (shape === "expanded") value.raw = "PRIVATE-RAW";
      if (shape === "contradictory") { value.protection = "passed"; pair.protection = frames("passed"); }
      if (shape === "getter") Object.defineProperty(value, "verification", { get() { throw new Error("PRIVATE-GETTER"); } });
      observe(value, pair); if (shape === "duplicate") observe(value, pair);
    } });
    assert.equal(row.projection.complete, false);
  });
}
test("diagnostic unavailable response remains distinct from native failed complete", async () => {
  const unavailable = new Error("PRIVATE-UNAVAILABLE");
  const row = await failure({ diagnosticResult: "response_unavailable", diagnosticError: unavailable,
    diagnosticTransport: { schema: "service-lasso.fixture-privacy-transport.v2", state: "unavailable", events: ["boot_enter"] } });
  assert.equal(row.projection.complete, false); assert.equal(row.projection.privacy.diagnosticTransport.state, "unavailable");
  assert.equal(row.error.errors.at(-1), unavailable);
});
test("actual independent adapter failure preserves complete closed observations and originals", async () => {
  const row = await failure({}, { independentCapture() { throw new Error("PRIVATE-CAPTURE"); } });
  assert.equal(row.projection.complete, true); assert.equal(row.projection.privateCapture.independent.state, "incomplete");
  assert.equal(row.error.errors[0], row.original);
});
test("no thrown-property classification for non-object WeakMap keys", () => {
  for (const value of [null, undefined, 0, false, "PRIVATE-VALUE", Symbol("PRIVATE")]) {
    assert.equal(fixturePrivacyFailureObservation(value).verification, "response_unavailable");
    assert.equal(fixturePrivacyTransportFailureObservation(value), undefined);
  }
});
for (const value of [0, false, null, undefined]) {
  test("actual caught falsy value is retained without changing original cleanup/aggregate predicates", async () => {
    const model = fixture({ primary: value }); let retained, projection;
    await runFixtureHistoryScenario("managed", model.dependencies, {
      independentCapture(originals) { retained = originals; return { state: "incomplete" }; }, observe(record) { projection = record; },
    });
    assert.equal(retained.caught, true); assert.equal(retained.primary, value);
    assert.equal(projection.primaryStage, "managed_start"); assert.equal(projection.privateCapture.independent.state, "incomplete");
    assert.equal(model.localWrites.length, 0);
    assert.equal(projection.cleanup.find(entry => entry.stage === "reset").state, "passed");
    assert.equal(projection.cleanup.find(entry => entry.stage === "removal").state, "passed");
  });
}
test("public sink throw remains neutral, false and no text/raw fallback", async () => {
  const row = await failure({}, { observe() { throw new Error("PRIVATE-SINK"); } });
  assert.equal(row.projection.complete, false); assert.equal(row.error.errors[0], row.original);
});
for (const original of [new Proxy({}, { get() { throw new Error("PRIVATE-GETTER"); } }), Object.assign(new Error("PRIVATE-CYCLE"), { cause: null }), new Error("PRIVATE-OVERFLOW" + "x".repeat(70_000))]) {
  test("actual private serialization failure keeps hostile/cyclic/overflow original separately private", async () => {
    if (original instanceof Error && original.message === "PRIVATE-CYCLE") original.cause = original;
    let retained;
    const row = await failure({ primary: original }, { independentCapture(value) { retained = value; return { state: "incomplete" }; } });
    assert.equal(retained.primary, original); assert.equal(row.error.errors[0], original);
    assert.equal(row.projection.privateCapture.local.stage, "serialization"); assert.equal(row.projection.complete, true);
  });
}
