import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm, rename, symlink, lstat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { createFixtureCustody, closeFixture, createFixtureCleanupAdapter, createFixtureEvidenceBoundary, verifyOriginalFixturePrivacy, protectOriginalFixture, decodeFixturePrivacyResponse, classifyFixturePrivacyCompletion, fixturePrivacyFailureObservation, FIXTURE_ASSERTION_STAGES, FIXTURE_PRIVACY_RESULTS } from "./hard-crash-fixture-custody.js";
import { fixturePrivacyScript } from "./fixture-privacy-custody.js";
import { holdFixtureRoot } from "./fixture-root-custody.js";
import { getProcessRegistryPath, readProcessOwnershipCustodyForTest, readProcessOwnershipRegistry } from "../dist/runtime/process/registry.js";
import { settleHardCrashDirectChild, stopHardCrashDirectChild } from "./hard-crash-child-exit.js";

const root = { pid: 1, createdAt: "root", executablePath: "PRIVATE-PATH", commandHash: "a".repeat(64) };
const child = { ...root, pid: 2, createdAt: "child" };
const execFileAsync = promisify(execFile);
const privateAclReadback = async (directory) => {
  const result = await execFileAsync(path.join(process.env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
    ["-NoProfile", "-NonInteractive", "-Command", "$ErrorActionPreference='Stop'; $a=Get-Acl -LiteralPath $env:SERVICE_LASSO_PRIVATE_PERMISSION_TARGET; [Console]::Out.Write($a.Sddl)"],
    { windowsHide: true, timeout: 5_000, maxBuffer: 16 * 1024,
      env: { ...process.env, SERVICE_LASSO_PRIVATE_PERMISSION_TARGET: directory } });
  return result.stdout;
};

test("fixture privacy response admits only the exact enum channel", () => {
  const response = (outcome, operation) => JSON.stringify({ schema: "service-lasso.fixture-privacy-response.v1", outcome, operation });
  assert.equal(decodeFixturePrivacyResponse(response("passed", null)), "passed");
  for (const operation of FIXTURE_PRIVACY_RESULTS.slice(2, 16)) {
    assert.equal(decodeFixturePrivacyResponse(response("failed", operation)), operation);
  }
  for (const value of [null, {}, [], "", "PRIVATE-NATIVE-ERROR", response("passed", "owner"),
    response("failed", null), response("failed", "spawn_unavailable"), response("failed", "PRIVATE-PATH"),
    response("failed", "owner").replace('"outcome":', '"pid":123,"outcome":'),
    response("failed", "owner").replace('"outcome":', '"operation":"security","outcome":'),
    `${response("failed", "owner")}\nPRIVATE`, `${response("passed", null)}\n`]) {
    assert.equal(decodeFixturePrivacyResponse(value), undefined);
  }
});

test("fixture privacy unavailable projection never inspects hostile errors or responses", () => {
  let traps = 0;
  const hostile = new Proxy({}, { get() { traps++; throw new Error("PRIVATE-GETTER"); },
    ownKeys() { traps++; throw new Error("PRIVATE-KEYS"); }, getPrototypeOf() { traps++; throw new Error("PRIVATE-PROTOTYPE"); } });
  assert.equal(decodeFixturePrivacyResponse(hostile), undefined);
  assert.deepEqual(fixturePrivacyFailureObservation(hostile), {
    schema: "service-lasso.fixture-privacy-observation.v1", verification: "response_unavailable", protection: "not_attempted",
  });
  assert.equal(traps, 0);
});
test("fixture privacy outer completion preserves native refusal and unavailable distinctions", () => {
  const passed = '{"schema":"service-lasso.fixture-privacy-response.v1","outcome":"passed","operation":null}';
  const refused = '{"schema":"service-lasso.fixture-privacy-response.v1","outcome":"failed","operation":"compiler"}';
  assert.equal(classifyFixturePrivacyCompletion(passed, false, false, false), "passed");
  assert.equal(classifyFixturePrivacyCompletion(passed, true, false, false), "response_unavailable");
  assert.equal(classifyFixturePrivacyCompletion(refused, true, false, false), "compiler");
  assert.equal(classifyFixturePrivacyCompletion(refused, false, false, false), "compiler");
  assert.equal(classifyFixturePrivacyCompletion("", true, true, false), "spawn_unavailable");
  assert.equal(classifyFixturePrivacyCompletion("", true, false, true), "timeout_unavailable");
  assert.equal(classifyFixturePrivacyCompletion("", true, false, false), "response_unavailable");
  assert.equal(classifyFixturePrivacyCompletion("PRIVATE-MALFORMED", false, false, false), "malformed_response");
  const hostile = new Proxy({}, { get() { assert.fail("Cannot inspect arbitrary thrown/flag identity."); } });
  assert.equal(classifyFixturePrivacyCompletion(hostile, hostile, hostile, hostile), "malformed_response");
});

// These actual native paths remain UNEXECUTED until NEW complete-input ROOT.
// Every invocation has the original helper/options; test-owned compiler-source
// corruption is an intentional real Add-Type refusal, not an enum mock.
test("Windows privacy helper: real private empty-root, compiler/acquire/type/readback refusals", { skip: process.platform !== "win32" }, async () => {
  const parent = await mkdtemp(path.join(tmpdir(), "hard-crash-native-observation-"));
  const directory = path.join(parent, "owned");
  const file = path.join(parent, "regular");
  await mkdir(directory);
  await writeFile(file, "PRIVATE-FILE");
  const invoke = async (rootPath, script = fixturePrivacyScript) => {
    let original;
    let stdout;
    let stderr;
    try {
      const result = await execFileAsync(path.join(process.env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
        ["-NoProfile", "-NonInteractive", "-Command", script], {
          windowsHide: true, timeout: 5_000, maxBuffer: 16 * 1024,
          env: { ...process.env, SERVICE_LASSO_FIXTURE_EVIDENCE_ROOT: rootPath, SERVICE_LASSO_FIXTURE_EVIDENCE_PROTECT: "0" },
        });
      ({ stdout, stderr } = result);
    } catch (error) {
      original = error;
      // These are this test's known execFile Error fields, not the public
      // projector's classifier or arbitrary caller-thrown values.
      ({ stdout, stderr } = error);
      assert.notEqual(error.code, 0);
    }
    assert.equal(stderr, "");
    assert.doesNotMatch(stdout, /PRIVATE|S-1-|AccessMask|ErrorRecord|System32|commandHash/);
    return { original, category: decodeFixturePrivacyResponse(stdout) };
  };
  try {
    let positive;
    await protectOriginalFixture(directory, value => { positive = value; });
    assert.equal(positive.protection === "passed" || positive.verification === "passed", true);
    assert.deepEqual(await invoke(directory), { original: undefined, category: "passed" });
    for (const [expected, target, script] of [
      ["compiler", directory, fixturePrivacyScript.replace("public static class FixturePrivacy {", "public static class PRIVATE_INVALID_COMPILER { !!!")],
      ["acquire", path.join(parent, "absent"), fixturePrivacyScript],
      ["type", file, fixturePrivacyScript],
      ["information", directory, fixturePrivacyScript.replace("$root=[System.IO.Path]::GetFullPath", "[FixturePrivacy]::Information([Microsoft.Win32.SafeHandles.SafeFileHandle]::new([IntPtr]::Zero,$false))\n$root=[System.IO.Path]::GetFullPath")],
      ["security", directory, fixturePrivacyScript.replace("$root=[System.IO.Path]::GetFullPath", "[FixturePrivacy]::Security([Microsoft.Win32.SafeHandles.SafeFileHandle]::new([IntPtr]::Zero,$false))\n$root=[System.IO.Path]::GetFullPath")],
      ["inventory", directory, fixturePrivacyScript.replace("  Acquire-Children $root\n  Verify-Names", "  Acquire-Children $root\n  [System.IO.File]::WriteAllText([System.IO.Path]::Combine($root,'PRIVATE-added'),'PRIVATE-added')\n  Verify-Names")],
    ]) {
      const failure = await invoke(target, script);
      assert.ok(failure.original);
      assert.equal(failure.category, expected);
    }
    assert.equal(await readFile(path.join(directory, "PRIVATE-added"), "utf8"), "PRIVATE-added");
    const unprotected = path.join(parent, "unprotected");
    await mkdir(unprotected);
    const refusal = await invoke(unprotected);
    assert.ok(refusal.original);
    assert.equal(refusal.category, "readback");
    // Hostile observers cannot turn verification success into protection or
    // replace any privacy failure with the observer's exception.
    const hostile = new Proxy({}, { get() { throw new Error("PRIVATE-GETTER"); } });
    await protectOriginalFixture(directory, () => { throw hostile; });
    let rejection;
    try { await protectOriginalFixture(path.join(parent, "absent"), () => { throw hostile; }); }
    catch (error) { rejection = error; }
    assert.ok(rejection instanceof AggregateError);
    assert.equal(rejection.errors.length, 2);
    assert.equal(rejection.errors.includes(hostile), false);
    assert.deepEqual(fixturePrivacyFailureObservation(rejection), {
      schema: "service-lasso.fixture-privacy-observation.v1", verification: "acquire", protection: "acquire",
    });
    assert.equal(await readFile(file, "utf8"), "PRIVATE-FILE");
  } finally { await rm(parent, { recursive: true, force: true }); }
});

for (const stage of [...FIXTURE_ASSERTION_STAGES, "injection_assertions", "PRIVATE-UNKNOWN-STAGE"]) {
  test(`protected assertion stage projects exact reached boundary: ${stage}`, async () => {
    const primary = new Error("PRIVATE-ORIGINAL-ASSERTION");
    const closeFailure = new Error("PRIVATE-CLOSE");
    let summary, retained;
    const evidence = {
      initialize: async () => {}, state: async () => ({ fixture: "unresolved", evidence: "unresolved" }),
      takeStateFailures: () => [], release: async () => { throw closeFailure; },
      retainErrors: async value => { retained = value; },
      get privacyObservation() { assert.fail("Projection must not inspect foreign observation getters."); },
    };
    await assert.rejects(closeFixture({ primary, primaryStage: stage, evidence,
      custody: createFixtureCustody(), adapter: { snapshot: async () => [], stop: async () => {}, finalize: async () => {} },
      restore: async () => {}, reset: () => assert.fail("A primary assertion must not reset."),
      report: value => { summary = value; },
    }), error => {
      assert.equal(error.errors[0], primary);
      assert.ok(error.errors.includes(closeFailure));
      const expected = FIXTURE_ASSERTION_STAGES.includes(stage) || stage === "injection_assertions" ? stage : "action";
      assert.equal(error.fixtureStages[expected], "failed");
      assert.equal(error.fixtureStages.held_release, "failed");
      return true;
    });
    assert.equal(retained[0].error.message, primary.message);
    assert.equal(retained.at(-1).error.message, closeFailure.message);
    assert.deepEqual(Object.keys(summary.privacyObservation).sort(), ["protection", "schema", "verification"]);
    assert.doesNotMatch(JSON.stringify(summary), /PRIVATE|pid|createdAt|executablePath|commandHash/);
    for (const expected of FIXTURE_ASSERTION_STAGES) assert.ok(Object.hasOwn(summary.stages, expected));
  });
}

// Exercise the same whole closeFixture path as the real matrix, including real
// private fixture/journal retention and deletion. No subprocess is signalled.
for (const scenario of ["primary-and-cleanup", "registry-read", "root-gone-child-live", "unknown", "success"]) {
  test(`hard-crash terminal custody: ${scenario}`, async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "hard-crash-custody-regression-"));
    const journal = path.join(directory, "journal.json");
    await writeFile(journal, "PRIVATE-JOURNAL");
    const registryFile = path.join(directory, "registry.json");
    const interruptedFile = path.join(directory, "interrupted-custody.json");
    await writeFile(interruptedFile, JSON.stringify([root, child]));
    await writeFile(registryFile, JSON.stringify({ entries: [{ ownerType: "service", pid: root.pid,
      identity: root, lifecycleState: "running", processGroup: { kind: "none", id: null } }] }));
    const custody = createFixtureCustody();
    custody.retain([root, child]);
    const primary = scenario === "primary-and-cleanup" ? new Error("PRIVATE-PRIMARY") : undefined;
    const stopFailure = new Error("PRIVATE-STOP");
    const finalizationFailure = new Error("PRIVATE-FINALIZATION");
    let restored = false;
    let resets = 0;
    let summary;
    const observed = [];
    const evidence = createFixtureEvidenceBoundary(directory);
    try {
      const work = closeFixture({ primary, custody,
        adapter: createFixtureCleanupAdapter({ workspaceRoot: directory, custodyReaders: [() => [child]] }, {
          readInterrupted: async () => JSON.parse(await readFile(interruptedFile, "utf8")),
          readRegistry: async () => {
            if (scenario === "registry-read") throw new Error("PRIVATE-REGISTRY");
            return { classification: "current", registry: JSON.parse(await readFile(registryFile, "utf8")) };
          },
          classify: async () => scenario === "unknown" ? "unknown_owner" : "not_running",
          capture: async () => { throw new Error("An absent root cannot authorize fresh tree discovery."); },
          stop: async () => { if (primary) throw stopFailure; },
          finalize: async () => { if (primary) throw finalizationFailure; },
          inspect: async (pid) => {
            observed.push(pid);
            if (pid === child.pid && scenario === "root-gone-child-live") return { status: "running" };
            if (pid === child.pid && scenario === "unknown") return { status: "unknown" };
            return { status: "not_running" };
          },
        }),
        evidence, restore: () => { restored = true; }, reset: () => { resets++; },
        report: (value) => { summary = value; },
      });
      if (scenario === "success") {
        await work;
        await assert.rejects(readFile(journal), { code: "ENOENT" });
        assert.equal(resets, 1);
        assert.equal(summary.fixture, "removed");
        assert.equal(summary.evidence, "retained");
        assert.equal(await readFile(path.join(evidence.evidenceRoot, "journal.json"), "utf8"), "PRIVATE-JOURNAL");
      } else {
        await assert.rejects(work, (error) => {
          assert.ok(error instanceof AggregateError);
          if (primary) assert.deepEqual(error.errors, [primary, stopFailure, finalizationFailure]);
          return true;
        });
        assert.equal(await readFile(journal, "utf8"), "PRIVATE-JOURNAL");
        assert.equal(resets, 0);
        assert.equal(summary.fixture, "retained");
      }
      assert.equal(restored, true);
      assert.deepEqual(observed, [1, 2]);
      assert.doesNotMatch(JSON.stringify(summary), /PRIVATE|pid|createdAt|executablePath|commandHash/);
      if (["registry-read", "root-gone-child-live", "unknown"].includes(scenario)) assert.equal(summary.absence, "unresolved");
    } finally {
      await evidence.release();
      await rm(directory, { recursive: true, force: true });
      if (evidence.evidenceRoot) await rm(evidence.evidenceRoot, { recursive: true, force: true });
      if (evidence.diagnosticRoot) await rm(evidence.diagnosticRoot, { recursive: true, force: true });
    }
  });
}

