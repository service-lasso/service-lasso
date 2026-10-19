import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createFixtureCustody, closeFixture, createFixtureCleanupAdapter, createFixtureEvidenceBoundary } from "./hard-crash-fixture-custody.js";

// Original action/assertion bodies run once in the fresh test-file isolate.
// Error identity and reset counts remain local; no decoded result proves them.
const root = { pid: 1, createdAt: "root", executablePath: "PRIVATE-PATH", commandHash: "a".repeat(64) };
const child = { ...root, pid: 2, createdAt: "child" };

export function registerTerminalCustodySuccess() {
  const scenario = "success";
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

export function registerPostRemovalCustody(failure) {
  if (!["reset", "environment", "copy-tamper"].includes(failure)) throw new Error("Unknown post-removal custody row.");
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
