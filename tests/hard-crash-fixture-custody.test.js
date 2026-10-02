import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm, rename, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createFixtureCustody, closeFixture, createFixtureCleanupAdapter, createFixtureEvidenceBoundary, verifyOriginalFixturePrivacy, protectOriginalFixture } from "./hard-crash-fixture-custody.js";
import { holdFixtureRoot } from "./fixture-root-custody.js";
import { getProcessRegistryPath, readProcessOwnershipCustodyForTest } from "../dist/runtime/process/registry.js";

const root = { pid: 1, createdAt: "root", executablePath: "PRIVATE-PATH", commandHash: "a".repeat(64) };
const child = { ...root, pid: 2, createdAt: "child" };

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