// F1/F2: intervene after the LAST inventory/identity check, precisely before
// the former delete/new-child-acquisition interval. The production boundary
// must reject without any deletion, retaining both evidence and new bytes.
for (const intervention of ["root-replacement", "descendant-replacement", "descendant-addition", "descendant-content"]) {
  test(`last-validation ${intervention} cannot authorize destruction`, async () => {
    const parent = await mkdtemp(path.join(tmpdir(), "hard-crash-last-check-"));
    const directory = path.join(parent, "original");
    const moved = path.join(parent, "retained-original");
    await mkdir(directory);
    const journal = path.join(directory, "journal.json");
    await writeFile(journal, "PRIVATE-APPROVED");
    const evidence = createFixtureEvidenceBoundary(directory);
    let entered = false, rootMoved = false, renameDenied;
    try {
      await evidence.initialize();
      await evidence.preserve();
      await assert.rejects(evidence.remove(undefined, async () => {
        entered = true;
        if (intervention === "root-replacement") {
          try { await rename(directory, moved); }
          catch (error) { if (process.platform !== "win32") throw error; renameDenied = error; return; }
          rootMoved = true;
          await mkdir(directory);
          await writeFile(path.join(directory, "replacement.json"), "PRIVATE-REPLACEMENT");
        } else if (intervention === "descendant-replacement") {
          await rename(journal, path.join(parent, "retained-journal.json"));
          await writeFile(journal, "PRIVATE-REPLACEMENT");
        } else if (intervention === "descendant-addition") {
          await writeFile(path.join(directory, "added.json"), "PRIVATE-ADDITION");
        } else await writeFile(journal, "PRIVATE-CHANGED");
      }), /writer exclusion/);
      assert.equal(entered, true);
      if (intervention === "root-replacement" && process.platform === "win32") assert.ok(renameDenied, "Held original rename must reject.");
      assert.equal(await readFile(path.join(evidence.evidenceRoot, "journal.json"), "utf8"), "PRIVATE-APPROVED");
      if (rootMoved) {
        assert.equal(await readFile(path.join(moved, "journal.json"), "utf8"), "PRIVATE-APPROVED");
        assert.equal(await readFile(path.join(directory, "replacement.json"), "utf8"), "PRIVATE-REPLACEMENT");
      } else if (intervention === "descendant-replacement") {
        assert.equal(await readFile(path.join(parent, "retained-journal.json"), "utf8"), "PRIVATE-APPROVED");
        assert.equal(await readFile(journal, "utf8"), "PRIVATE-REPLACEMENT");
      } else if (intervention === "descendant-content") assert.equal(await readFile(journal, "utf8"), "PRIVATE-CHANGED");
      else {
        assert.equal(await readFile(journal, "utf8"), "PRIVATE-APPROVED");
        if (intervention === "descendant-addition") assert.equal(await readFile(path.join(directory, "added.json"), "utf8"), "PRIVATE-ADDITION");
      }
      assert.equal((await evidence.state(true)).evidence, "retained");
    } finally {
      await evidence.release();
      await rm(parent, { recursive: true, force: true });
    }
  });
}

