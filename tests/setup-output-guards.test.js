import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { startApiServer } from "../dist/server/index.js";
import { getLifecycleState, resetLifecycleState } from "../dist/runtime/lifecycle/store.js";
import { stopAllManagedProcesses } from "../dist/runtime/execution/supervisor.js";
import { readStoredState } from "../dist/runtime/state/readState.js";
import {
  makeTempServicesRoot,
  writeManifest,
} from "./test-helpers.js";

async function postJson(url) {
  const response = await fetch(url, { method: "POST" });
  return {
    status: response.status,
    body: await response.json(),
  };
}

async function resetSetupGuardState() {
  await stopAllManagedProcesses();
  resetLifecycleState();
}

/**
 * Write a setup helper that creates both a file and a directory under SERVICE_DATA_PATH.
 */
async function writeGuardScript(serviceRoot) {
  const runtimeRoot = path.join(serviceRoot, "runtime");
  await mkdir(runtimeRoot, { recursive: true });
  await writeFile(
    path.join(runtimeRoot, "setup-output-guards.mjs"),
    [
      "import { mkdir, writeFile } from \"node:fs/promises\";",
      "import path from \"node:path\";",
      "const dataPath = process.env.SERVICE_DATA_PATH;",
      "if (typeof dataPath !== \"string\" || dataPath.length === 0) {",
      "  throw new Error(\"SERVICE_DATA_PATH is required\");",
      "}",
      "const filePath = path.join(dataPath, \"guards\", \"keystore\");",
      "const dirPath = path.join(dataPath, \"guards\", \"cache\");",
      "await mkdir(dirPath, { recursive: true });",
      "await writeFile(filePath, JSON.stringify({ serviceId: process.env.SERVICE_ID }), \"utf8\");",
      "console.log(\"setup output guards complete\");",
    ].join("\n"),
    "utf8",
  );
}

const guardCreates = [
  "${SERVICE_DATA_PATH}/guards/keystore",
  "${SERVICE_DATA_PATH}/guards/cache",
];

async function startGuardFixture() {
  const { tempRoot, servicesRoot, workspaceRoot } = await makeTempServicesRoot("service-lasso-setup-output-guards-");
  const serviceRoot = await writeManifest(servicesRoot, "guarded-setup", {
    id: "guarded-setup",
    name: "Guarded Setup",
    description: "Declarative creates output-guard proof.",
    setup: {
      steps: {
        "generate-outputs": {
          description: "Create a file and directory that ifMissing can guard.",
          executable: process.execPath,
          args: ["runtime/setup-output-guards.mjs"],
          timeoutSeconds: 5,
          rerun: "ifMissing",
          creates: guardCreates,
        },
      },
    },
  });
  await writeGuardScript(serviceRoot);
  const apiServer = await startApiServer({ port: 0, servicesRoot, workspaceRoot });
  await postJson(`${apiServer.url}/api/services/guarded-setup/install`);
  await postJson(`${apiServer.url}/api/services/guarded-setup/config`);
  return { tempRoot, serviceRoot, apiServer };
}

function assertGuardSnapshot(snapshot, expectedPresent) {
  assert.equal(snapshot.satisfied, expectedPresent);
  assert.equal(snapshot.results.length, 2);
  assert.equal(snapshot.results[0].declared, "${SERVICE_DATA_PATH}/guards/keystore");
  assert.equal(snapshot.results[0].relativePath, "data/guards/keystore");
  assert.equal(snapshot.results[0].present, expectedPresent);
  assert.equal(snapshot.results[1].declared, "${SERVICE_DATA_PATH}/guards/cache");
  assert.equal(snapshot.results[1].relativePath, "data/guards/cache");
  assert.equal(snapshot.results[1].present, expectedPresent);
  if (expectedPresent) {
    assert.equal(snapshot.results[0].kind, "file");
    assert.equal(snapshot.results[1].kind, "directory");
  } else {
    assert.equal(snapshot.results[0].kind, null);
    assert.equal(snapshot.results[1].kind, null);
  }
  const serialized = JSON.stringify(snapshot);
  assert.doesNotMatch(serialized, /password|token|secret/i);
  assert.doesNotMatch(serialized, /:[\\/]{2}|[A-Za-z]:[\\/]/);
}

