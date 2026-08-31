import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { startApiServer } from "../dist/server/index.js";
import { getLifecycleState, resetLifecycleState, setLifecycleState } from "../dist/runtime/lifecycle/store.js";
import { stopAllManagedProcesses } from "../dist/runtime/execution/supervisor.js";
import { readStoredState } from "../dist/runtime/state/readState.js";
import { makeTempServicesRoot, writeManifest } from "./test-helpers.js";

const DATABASE_URL_V1 = "postgres://operator:s3cret-token@db.internal:5432/keycloak";
const DATABASE_URL_V2 = "postgres://operator:s3cret-token@db.internal:5432/keycloak-v2";
const FINGERPRINT_DECLARED = ["${DATABASE_URL}", "${CONFIG_FILE_PATH}"];

async function postJson(url) {
  const response = await fetch(url, { method: "POST" });
  return {
    status: response.status,
    body: await response.json(),
  };
}

async function resetFingerprintState() {
  await stopAllManagedProcesses();
  resetLifecycleState();
}

/**
 * Write a setup helper that records how many times the step actually executed.
 */
async function writeFingerprintScript(serviceRoot) {
  const runtimeRoot = path.join(serviceRoot, "runtime");
  await mkdir(runtimeRoot, { recursive: true });
  await writeFile(
    path.join(runtimeRoot, "setup-fingerprint.mjs"),
    [
      "import { mkdir, readFile, writeFile } from \"node:fs/promises\";",
      "import path from \"node:path\";",
      "const dataPath = process.env.SERVICE_DATA_PATH;",
      "if (typeof dataPath !== \"string\" || dataPath.length === 0) {",
      "  throw new Error(\"SERVICE_DATA_PATH is required\");",
      "}",
      "const markerPath = path.join(dataPath, \"fingerprint-ran.json\");",
      "await mkdir(path.dirname(markerPath), { recursive: true });",
      "let count = 0;",
      "try {",
      "  count = JSON.parse(await readFile(markerPath, \"utf8\")).count;",
      "} catch {",
      "  count = 0;",
      "}",
      "if (typeof count !== \"number\" || !Number.isInteger(count) || count < 0) {",
      "  count = 0;",
      "}",
      "await writeFile(markerPath, JSON.stringify({ count: count + 1 }), \"utf8\");",
      "console.log(\"setup input fingerprint complete\");",
    ].join("\n"),
    "utf8",
  );
}

/**
 * @param {string} servicesRoot
 * @param {string} databaseUrl
 */
async function writeFingerprintManifest(servicesRoot, databaseUrl) {
  return writeManifest(servicesRoot, "fingerprint-setup", {
    id: "fingerprint-setup",
    name: "Fingerprint Setup",
    description: "Declarative setup input fingerprint proof.",
    env: {
      DATABASE_URL: databaseUrl,
      CONFIG_FILE_PATH: "${SERVICE_DATA_PATH}/runtime.conf",
    },
    setup: {
      steps: {
        "build-runtime-config": {
          description: "Compile runtime config from fingerprinted inputs.",
          executable: process.execPath,
          args: ["runtime/setup-fingerprint.mjs"],
          timeoutSeconds: 5,
          rerun: "ifChanged",
          fingerprint: FINGERPRINT_DECLARED,
        },
      },
    },
  });
}

/**
 * @param {string} databaseUrl
 */
async function startFingerprintFixture(databaseUrl) {
  const { tempRoot, servicesRoot, workspaceRoot } = await makeTempServicesRoot("service-lasso-setup-input-fingerprint-");
  const serviceRoot = await writeFingerprintManifest(servicesRoot, databaseUrl);
  await writeFingerprintScript(serviceRoot);
  const apiServer = await startApiServer({ port: 0, servicesRoot, workspaceRoot });
  await postJson(`${apiServer.url}/api/services/fingerprint-setup/install`);
  await postJson(`${apiServer.url}/api/services/fingerprint-setup/config`);
  return { tempRoot, serviceRoot, servicesRoot, workspaceRoot, apiServer };
}

/**
 * @param {unknown} snapshot
 */
function assertFingerprintSnapshot(snapshot) {
  assert.equal(snapshot.algorithm, "sha256");
  assert.match(snapshot.hash, /^[a-f0-9]{64}$/);
  assert.deepEqual(snapshot.declared, FINGERPRINT_DECLARED);
  assert.equal(typeof snapshot.evaluatedAt, "string");
  assert.equal("resolved" in snapshot, false);
}

/**
 * Stored setup state must never contain resolved fingerprint values.
 * @param {unknown} setupState
 */