// F3 uses actual current registry bytes/reader, including a valid header and
// valid-plus-invalid rows. Production normalization remains separately read.
for (const malformed of ["pid", "fingerprint", "mixed", "active-null", "stale-backup"]) {
  test(`actual current registry rejects ${malformed} ownership evidence`, async () => {
    const previous = process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS;
    process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS = "1";
    const directory = await mkdtemp(path.join(tmpdir(), "hard-crash-current-malformed-"));
    const evidence = createFixtureEvidenceBoundary(directory);
    let summary, reset = false, removal = false;
    try {
      const registry = await readProcessOwnershipRegistry(directory);
      const identity = { ...root, pid: 1234, createdAt: new Date(0).toISOString() };
      const valid = { ownerType: "service", ownerId: "valid", serviceId: "valid", generationId: null,
        workspaceId: registry.workspaceId, runtimeInstanceId: null, pid: identity.pid, identity,
        ownerRoot: directory, processGroup: { kind: "none", id: null },
        allocation: { revision: null, ports: {}, endpoints: [] }, lifecycleState: "running", identityStatus: "owned",
        source: "spawn", recordedAt: identity.createdAt, updatedAt: identity.createdAt };
      const invalid = { ...valid, ownerId: "invalid", serviceId: "invalid" };
      if (malformed === "pid") invalid.pid = "invalid-running-pid";
      else if (malformed === "active-null") { invalid.pid = null; invalid.identity = null; }
      else invalid.identity = { ...identity, commandHash: "malformed" };
      registry.entries = malformed === "mixed" ? [valid, invalid] : [invalid];
      await mkdir(path.dirname(getProcessRegistryPath(directory)), { recursive: true });
      await writeFile(getProcessRegistryPath(directory), JSON.stringify(registry), { mode: 0o600 });
      if (malformed === "stale-backup") await writeFile(`${getProcessRegistryPath(directory)}.bak`, JSON.stringify({ ...registry, entries: [] }), { mode: 0o600 });
      await writeFile(path.join(directory, "journal.json"), "PRIVATE-REGISTRY-JOURNAL");
      await evidence.initialize();
      await evidence.preserve();
      const actual = await readProcessOwnershipCustodyForTest(directory);
      assert.equal(actual.classification, "corrupt");
      assert.equal(actual.registry, null);
      await assert.rejects(closeFixture({ custody: createFixtureCustody(), evidence,
        adapter: createFixtureCleanupAdapter({ workspaceRoot: directory, custodyReaders: [] }, {
          readRegistry: readProcessOwnershipCustodyForTest, readInterrupted: async () => [],
          stop: async () => {}, finalize: async () => {}, inspect: async () => ({ status: "not_running" }),
        }), restore: () => {}, reset: () => { reset = true; }, remove: () => { removal = true; },
        report: value => { summary = value; },
      }), AggregateError);
      assert.equal(reset, false);
      assert.equal(removal, false);
      assert.equal(summary.absence, "unresolved");
      assert.equal(summary.fixture, "retained");
      assert.equal(summary.evidence, "retained");
      assert.equal(await readFile(path.join(directory, "journal.json"), "utf8"), "PRIVATE-REGISTRY-JOURNAL");
      assert.equal(await readFile(path.join(evidence.evidenceRoot, "journal.json"), "utf8"), "PRIVATE-REGISTRY-JOURNAL");
    } finally {
      if (previous === undefined) delete process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS;
      else process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS = previous;
      await evidence.release();
      await rm(directory, { recursive: true, force: true });
      if (evidence.evidenceRoot) await rm(evidence.evidenceRoot, { recursive: true, force: true });
      if (evidence.diagnosticRoot) await rm(evidence.diagnosticRoot, { recursive: true, force: true });
    }
  });
}