test("setup ifMissing skips when declared creates already exist", async () => {
  await resetSetupGuardState();
  const { tempRoot, serviceRoot, apiServer } = await startGuardFixture();

  try {
    const first = await postJson(`${apiServer.url}/api/services/guarded-setup/setup/run/generate-outputs`);
    assert.equal(first.status, 200);
    assert.equal(first.body.ok, true);
    assert.equal(first.body.runs[0].status, "succeeded");

    const second = await postJson(`${apiServer.url}/api/services/guarded-setup/setup/run/generate-outputs`);
    assert.equal(second.status, 200);
    assert.equal(second.body.ok, true);
    assert.equal(second.body.runs.length, 0);
    assert.equal(second.body.skipped[0].stepId, "generate-outputs");
    assert.match(second.body.skipped[0].reason, /creates already exist/);

    const stored = await readStoredState(serviceRoot);
    assert.equal(stored.setup.steps["generate-outputs"].status, "succeeded");
    assertGuardSnapshot(stored.setup.steps["generate-outputs"].outputGuards, true);
    assertGuardSnapshot(getLifecycleState("guarded-setup").setup.steps["generate-outputs"].outputGuards, true);
  } finally {
    await apiServer.stop();
    await resetSetupGuardState();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("setup ifMissing reruns when declared creates are missing", async () => {
  await resetSetupGuardState();
  const { tempRoot, serviceRoot, apiServer } = await startGuardFixture();

  try {
    const first = await postJson(`${apiServer.url}/api/services/guarded-setup/setup/run/generate-outputs`);
    assert.equal(first.status, 200);
    assert.equal(first.body.ok, true);
    assert.equal(first.body.runs[0].status, "succeeded");
    assert.equal(first.body.runs.length, 1);

    const stored = await readStoredState(serviceRoot);
    assertGuardSnapshot(stored.setup.steps["generate-outputs"].outputGuards, true);
    assert.equal(
      JSON.parse(await readFile(path.join(serviceRoot, "data", "guards", "keystore"), "utf8")).serviceId,
      "guarded-setup",
    );
  } finally {
    await apiServer.stop();
    await resetSetupGuardState();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("setup ifMissing reruns when declared creates are deleted after success", async () => {
  await resetSetupGuardState();
  const { tempRoot, serviceRoot, apiServer } = await startGuardFixture();

  try {
    const first = await postJson(`${apiServer.url}/api/services/guarded-setup/setup/run/generate-outputs`);
    assert.equal(first.status, 200);
    assert.equal(first.body.ok, true);
    assert.equal(first.body.runs[0].status, "succeeded");

    await rm(path.join(serviceRoot, "data", "guards"), { recursive: true, force: true });

    const rerun = await postJson(`${apiServer.url}/api/services/guarded-setup/setup/run/generate-outputs`);
    assert.equal(rerun.status, 200);
    assert.equal(rerun.body.ok, true);
    assert.equal(rerun.body.runs[0].status, "succeeded");
    assert.equal(rerun.body.skipped.length, 0);

    const stored = await readStoredState(serviceRoot);
    assert.equal(stored.setup.steps["generate-outputs"].history.length, 2);
    assertGuardSnapshot(stored.setup.steps["generate-outputs"].outputGuards, true);
    assert.equal(
      JSON.parse(await readFile(path.join(serviceRoot, "data", "guards", "keystore"), "utf8")).serviceId,
      "guarded-setup",
    );
  } finally {
    await apiServer.stop();
    await resetSetupGuardState();
    await rm(tempRoot, { recursive: true, force: true });
  }
});
