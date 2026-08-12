import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import {
  activateWorkflowRepoSources,
  readWorkflowRepoSyncState,
  rollbackWorkflowRepoActivation,
  workflowRepoSyncEndpoints,
} from "../dist/platform/workflowSyncController.js";
import { exampleWorkflowPackageCatalog } from "../dist/platform/workflowCatalog.js";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

async function writePackage(root, packageDir, metadata, options = {}) {
  const packageRoot = path.join(root, packageDir);
  await mkdir(packageRoot, { recursive: true });
  await writeFile(path.join(packageRoot, "workflow-package.json"), JSON.stringify(metadata, null, 2));
  if (options.withDaguDefinitions !== false) {
    await mkdir(path.join(packageRoot, "workflows"), { recursive: true });
    for (const workflowId of metadata.workflows ?? []) {
      const workflowName = workflowId.split("/").at(-1);
      await writeFile(path.join(packageRoot, "workflows", `${workflowName}.yaml`), `name: ${workflowName}\nsteps: []\n`);
    }
  }
}

function fixedClock() {
  let tick = 0;
  return () => new Date(Date.UTC(2026, 4, 8, 11, 45, tick++));
}

function sourceFor(metadata, id = metadata.id) {
  return {
    id,
    source: metadata.source,
    repo: metadata.repository.repo,
    ref: metadata.repository.ref,
    channel: "stable",
  };
}

test("workflow repo sync exposes state sync activate and rollback endpoint contract", () => {
  assert.deepEqual(workflowRepoSyncEndpoints, {
    state: "GET /api/platform/workflow-repos/state",
    sync: "POST /api/platform/workflow-repos/sync",
    activate: "POST /api/platform/workflow-repos/activate",
    rollback: "POST /api/platform/workflow-repos/rollback",
  });
});