test("public initializer and protector reject redirection without outside permission mutation", async () => {
  const parent = await mkdtemp(path.join(tmpdir(), "hard-crash-public-privacy-"));
  const outside = path.join(parent, "outside");
  const redirected = path.join(parent, "redirected");
  await mkdir(outside);
  await writeFile(path.join(outside, "must-survive.json"), "PRIVATE-OUTSIDE");
  await symlink(outside, redirected, process.platform === "win32" ? "junction" : "dir");
  const before = await lstat(outside);
  const beforeAcl = process.platform === "win32" ? await privateAclReadback(outside) : undefined;
  const evidence = createFixtureEvidenceBoundary(redirected);
  let initialFailure;
  try {
    await assert.rejects(protectOriginalFixture(redirected));
    await assert.rejects(evidence.initialize(), error => { initialFailure = error; return true; });
    assert.equal(evidence.initializationStage, "initialization_original_privacy");
    let projection;
    await assert.rejects(closeFixture({ primary: initialFailure, primaryStage: "fixture_initialization", evidence,
      custody: createFixtureCustody(), adapter: { snapshot: async () => [], stop: async () => {}, finalize: async () => {}, inspect: async () => "not_running" },
      restore: () => {}, reset: () => assert.fail("Rejected original must not reset."), report: value => { projection = value; },
    }), error => error.fixtureStages.initialization_original_privacy === "failed");
    assert.doesNotMatch(JSON.stringify(projection), /PRIVATE|pid|createdAt|executablePath|commandHash/);
    const after = await lstat(outside);
    assert.equal(after.mode, before.mode);
    assert.equal(after.uid, before.uid);
    if (process.platform === "win32") assert.ok(await privateAclReadback(outside) === beforeAcl, "Outside ACL must remain unchanged.");
    assert.equal(await readFile(path.join(outside, "must-survive.json"), "utf8"), "PRIVATE-OUTSIDE");
  } finally { await evidence.release(); await rm(parent, { recursive: true, force: true }); }
});