function assertFingerprintStateIsSecretFree(setupState) {
  const serialized = JSON.stringify(setupState);
  assert.doesNotMatch(serialized, /s3cret-token/);
  assert.doesNotMatch(serialized, /db\.internal/);
  assert.doesNotMatch(serialized, /postgres:\/\//);
  assert.doesNotMatch(serialized, /password|token|secret/i);
}

async function readRunCount(serviceRoot) {
  return JSON.parse(await readFile(path.join(serviceRoot, "data", "fingerprint-ran.json"), "utf8")).count;
}

test("setup ifChanged skips when fingerprint inputs are unchanged", async () => {
  await resetFingerprintState();
  const { tempRoot, serviceRoot, apiServer } = await startFingerprintFixture(DATABASE_URL_V1);

  try {
    const first = await postJson(`${apiServer.url}/api/services/fingerprint-setup/setup/run/build-runtime-config`);
    assert.equal(first.status, 200);
    assert.equal(first.body.ok, true);
    assert.equal(first.body.runs[0].status, "succeeded");
    assert.equal(await readRunCount(serviceRoot), 1);

    const second = await postJson(`${apiServer.url}/api/services/fingerprint-setup/setup/run/build-runtime-config`);
    assert.equal(second.status, 200);
    assert.equal(second.body.ok, true);
    assert.equal(second.body.runs.length, 0);
    assert.equal(second.body.skipped[0].stepId, "build-runtime-config");
    assert.match(second.body.skipped[0].reason, /inputs unchanged/);
    assert.equal(await readRunCount(serviceRoot), 1);

    const stored = await readStoredState(serviceRoot);
    assert.equal(stored.setup.steps["build-runtime-config"].status, "succeeded");
    assertFingerprintSnapshot(stored.setup.steps["build-runtime-config"].inputFingerprint);
    assertFingerprintSnapshot(getLifecycleState("fingerprint-setup").setup.steps["build-runtime-config"].inputFingerprint);
    assertFingerprintStateIsSecretFree(stored.setup);
    assert.equal(
      stored.setup.steps["build-runtime-config"].inputFingerprint.hash,
      getLifecycleState("fingerprint-setup").setup.steps["build-runtime-config"].inputFingerprint.hash,
    );
  } finally {
    await apiServer.stop();
    await resetFingerprintState();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("setup ifChanged reruns when fingerprint inputs change", async () => {
  await resetFingerprintState();
  const { tempRoot, serviceRoot, servicesRoot, workspaceRoot, apiServer } =
    await startFingerprintFixture(DATABASE_URL_V1);

  try {
    const first = await postJson(`${apiServer.url}/api/services/fingerprint-setup/setup/run/build-runtime-config`);
    assert.equal(first.status, 200);
    assert.equal(first.body.ok, true);
    assert.equal(first.body.runs[0].status, "succeeded");
    const firstHash = (await readStoredState(serviceRoot)).setup.steps["build-runtime-config"].inputFingerprint.hash;
    assert.match(firstHash, /^[a-f0-9]{64}$/);

    await apiServer.stop();
    await resetFingerprintState();
    await writeFingerprintManifest(servicesRoot, DATABASE_URL_V2);
    const restarted = await startApiServer({ port: 0, servicesRoot, workspaceRoot });
    try {
      const rerun = await postJson(`${restarted.url}/api/services/fingerprint-setup/setup/run/build-runtime-config`);
      assert.equal(rerun.status, 200);
      assert.equal(rerun.body.ok, true);
      assert.equal(rerun.body.runs[0].status, "succeeded");
      assert.equal(rerun.body.skipped.length, 0);
      assert.equal(await readRunCount(serviceRoot), 2);

      const stored = await readStoredState(serviceRoot);
      assert.equal(stored.setup.steps["build-runtime-config"].history.length, 2);
      assertFingerprintSnapshot(stored.setup.steps["build-runtime-config"].inputFingerprint);
      assert.notEqual(stored.setup.steps["build-runtime-config"].inputFingerprint.hash, firstHash);
      assertFingerprintStateIsSecretFree(stored.setup);
    } finally {
      await restarted.stop();
    }
  } finally {
    await resetFingerprintState();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("setup ifChanged reruns when the installed artifact version changes", async () => {
  await resetFingerprintState();
  const { tempRoot, serviceRoot, apiServer } = await startFingerprintFixture(DATABASE_URL_V1);

  try {
    const current = getLifecycleState("fingerprint-setup");
    const artifact = current.installArtifacts.artifact ?? {
      sourceType: null,
      repo: null,
      channel: null,
      tag: null,
      assetName: null,
      assetUrl: null,
      archiveType: null,
      archivePath: null,
      extractedPath: null,
      command: null,
      args: [],
      checksum: null,
    };
    setLifecycleState("fingerprint-setup", {
      ...current,
      installArtifacts: {
        ...current.installArtifacts,
        artifact: {
          ...artifact,
          tag: "2026.8.1-old",
        },
      },
    });

    const first = await postJson(`${apiServer.url}/api/services/fingerprint-setup/setup/run/build-runtime-config`);
    assert.equal(first.status, 200);
    assert.equal(first.body.ok, true);
    assert.equal(first.body.runs[0].status, "succeeded");
    assert.equal(await readRunCount(serviceRoot), 1);
    const firstHash = getLifecycleState("fingerprint-setup").setup.steps["build-runtime-config"].inputFingerprint.hash;

    const afterFirst = getLifecycleState("fingerprint-setup");
    setLifecycleState("fingerprint-setup", {
      ...afterFirst,
      installArtifacts: {
        ...afterFirst.installArtifacts,
        artifact: {
          ...afterFirst.installArtifacts.artifact,
          tag: "2026.8.2-new",
        },
      },
    });

    const rerun = await postJson(`${apiServer.url}/api/services/fingerprint-setup/setup/run/build-runtime-config`);
    assert.equal(rerun.status, 200);
    assert.equal(rerun.body.ok, true);
    assert.equal(rerun.body.runs[0].status, "succeeded");
    assert.equal(rerun.body.skipped.length, 0);
    assert.equal(await readRunCount(serviceRoot), 2);

    const stored = await readStoredState(serviceRoot);
    assert.equal(stored.setup.steps["build-runtime-config"].history.length, 2);
    assertFingerprintSnapshot(stored.setup.steps["build-runtime-config"].inputFingerprint);
    assert.notEqual(stored.setup.steps["build-runtime-config"].inputFingerprint.hash, firstHash);
    assertFingerprintStateIsSecretFree(stored.setup);
  } finally {
    await apiServer.stop();
    await resetFingerprintState();
    await rm(tempRoot, { recursive: true, force: true });
  }
});