test("workflow repo activation syncs pinned sources validates packages and records active previous revisions", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "service-lasso-workflow-sync-"));
  const official = clone(exampleWorkflowPackageCatalog[0].metadata);
  const custom = clone(exampleWorkflowPackageCatalog[1].metadata);
  custom.repository.ref = "v0.1.0";

  try {
    const result = await activateWorkflowRepoSources([sourceFor(official), sourceFor(custom)], {
      workspaceRoot: tempRoot,
      now: fixedClock(),
      fetcher: async ({ source, destination }) => {
        const metadata = source.source === "official" ? official : custom;
        await writePackage(destination, metadata.id, metadata);
        return { revision: source.ref };
      },
    });

    assert.equal(result.ok, true);
    assert.equal(result.diagnostics.length, 0);
    assert.deepEqual(result.active?.packages, ["custom.local.reporting", "official.core.maintenance"]);
    assert.match(result.active?.activeRoot ?? "", /active/);
    assert.deepEqual(result.active?.sources.map((entry) => [entry.sourceId, entry.ref]), [
      ["official.core.maintenance", "2026.5.8"],
      ["custom.local.reporting", "v0.1.0"],
    ]);

    const secondOfficial = clone(official);
    secondOfficial.version = "2026.5.9";
    secondOfficial.repository.ref = "2026.5.9";
    const second = await activateWorkflowRepoSources([sourceFor(secondOfficial)], {
      workspaceRoot: tempRoot,
      now: fixedClock(),
      fetcher: async ({ source, destination }) => {
        await writePackage(destination, secondOfficial.id, secondOfficial);
        return { revision: source.ref };
      },
    });

    assert.equal(second.ok, true);
    assert.equal(second.state.previousGood?.revision, result.active?.revision);
    assert.equal(second.state.active?.revision, "official.core.maintenance@2026.5.9");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("workflow repo activation rejects empty source sets without promoting empty active state", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "service-lasso-workflow-sync-"));
  const official = clone(exampleWorkflowPackageCatalog[0].metadata);
  try {
    const initial = await activateWorkflowRepoSources([sourceFor(official)], {
      workspaceRoot: tempRoot,
      now: fixedClock(),
      fetcher: async ({ source, destination }) => {
        await writePackage(destination, official.id, official);
        return { revision: source.ref };
      },
    });
    assert.equal(initial.ok, true);

    const empty = await activateWorkflowRepoSources([], {
      workspaceRoot: tempRoot,
      now: fixedClock(),
      fetcher: async () => {
        throw new Error("fetcher should not run for empty sources");
      },
    });

    assert.equal(empty.ok, false);
    assert.equal(empty.active?.revision, initial.active?.revision);
    assert.equal(empty.state.failed?.rolledBackTo, initial.active?.revision);
    assert.ok(empty.diagnostics.some((diagnostic) => diagnostic.code === "missing-field" && diagnostic.field === "sources"));
    assert.ok(empty.diagnostics.every((diagnostic) => /Configure at least one/.test(diagnostic.action)));
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("workflow repo activation rejects mutable refs before production activation", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "service-lasso-workflow-sync-"));
  const official = clone(exampleWorkflowPackageCatalog[0].metadata);
  try {
    const result = await activateWorkflowRepoSources([{ ...sourceFor(official), ref: "main" }], {
      workspaceRoot: tempRoot,
      now: fixedClock(),
      fetcher: async ({ destination }) => {
        await writePackage(destination, official.id, official);
        return { revision: "main" };
      },
    });

    assert.equal(result.ok, false);
    assert.equal(result.state.active, undefined);
    assert.equal(result.state.failed?.rolledBackTo, undefined);
    assert.ok(result.diagnostics.some((diagnostic) => diagnostic.field === "ref" && /do not blindly pull main/i.test(diagnostic.action)));
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("workflow repo activation rejects missing Dagu definitions before activation", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "service-lasso-workflow-sync-"));
  const official = clone(exampleWorkflowPackageCatalog[0].metadata);
  try {
    const result = await activateWorkflowRepoSources([sourceFor(official)], {
      workspaceRoot: tempRoot,
      now: fixedClock(),
      fetcher: async ({ source, destination }) => {
        await writePackage(destination, official.id, official, { withDaguDefinitions: false });
        return { revision: source.ref };
      },
    });

    assert.equal(result.ok, false);
    assert.ok(result.diagnostics.some((diagnostic) => /Dagu workflow definition/.test(diagnostic.message)));
    assert.equal(result.state.active, undefined);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("workflow repo activation rejects catalog collisions and keeps previous-good active", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "service-lasso-workflow-sync-"));
  const official = clone(exampleWorkflowPackageCatalog[0].metadata);
  const custom = clone(exampleWorkflowPackageCatalog[1].metadata);
  custom.repository.ref = "v0.1.0";
  custom.workflows = [official.workflows[0]];

  try {
    const initial = await activateWorkflowRepoSources([sourceFor(official)], {
      workspaceRoot: tempRoot,
      now: fixedClock(),
      fetcher: async ({ source, destination }) => {
        await writePackage(destination, official.id, official);
        return { revision: source.ref };
      },
    });
    assert.equal(initial.ok, true);

    const failed = await activateWorkflowRepoSources([sourceFor(official), sourceFor(custom)], {
      workspaceRoot: tempRoot,
      now: fixedClock(),
      fetcher: async ({ source, destination }) => {
        const metadata = source.source === "official" ? official : custom;
        await writePackage(destination, metadata.id, metadata);
        return { revision: source.ref };
      },
    });

    assert.equal(failed.ok, false);
    assert.equal(failed.active?.revision, initial.active?.revision);
    assert.equal(failed.state.failed?.rolledBackTo, initial.active?.revision);
    assert.ok(failed.diagnostics.some((diagnostic) => diagnostic.code === "workflow-collision"));
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("workflow repo rollback restores previous-good revision state", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "service-lasso-workflow-sync-"));
  const official = clone(exampleWorkflowPackageCatalog[0].metadata);
  const next = clone(official);
  next.version = "2026.5.9";
  next.repository.ref = "2026.5.9";

  try {
    const first = await activateWorkflowRepoSources([sourceFor(official)], {
      workspaceRoot: tempRoot,
      now: fixedClock(),
      fetcher: async ({ source, destination }) => {
        await writePackage(destination, official.id, official);
        return { revision: source.ref };
      },
    });
    const second = await activateWorkflowRepoSources([sourceFor(next)], {
      workspaceRoot: tempRoot,
      now: fixedClock(),
      fetcher: async ({ source, destination }) => {
        await writePackage(destination, next.id, next);
        return { revision: source.ref };
      },
    });
    assert.notEqual(first.active?.revision, second.active?.revision);

    const rolledBack = await rollbackWorkflowRepoActivation({ workspaceRoot: tempRoot, now: fixedClock() });
    assert.equal(rolledBack.active?.revision, first.active?.revision);
    assert.equal(rolledBack.previousGood?.revision, second.active?.revision);

    const persisted = await readWorkflowRepoSyncState(path.join(tempRoot, "state.json"));
    assert.equal(persisted.active?.revision, first.active?.revision);
    assert.equal(persisted.history.at(-1)?.result, "rolled-back");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