test("actual diagnostic privacy rejection keeps closed substage without claiming accessible private cause", async () => {
  const parent = await mkdtemp(path.join(tmpdir(), "hard-crash-private-prerequisite-"));
  const directory = path.join(parent, "original");
  const outside = path.join(parent, "outside");
  await mkdir(directory);
  await mkdir(outside);
  await writeFile(path.join(directory, "journal.json"), "PRIVATE-ORIGINAL");
  await writeFile(path.join(outside, "must-survive.json"), "PRIVATE-OUTSIDE");
  const before = await lstat(outside);
  const beforeAcl = process.platform === "win32" ? await privateAclReadback(outside) : undefined;
  const evidence = createFixtureEvidenceBoundary(directory, { beforeInitializationStep: async (stage, state) => {
    if (stage !== "initialization_diagnostic_privacy") return;
    await rename(state.diagnosticRoot, `${state.diagnosticRoot}-retained`);
    await symlink(outside, state.diagnosticRoot, process.platform === "win32" ? "junction" : "dir");
  } });
  let summary;
  try {
    await assert.rejects(closeFixture({ evidence, custody: createFixtureCustody(),
      adapter: { snapshot: async () => [], stop: async () => {}, finalize: async () => {}, inspect: async () => "not_running" },
      restore: () => {}, reset: () => assert.fail("Rejected private prerequisite must not reset."), report: value => { summary = value; },
    }), error => error.fixtureStages.initialization_diagnostic_privacy === "failed" && error.fixtureStages.private_diagnostic === "failed");
    assert.equal(summary.stages.initialization_diagnostic_privacy, "failed");
    if (process.platform === "win32") assert.deepEqual(summary.privacyObservation, {
      schema: "service-lasso.fixture-privacy-observation.v1", verification: "redirect", protection: "redirect",
    });
    assert.equal(summary.reset, "not_attempted");
    assert.equal(await readFile(path.join(directory, "journal.json"), "utf8"), "PRIVATE-ORIGINAL");
    assert.equal(await readFile(path.join(outside, "must-survive.json"), "utf8"), "PRIVATE-OUTSIDE");
    assert.equal((await lstat(outside)).mode, before.mode);
    if (process.platform === "win32") assert.ok(await privateAclReadback(outside) === beforeAcl, "Rejected diagnostic path cannot mutate outside ACL.");
    assert.doesNotMatch(JSON.stringify(summary), /PRIVATE|pid|createdAt|executablePath|commandHash/);
  } finally { await evidence.release(); await rm(parent, { recursive: true, force: true }); }
});

