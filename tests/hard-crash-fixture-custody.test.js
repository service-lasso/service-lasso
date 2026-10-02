import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createFixtureCustody, closeFixture, createFixtureCleanupAdapter } from "./hard-crash-fixture-custody.js";

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
    try {
      const work = closeFixture({ primary, custody,
        adapter: createFixtureCleanupAdapter({ workspaceRoot: directory, custodyReaders: [() => [child]] }, {
          readRegistry: async () => {
            if (scenario === "registry-read") throw new Error("PRIVATE-REGISTRY");
            return JSON.parse(await readFile(registryFile, "utf8"));
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
        restore: () => { restored = true; }, reset: () => { resets++; },
        remove: () => rm(directory, { recursive: true }), report: (value) => { summary = value; },
      });
      if (scenario === "success") {
        await work;
        await assert.rejects(readFile(journal), { code: "ENOENT" });
        assert.equal(resets, 1);
        assert.equal(summary.fixture, "removed");
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
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
}