// Direct foreign-owner regression requires the explicitly ROOT-provisioned
// owned laboratory's foreign fixture as a NEW private input. Absence is a
// failed prerequisite, never a skipped/pass surrogate. This test does not
// change that fixture's owner, permissions, names, content, or cleanup it.
test("public protector and initializer reject a ROOT-provisioned foreign owner", async () => {
  const foreign = process.env.SERVICE_LASSO_UNOWNED_FIXTURE_ROOT;
  assert.ok(typeof foreign === "string" && path.isAbsolute(foreign), "ROOT foreign-owner fixture input is required.");
  const before = await lstat(foreign);
  assert.ok(before.isDirectory() && !before.isSymbolicLink(), "ROOT foreign-owner directory must be physical.");
  const beforeAcl = process.platform === "win32" ? await privateAclReadback(foreign) : undefined;
  if (process.platform === "win32") {
    const result = await execFileAsync(path.join(process.env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
      ["-NoProfile", "-NonInteractive", "-Command", "$ErrorActionPreference='Stop'; $o=(Get-Acl -LiteralPath $env:SERVICE_LASSO_PRIVATE_PERMISSION_TARGET).GetOwner([System.Security.Principal.SecurityIdentifier]).Value; [Console]::Out.Write(($o -ne [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value))"],
      { windowsHide: true, timeout: 5_000, maxBuffer: 16 * 1024, env: { ...process.env, SERVICE_LASSO_PRIVATE_PERMISSION_TARGET: foreign } });
    assert.ok(result.stdout === "True", "ROOT fixture must have a different prior native owner.");
  } else assert.ok(before.uid !== process.getuid(), "ROOT fixture must have a different prior uid.");
  const evidence = createFixtureEvidenceBoundary(foreign);
  try {
    await assert.rejects(protectOriginalFixture(foreign), error => {
      if (process.platform === "win32") {
        const observation = fixturePrivacyFailureObservation(error);
        assert.ok(["owner", "acquire"].includes(observation.verification));
        assert.ok(["owner", "acquire"].includes(observation.protection));
      }
      return true;
    });
    await assert.rejects(evidence.initialize());
    const after = await lstat(foreign);
    assert.equal(after.uid, before.uid);
    assert.equal(after.mode, before.mode);
    if (process.platform === "win32") assert.ok(await privateAclReadback(foreign) === beforeAcl, "Foreign owner and ACL must remain unchanged.");
  } finally { await evidence.release(); }
});

test("formal direct-child caller preserves the exact failed close classification", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "hard-crash-formal-child-close-"));
  const evidence = createFixtureEvidenceBoundary(directory);
  const expected = new Error("PRIVATE-FORMAL-CLOSE");
  const failures = [];
  const direct = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { windowsHide: true, stdio: "ignore" });
  direct.fixtureClose = new Promise(resolve => direct.once("close", resolve));
  const nativeKill = direct.kill.bind(direct);
  let summary, primary;
  const cleanupErrors = [];
  const cleanup = async (stage, action) => {
    try { await action(); } catch (error) { cleanupErrors.push({ stage, error }); }
  };
  try {
    await new Promise((resolve, reject) => { direct.once("spawn", resolve); direct.once("error", reject); });
    // The actual shared formal close implementation receives the actual owned
    // ChildProcess, with only its first signal delivery deliberately rejecting.
    direct.kill = () => { throw expected; };
    await settleHardCrashDirectChild(direct, failures);
    assert.equal(failures.length, 1);
    assert.equal(failures[0].error, expected);
    assert.equal(failures[0].stage, "direct_child");
    await assert.rejects(closeFixture({ custody: createFixtureCustody(), failures, evidence,
      adapter: { snapshot: async () => [], stop: async () => {}, finalize: async () => {}, inspect: async () => "not_running" },
      restore: () => {}, reset: () => assert.fail("Failed close cannot reset."), report: value => { summary = value; },
    }), error => error.errors.includes(expected) && error.fixtureStages.direct_child === "failed" && error.fixtureStages.action === "clear");
    assert.equal(summary.stages.direct_child, "failed");
    assert.equal(summary.stages.action, "clear");
    assert.doesNotMatch(JSON.stringify(summary), /PRIVATE|pid|createdAt|executablePath|commandHash/);
  } catch (error) { primary = error;
  } finally {
    direct.kill = nativeKill;
    await cleanup("direct_child", () => stopHardCrashDirectChild(direct));
    await cleanup("held_release", () => evidence.release());
    if (!primary && cleanupErrors.length === 0) {
      await cleanup("fixture_cleanup", () => rm(directory, { recursive: true, force: true }));
      if (evidence.diagnosticRoot) await cleanup("private_cleanup", () => rm(evidence.diagnosticRoot, { recursive: true, force: true }));
    }
  }
  if (primary || cleanupErrors.length) throw new AggregateError([...(primary ? [primary] : []), ...cleanupErrors.map(entry => entry.error)],
    `Formal caller regression failed: ${JSON.stringify({ action: primary ? "failed" : "clear", cleanup: cleanupErrors.map(entry => entry.stage) })}`);
});

test("actual root guardian rejection settles its child and preserves redirected targets", async () => {
  const parent = await mkdtemp(path.join(tmpdir(), "hard-crash-guardian-reparse-"));
  const target = path.join(parent, "target");
  const link = path.join(parent, "redirected");
  const diagnostics = path.join(parent, "diagnostics");
  await mkdir(target);
  await mkdir(diagnostics);
  await writeFile(path.join(target, "must-survive.json"), "PRIVATE-GUARDIAN-TARGET");
  await protectOriginalFixture(diagnostics);
  await symlink(target, link, process.platform === "win32" ? "junction" : "dir");
  try {
    await assert.rejects(holdFixtureRoot(link, diagnostics));
    assert.equal(await readFile(path.join(target, "must-survive.json"), "utf8"), "PRIVATE-GUARDIAN-TARGET");
    if (process.platform === "win32") {
      const receipt = JSON.parse(await readFile(path.join(diagnostics, "guardian-custody.json"), "utf8"));
      assert.equal(receipt.callerPid, process.pid);
      assert.ok(Number.isSafeInteger(receipt.childPid) && receipt.childPid > 0);
      assert.equal(receipt.closure.code !== 0, true);
      assert.equal(receipt.closure.signal, null);
      assert.equal(receipt.stdoutEof, true);
      assert.equal(receipt.stderrEof, true);
      assert.equal((await readFile(path.join(diagnostics, "guardian-stderr.bin"))).length > 0, true);
    }
  } finally { await rm(parent, { recursive: true, force: true }); }
});

for (const stage of ["snapshot", "inspection", "preservation", "removal", "diagnostic", "enrollment_observation", "custody", "fixture_initialization", "private_diagnostic"]) {
  test(`closed terminal diagnostics identify ${stage} and retain errors privately`, async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "hard-crash-stage-diagnostics-"));
    const boundary = createFixtureEvidenceBoundary(directory);
    const expected = new Error(`PRIVATE-STAGE-${stage}`);
    let aggregate;
    try {
      await boundary.initialize();
      await writeFile(path.join(directory, "journal.json"), "PRIVATE-JOURNAL");
      const evidence = {
        initialize: () => stage === "fixture_initialization" ? Promise.reject(expected) : boundary.initialize(),
        preserve: () => stage === "preservation" ? Promise.reject(expected) : boundary.preserve(),
        remove: hook => boundary.remove(hook), state: attempted => boundary.state(attempted), release: () => boundary.release(),
        takeStateFailures: () => boundary.takeStateFailures(),
        retainErrors: errors => stage === "private_diagnostic" ? Promise.reject(expected) : boundary.retainErrors(errors),
        originalRoot: directory,
      };
      const custody = stage === "custody" ? { settle: async () => { throw expected; } } : createFixtureCustody();
      await assert.rejects(closeFixture({ evidence, custody,
        primary: stage === "private_diagnostic" ? new Error("PRIVATE-PRIMARY") : undefined,
        failures: stage === "enrollment_observation" ? [{ stage, error: expected }] : [],
        adapter: { snapshot: async () => { if (stage === "snapshot") throw expected; return [root]; },
          stop: async () => {}, finalize: async () => {}, inspect: async () => { if (stage === "inspection") throw expected; return "not_running"; } },
        remove: () => { if (stage === "removal") throw expected; }, reset: () => {}, restore: () => {},
        report: () => { if (stage === "diagnostic") throw expected; },
      }), error => {
        aggregate = error;
        assert.ok(error instanceof AggregateError);
        assert.ok(error.errors.includes(expected));
        assert.equal(error.fixtureStages[stage], "failed");
        assert.doesNotMatch(error.message, /PRIVATE|pid|createdAt|executablePath|commandHash/);
        return true;
      });
      assert.equal(aggregate.fixtureStages[stage], "failed");
      if (stage !== "private_diagnostic") {
        const errors = await readFile(path.join(boundary.diagnosticRoot, "fixture-private-errors.json"), "utf8");
        assert.match(errors, new RegExp(`PRIVATE-STAGE-${stage}`));
      }
    } finally {
      await boundary.release();
      await rm(directory, { recursive: true, force: true });
      if (boundary.evidenceRoot) await rm(boundary.evidenceRoot, { recursive: true, force: true });
      if (boundary.diagnosticRoot) await rm(boundary.diagnosticRoot, { recursive: true, force: true });
    }
  });
}

for (const substitution of ["root-replacement", "ancestor-redirection"]) {
  test(`held original custody rejects actual ${substitution} before removal`, async () => {
    const parent = await mkdtemp(path.join(tmpdir(), "hard-crash-root-substitution-"));
    const directory = path.join(parent, "original");
    const moved = `${substitution === "root-replacement" ? directory : parent}-moved`;
    const substitute = `${parent}-substitute`;
    await mkdir(directory);
    await mkdir(substitute);
    await writeFile(path.join(directory, "journal.json"), "PRIVATE-ORIGINAL");
    await writeFile(path.join(substitute, "must-survive.json"), "PRIVATE-SUBSTITUTE");
    const evidence = createFixtureEvidenceBoundary(directory);
    let replaced = false;
    let denied;
    try {
      await evidence.initialize();
      await evidence.preserve();
      const inject = async () => {
        try { await rename(substitution === "root-replacement" ? directory : parent, moved); }
        catch (error) { denied = error; throw error; }
        replaced = true;
        if (substitution === "root-replacement") {
          await mkdir(directory);
          await writeFile(path.join(directory, "must-survive.json"), "PRIVATE-NAMED-REPLACEMENT");
        } else await symlink(substitute, parent, process.platform === "win32" ? "junction" : "dir");
      };
      await assert.rejects(evidence.remove(inject));
      if (process.platform === "win32") {
        assert.equal(replaced, false);
        assert.ok(denied); // Native held handles deny the actual rename.
        assert.equal(await readFile(path.join(directory, "journal.json"), "utf8"), "PRIVATE-ORIGINAL");
      } else {
        assert.equal(replaced, true);
        assert.equal(await readFile(path.join(substitution === "root-replacement" ? moved : path.join(moved, "original"), "journal.json"), "utf8"), "PRIVATE-ORIGINAL");
        if (substitution === "root-replacement") assert.equal(await readFile(path.join(directory, "must-survive.json"), "utf8"), "PRIVATE-NAMED-REPLACEMENT");
      }
      assert.equal(await readFile(path.join(substitute, "must-survive.json"), "utf8"), "PRIVATE-SUBSTITUTE");
      const copy = substitution === "ancestor-redirection" && replaced
        ? path.join(moved, path.basename(evidence.evidenceRoot)) : evidence.evidenceRoot;
      assert.equal(await readFile(path.join(copy, "journal.json"), "utf8"), "PRIVATE-ORIGINAL");
    } finally {
      await evidence.release();
      // All targets are this test's explicit private fixtures; restore the
      // renamed ancestor before deleting its evidence children.
      if (substitution === "ancestor-redirection" && replaced) { await rm(parent); await rename(moved, parent); }
      await rm(parent, { recursive: true, force: true });
      await rm(substitute, { recursive: true, force: true });
      if (substitution === "root-replacement") await rm(moved, { recursive: true, force: true });
    }
  });
}

test("Windows original private fingerprints retain verified ACL custody on action failure", { skip: process.platform !== "win32" }, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "hard-crash-original-privacy-"));
  const evidence = createFixtureEvidenceBoundary(directory);
  const primary = new Error("PRIVATE-ORIGINAL-FAILURE");
  let summary;
  try {
    await evidence.initialize();
    await verifyOriginalFixturePrivacy(directory);
    await writeFile(path.join(directory, "fingerprints.json"), JSON.stringify([root, child]), { mode: 0o600, flag: "wx" });
    await verifyOriginalFixturePrivacy(directory);
    await assert.rejects(closeFixture({ primary, custody: createFixtureCustody(), evidence,
      adapter: { snapshot: async () => [root, child], stop: async () => {}, finalize: async () => {}, inspect: async () => "not_running" },
      restore: () => {}, reset: () => assert.fail("Failed original must not reset."), report: value => { summary = value; },
    }), error => error.errors.includes(primary));
    assert.equal(summary.fixture, "retained");
    assert.equal(summary.stages.privacy, "clear");
    await verifyOriginalFixturePrivacy(directory);
    assert.deepEqual(JSON.parse(await readFile(path.join(directory, "fingerprints.json"), "utf8")), [root, child]);
    assert.doesNotMatch(JSON.stringify(summary), /PRIVATE|pid|createdAt|executablePath|commandHash/);
    const privateErrors = await readFile(path.join(evidence.diagnosticRoot, "fixture-private-errors.json"), "utf8");
    assert.match(privateErrors, /PRIVATE-ORIGINAL-FAILURE/);
  } finally {
    await evidence.release();
    await rm(directory, { recursive: true, force: true });
    if (evidence.diagnosticRoot) await rm(evidence.diagnosticRoot, { recursive: true, force: true });
  }
});

for (const classification of ["missing", "corrupt"]) {
  test(`actual ownership persistence ${classification} cannot authorize fixture removal`, async () => {
    const previous = process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS;
    process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS = "1";
    const directory = await mkdtemp(path.join(tmpdir(), "hard-crash-real-registry-"));
    const evidence = createFixtureEvidenceBoundary(directory);
    let removed = false;
    let summary;
    try {
      await writeFile(path.join(directory, "journal.json"), "PRIVATE-JOURNAL");
      if (classification === "corrupt") {
        await mkdir(path.dirname(getProcessRegistryPath(directory)), { recursive: true });
        await writeFile(getProcessRegistryPath(directory), "{not-json", { mode: 0o600 });
      }
      const actual = await readProcessOwnershipCustodyForTest(directory);
      assert.equal(actual.classification, classification);
      assert.equal(actual.registry, null);
      await assert.rejects(closeFixture({ custody: createFixtureCustody(), evidence,
        adapter: createFixtureCleanupAdapter({ workspaceRoot: directory, custodyReaders: [] }, {
          readRegistry: readProcessOwnershipCustodyForTest, readInterrupted: async () => [],
          stop: async () => {}, finalize: async () => {}, inspect: async () => ({ status: "not_running" }),
        }), restore: () => {}, reset: () => { throw new Error("Must not reset."); },
        remove: async () => { removed = true; await rm(directory, { recursive: true }); },
        report: (value) => { summary = value; },
      }), AggregateError);
      assert.equal(removed, false);
      assert.equal(summary.absence, "unresolved");
      assert.equal(summary.fixture, "retained");
      assert.equal(await readFile(path.join(directory, "journal.json"), "utf8"), "PRIVATE-JOURNAL");
    } finally {
      if (previous === undefined) delete process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS;
      else process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS = previous;
      await evidence.release();
      await rm(directory, { recursive: true, force: true });
      if (evidence.diagnosticRoot) await rm(evidence.diagnosticRoot, { recursive: true, force: true });
    }
  });
}

for (const failure of ["partial-removal", "reset", "environment", "copy-tamper"]) {
  test(`verified filesystem evidence survives ${failure} with truthful state`, async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "hard-crash-partial-removal-"));
    const evidence = createFixtureEvidenceBoundary(directory);
    const journal = path.join(directory, "journal.json");
    let summary;
    let restored = false;
    const expected = new Error(`PRIVATE-${failure}`);
    try {
      await writeFile(journal, "PRIVATE-JOURNAL");
      await writeFile(path.join(directory, "remainder.json"), "PRIVATE-REMAINDER");
      await assert.rejects(closeFixture({ custody: createFixtureCustody(), evidence,
        adapter: { snapshot: async () => [], stop: async () => {}, finalize: async () => {}, inspect: async () => "not_running" },
        remove: async () => {
          // Real partial destruction, followed by a controlled removal failure.
          // This is filesystem custody coverage, not an EBUSY reproduction.
          if (failure === "partial-removal") { await rm(journal); throw expected; }
        }, reset: () => { if (failure === "reset") throw expected; },
        restore: async () => {
          restored = true;
          if (failure === "environment") throw expected;
          if (failure === "copy-tamper") await writeFile(path.join(evidence.evidenceRoot, "journal.json"), "CHANGED");
        }, report: (value) => { summary = value; },
      }), (error) => {
        assert.ok(error instanceof AggregateError);
        if (failure !== "copy-tamper") assert.ok(error.errors.includes(expected));
        return true;
      });
      assert.equal(restored, true);
      assert.equal(summary.fixture, failure === "partial-removal" ? "partial" : "removed");
      assert.equal(summary.evidence, failure === "copy-tamper" ? "unresolved" : "retained");
      assert.equal(summary.reset, failure === "partial-removal" ? "not_attempted" : failure === "reset" ? "failed" : "reset");
      assert.equal(summary.environment, failure === "environment" ? "failed" : "restored");
      if (failure !== "copy-tamper") assert.equal(await readFile(path.join(evidence.evidenceRoot, "journal.json"), "utf8"), "PRIVATE-JOURNAL");
      assert.doesNotMatch(JSON.stringify(summary), /PRIVATE|pid|createdAt|executablePath|commandHash/);
    } finally {
      await evidence.release();
      await rm(directory, { recursive: true, force: true });
      if (evidence.evidenceRoot) await rm(evidence.evidenceRoot, { recursive: true, force: true });
      if (evidence.diagnosticRoot) await rm(evidence.diagnosticRoot, { recursive: true, force: true });
    }
  });
}
