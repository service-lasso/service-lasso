import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { startApiServer } from "../dist/server/index.js";
import { bootstrapBaselineServices } from "../dist/runtime/cli/bootstrap.js";
import { readStoredState } from "../dist/runtime/state/readState.js";
import { getLifecycleState, resetLifecycleState, setLifecycleState } from "../dist/runtime/lifecycle/store.js";
import { stopAllManagedProcesses } from "../dist/runtime/execution/supervisor.js";
import { makeTempServicesRoot, writeExecutableFixtureService, writeManifest } from "./test-helpers.js";

const execFile = promisify(execFileCallback);

async function postJson(url) {
  const response = await fetch(url, { method: "POST" });
  return {
    status: response.status,
    body: await response.json(),
  };
}

async function resetSetupTestState() {
  await stopAllManagedProcesses();
  resetLifecycleState();
}

async function runCli(args) {
  const result = await execFile(process.execPath, [path.resolve("dist", "cli.js"), ...args], {
    cwd: path.resolve("."),
    env: {
      ...process.env,
      npm_package_version: "0.1.0-test",
    },
  });

  return result.stdout.trim();
}

async function writeSetupScript(serviceRoot, name = "setup-writer.mjs") {
  const runtimeRoot = path.join(serviceRoot, "runtime");
  await mkdir(runtimeRoot, { recursive: true });
  await writeFile(
    path.join(runtimeRoot, name),
    [
      "import { mkdir, writeFile } from 'node:fs/promises';",
      "import path from 'node:path';",
      "const outputPath = path.resolve(process.cwd(), process.env.SETUP_OUTPUT_PATH ?? './runtime/setup-output.json');",
      "await mkdir(path.dirname(outputPath), { recursive: true });",
      "await writeFile(outputPath, JSON.stringify({",
      "  serviceId: process.env.SERVICE_ID,",
      "  serviceRoot: process.env.SERVICE_ROOT,",
      "  dataPath: process.env.SERVICE_DATA_PATH,",
      "  cwd: process.cwd(),",
      "  inherited: process.env.INHERITED_GLOBAL ?? null,",
      "  stepValue: process.env.STEP_VALUE ?? null",
      "}, null, 2));",
      "console.log('setup writer complete');",
      "console.error('setup writer stderr');",
    ].join("\n"),
    "utf8",
  );
}

async function writeFingerprintSetupScript(serviceRoot) {
  const runtimeRoot = path.join(serviceRoot, "runtime");
  await mkdir(runtimeRoot, { recursive: true });
  await writeFile(
    path.join(runtimeRoot, "fingerprint-writer.mjs"),
    [
      "import { mkdir, readFile, writeFile } from 'node:fs/promises';",
      "import path from 'node:path';",
      "const outputPath = path.resolve(process.cwd(), './runtime/fingerprint-output.json');",
      "let count = 0;",
      "try { count = JSON.parse(await readFile(outputPath, 'utf8')).count ?? 0; } catch {}",
      "await mkdir(path.dirname(outputPath), { recursive: true });",
      "await writeFile(outputPath, JSON.stringify({",
      "  count: count + 1,",
      "  stepValue: process.env.STEP_VALUE ?? null,",
      "  artifactRoot: process.env.SERVICE_ARTIFACT_ROOT ?? null",
      "}, null, 2));",
      "console.log('fingerprint writer complete');",
    ].join("\n"),
    "utf8",
  );
}

test("setup run executes direct steps, captures logs, and persists setup history", async () => {
  await resetSetupTestState();
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-setup-direct-");
  const serviceRoot = await writeManifest(servicesRoot, "setup-service", {
    id: "setup-service",
    name: "Setup Service",
    description: "Direct setup proof.",
    env: {
      SETUP_OUTPUT_PATH: "./runtime/setup-output.json",
    },
    setup: {
      steps: {
        "write-file": {
          description: "Write a deterministic setup output file.",
          executable: process.execPath,
          args: ["runtime/setup-writer.mjs"],
          env: {
            STEP_VALUE: "configured-${SERVICE_ID}",
          },
          timeoutSeconds: 5,
        },
      },
    },
  });
  await writeSetupScript(serviceRoot);
  const apiServer = await startApiServer({ port: 0, servicesRoot });

  try {
    await postJson(`${apiServer.url}/api/services/setup-service/install`);
    await postJson(`${apiServer.url}/api/services/setup-service/config`);
    const setup = await postJson(`${apiServer.url}/api/services/setup-service/setup/run/write-file`);

    assert.equal(setup.status, 200);
    assert.equal(setup.body.ok, true);
    assert.equal(setup.body.runs[0].status, "succeeded");
    assert.equal(setup.body.runs[0].exitCode, 0);
    assert.match(setup.body.runs[0].command, /setup-writer\.mjs/);

    const output = JSON.parse(await readFile(path.join(serviceRoot, "runtime", "setup-output.json"), "utf8"));
    assert.equal(output.serviceId, "setup-service");
    assert.equal(output.serviceRoot, serviceRoot);
    assert.equal(output.dataPath, path.join(serviceRoot, "data"));
    assert.equal(path.resolve(output.cwd), path.resolve(serviceRoot));
    assert.equal(output.stepValue, "configured-setup-service");

    const stored = await readStoredState(serviceRoot);
    assert.equal(stored.setup.steps["write-file"].status, "succeeded");
    assert.equal(path.resolve(stored.setup.steps["write-file"].lastRun.cwd), path.resolve(serviceRoot));
    assert.equal(stored.runtime.lastAction, "setup");
    assert.deepEqual(stored.runtime.actionHistory, ["install", "config", "setup"]);
    assert.match(await readFile(stored.setup.steps["write-file"].lastRun.logs.stdoutPath, "utf8"), /setup writer complete/);
    assert.match(await readFile(stored.setup.steps["write-file"].lastRun.logs.stderrPath, "utf8"), /setup writer stderr/);
  } finally {
    await apiServer.stop();
    await resetSetupTestState();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("setup run resolves explicit cwd selectors and records cwd in history", async () => {
  await resetSetupTestState();
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-setup-cwd-");
  const serviceRoot = await writeManifest(servicesRoot, "setup-cwd", {
    id: "setup-cwd",
    name: "Setup Cwd",
    description: "Explicit setup cwd proof.",
    setup: {
      steps: {
        "service-root": {
          executable: process.execPath,
          cwd: "${SERVICE_ROOT}",
          args: ["runtime/setup-writer.mjs"],
          timeoutSeconds: 5,
        },
        "artifact-bin": {
          executable: process.execPath,
          cwd: "${SERVICE_ROOT}/runtime/bin",
          args: ["runtime/setup-writer.mjs"],
          env: {
            SETUP_OUTPUT_PATH: "./cwd-output.json",
          },
          timeoutSeconds: 5,
        },
      },
    },
  });
  await writeSetupScript(serviceRoot);
  await mkdir(path.join(serviceRoot, "runtime", "bin"), { recursive: true });
  await writeSetupScript(path.join(serviceRoot, "runtime", "bin"));
  const apiServer = await startApiServer({ port: 0, servicesRoot });

  try {
    await postJson(`${apiServer.url}/api/services/setup-cwd/install`);
    await postJson(`${apiServer.url}/api/services/setup-cwd/config`);

    const serviceRootRun = await postJson(`${apiServer.url}/api/services/setup-cwd/setup/run/service-root`);
    assert.equal(serviceRootRun.status, 200);
    assert.equal(serviceRootRun.body.ok, true);
    assert.equal(path.resolve(serviceRootRun.body.runs[0].cwd), path.resolve(serviceRoot));

    const artifactBinRun = await postJson(`${apiServer.url}/api/services/setup-cwd/setup/run/artifact-bin`);
    assert.equal(artifactBinRun.status, 200);
    assert.equal(artifactBinRun.body.ok, true);
    assert.equal(path.resolve(artifactBinRun.body.runs[0].cwd), path.resolve(serviceRoot, "runtime", "bin"));

    const output = JSON.parse(await readFile(path.join(serviceRoot, "runtime", "bin", "cwd-output.json"), "utf8"));
    assert.equal(path.resolve(output.cwd), path.resolve(serviceRoot, "runtime", "bin"));

    const stored = await readStoredState(serviceRoot);
    assert.equal(path.resolve(stored.setup.steps["service-root"].lastRun.cwd), path.resolve(serviceRoot));
    assert.equal(path.resolve(stored.setup.steps["artifact-bin"].lastRun.cwd), path.resolve(serviceRoot, "runtime", "bin"));
  } finally {
    await apiServer.stop();
    await resetSetupTestState();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("setup run fails before spawning when cwd is missing or outside the service root", async () => {
  await resetSetupTestState();
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-setup-cwd-invalid-");
  const serviceRoot = await writeManifest(servicesRoot, "bad-setup-cwd", {
    id: "bad-setup-cwd",
    name: "Bad Setup Cwd",
    description: "Invalid setup cwd proof.",
    setup: {
      steps: {
        missing: {
          executable: process.execPath,
          cwd: "${SERVICE_ROOT}/missing",
          args: ["-e", "process.exit(99)"],
          timeoutSeconds: 5,
          rerun: "always",
        },
        escape: {
          executable: process.execPath,
          cwd: "../outside",
          args: ["-e", "process.exit(99)"],
          timeoutSeconds: 5,
          rerun: "always",
        },
      },
    },
  });
  const apiServer = await startApiServer({ port: 0, servicesRoot });

  try {
    await postJson(`${apiServer.url}/api/services/bad-setup-cwd/install`);
    await postJson(`${apiServer.url}/api/services/bad-setup-cwd/config`);

    const missing = await postJson(`${apiServer.url}/api/services/bad-setup-cwd/setup/run/missing`);
    assert.equal(missing.status, 200);
    assert.equal(missing.body.ok, false);
    assert.equal(missing.body.runs[0].exitCode, null);
    assert.match(missing.body.runs[0].message, /does not exist/);
    assert.equal(path.resolve(missing.body.runs[0].cwd), path.resolve(serviceRoot, "missing"));

    const escape = await postJson(`${apiServer.url}/api/services/bad-setup-cwd/setup/run/escape`);
    assert.equal(escape.status, 200);
    assert.equal(escape.body.ok, false);
    assert.equal(escape.body.runs[0].exitCode, null);
    assert.match(escape.body.runs[0].message, /must stay inside the service root/);
  } finally {
    await apiServer.stop();
    await resetSetupTestState();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("ifChanged setup steps skip unchanged inputs and rerun after fingerprint changes", async () => {
  await resetSetupTestState();
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-setup-ifchanged-");
  let apiServer;

  async function writeFingerprintManifest(value) {
    return writeManifest(servicesRoot, "fingerprinted", {
      id: "fingerprinted",
      name: "Fingerprinted Setup",
      description: "Setup step with input fingerprint policy.",
      env: {
        FINGERPRINT_VALUE: value,
      },
      setup: {
        steps: {
          "write-fingerprint": {
            executable: process.execPath,
            args: ["runtime/fingerprint-writer.mjs"],
            env: {
              STEP_VALUE: "${FINGERPRINT_VALUE}",
            },
            rerun: "ifChanged",
            fingerprint: ["${FINGERPRINT_VALUE}", "${SERVICE_ARTIFACT_ROOT}"],
            timeoutSeconds: 5,
          },
        },
      },
    });
  }

  function setArtifactRoot(serviceRoot, label) {
    const current = getLifecycleState("fingerprinted");
    setLifecycleState("fingerprinted", {
      ...current,
      installArtifacts: {
        ...current.installArtifacts,
        artifact: {
          sourceType: "github-release",
          repo: "service-lasso/example-service",
          channel: null,
          tag: label,
          assetName: "example.zip",
          assetUrl: null,
          archiveType: "zip",
          archivePath: path.join(serviceRoot, "runtime", `${label}.zip`),
          extractedPath: path.join(serviceRoot, "runtime", label),
          command: "fingerprint-writer.mjs",
          args: [],
          checksum: null,
        },
      },
    });
  }

  try {
    const serviceRoot = await writeFingerprintManifest("alpha");
    await writeFingerprintSetupScript(serviceRoot);
    apiServer = await startApiServer({ port: 0, servicesRoot });
    await postJson(`${apiServer.url}/api/services/fingerprinted/install`);
    await postJson(`${apiServer.url}/api/services/fingerprinted/config`);
    setArtifactRoot(serviceRoot, "artifact-v1");

    const first = await postJson(`${apiServer.url}/api/services/fingerprinted/setup/run/write-fingerprint`);
    assert.equal(first.status, 200);
    assert.equal(first.body.ok, true);
    assert.equal(first.body.runs[0].status, "succeeded");
    assert.equal(first.body.runs[0].inputFingerprint.algorithm, "sha256");
    assert.match(first.body.runs[0].inputFingerprint.hash, /^[a-f0-9]{64}$/);
    assert.equal(first.body.runs[0].inputFingerprint.inputCount, 2);

    const unchanged = await postJson(`${apiServer.url}/api/services/fingerprinted/setup/run/write-fingerprint`);
    assert.equal(unchanged.status, 200);
    assert.equal(unchanged.body.ok, true);
    assert.deepEqual(unchanged.body.runs, []);
    assert.deepEqual(unchanged.body.skipped, [{ stepId: "write-fingerprint", reason: "setup step inputs unchanged" }]);

    let output = JSON.parse(await readFile(path.join(serviceRoot, "runtime", "fingerprint-output.json"), "utf8"));
    assert.equal(output.count, 1);
    assert.equal(output.stepValue, "alpha");
    assert.equal(path.resolve(output.artifactRoot), path.resolve(serviceRoot, "runtime", "artifact-v1"));

    await apiServer.stop();
    apiServer = undefined;
    await writeFingerprintManifest("beta");
    apiServer = await startApiServer({ port: 0, servicesRoot });

    const changedEnv = await postJson(`${apiServer.url}/api/services/fingerprinted/setup/run/write-fingerprint`);
    assert.equal(changedEnv.status, 200);
    assert.equal(changedEnv.body.ok, true);
    assert.equal(changedEnv.body.runs[0].status, "succeeded");
    output = JSON.parse(await readFile(path.join(serviceRoot, "runtime", "fingerprint-output.json"), "utf8"));
    assert.equal(output.count, 2);
    assert.equal(output.stepValue, "beta");

    setArtifactRoot(serviceRoot, "artifact-v2");
    const changedArtifact = await postJson(`${apiServer.url}/api/services/fingerprinted/setup/run/write-fingerprint`);
    assert.equal(changedArtifact.status, 200);
    assert.equal(changedArtifact.body.ok, true);
    assert.equal(changedArtifact.body.runs[0].status, "succeeded");
    output = JSON.parse(await readFile(path.join(serviceRoot, "runtime", "fingerprint-output.json"), "utf8"));
    assert.equal(output.count, 3);
    assert.equal(path.resolve(output.artifactRoot), path.resolve(serviceRoot, "runtime", "artifact-v2"));

    const stored = await readStoredState(serviceRoot);
    const lastRun = stored.setup.steps["write-fingerprint"].lastRun;
    assert.equal(lastRun.inputFingerprint.algorithm, "sha256");
    assert.match(lastRun.inputFingerprint.hash, /^[a-f0-9]{64}$/);
    assert.doesNotMatch(JSON.stringify(lastRun.inputFingerprint), /alpha|beta|artifact-v2/);
  } finally {
    if (apiServer) {
      await apiServer.stop();
    }
    await resetSetupTestState();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("provider-backed setup runs through execservice with provider env", async () => {
  await resetSetupTestState();
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-setup-provider-");
  await writeManifest(servicesRoot, "@node", {
    id: "@node",
    name: "Node Provider",
    description: "Provider for setup proof.",
    role: "provider",
    executable: process.execPath,
    env: {
      INHERITED_GLOBAL: "from-provider",
    },
  });
  const serviceRoot = await writeManifest(servicesRoot, "consumer", {
    id: "consumer",
    name: "Consumer",
    description: "Provider-backed setup consumer.",
    depend_on: ["@node"],
    setup: {
      steps: {
        "provider-write": {
          depend_on: ["@node"],
          execservice: "@node",
          args: ["runtime/setup-writer.mjs"],
          timeoutSeconds: 5,
        },
      },
    },
  });
  await writeSetupScript(serviceRoot);
  const apiServer = await startApiServer({ port: 0, servicesRoot });

  try {
    for (const serviceId of ["@node", "consumer"]) {
      assert.equal((await postJson(`${apiServer.url}/api/services/${encodeURIComponent(serviceId)}/install`)).status, 200);
      assert.equal((await postJson(`${apiServer.url}/api/services/${encodeURIComponent(serviceId)}/config`)).status, 200);
    }

    const setup = await postJson(`${apiServer.url}/api/services/consumer/setup/run/provider-write`);

    assert.equal(setup.status, 200);
    assert.equal(setup.body.ok, true);
    assert.equal(setup.body.runs[0].status, "succeeded");
    const output = JSON.parse(await readFile(path.join(serviceRoot, "runtime", "setup-output.json"), "utf8"));
    assert.equal(output.inherited, "from-provider");
  } finally {
    await apiServer.stop();
    await resetSetupTestState();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("setup dependencies start required daemon services before running the step", async () => {
  await resetSetupTestState();
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-setup-dependency-");
  const database = await writeExecutableFixtureService(servicesRoot, "database", {
    readyFileAfterMs: 20,
    readyFileRelativePath: "./runtime/ready.txt",
    healthcheck: {
      type: "file",
      file: "./runtime/ready.txt",
      retries: 10,
      interval: 20,
    },
  });
  const serviceRoot = await writeManifest(servicesRoot, "loader", {
    id: "loader",
    name: "Loader",
    description: "Setup dependency proof.",
    setup: {
      steps: {
        load: {
          depend_on: ["database"],
          executable: process.execPath,
          args: ["runtime/setup-writer.mjs"],
          timeoutSeconds: 5,
        },
      },
    },
  });
  await writeSetupScript(serviceRoot);
  const apiServer = await startApiServer({ port: 0, servicesRoot });

  try {
    for (const serviceId of ["database", "loader"]) {
      assert.equal((await postJson(`${apiServer.url}/api/services/${serviceId}/install`)).status, 200);
      assert.equal((await postJson(`${apiServer.url}/api/services/${serviceId}/config`)).status, 200);
    }

    const setup = await postJson(`${apiServer.url}/api/services/loader/setup/run/load`);

    assert.equal(setup.status, 200);
    assert.equal(setup.body.ok, true);
    assert.equal(getLifecycleState("database").running, true);
    assert.equal((await readStoredState(database.serviceRoot)).runtime.running, true);
    assert.equal(getLifecycleState("loader").setup.steps.load.status, "succeeded");
  } finally {
    await apiServer.stop();
    await resetSetupTestState();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("setup records failed and timed-out steps without pretending success", async () => {
  await resetSetupTestState();
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-setup-failure-");
  await writeManifest(servicesRoot, "broken-setup", {
    id: "broken-setup",
    name: "Broken Setup",
    description: "Failure setup proof.",
    setup: {
      steps: {
        fail: {
          executable: process.execPath,
          args: ["-e", "process.exit(7)"],
          timeoutSeconds: 5,
          rerun: "always",
        },
        timeout: {
          executable: process.execPath,
          args: ["-e", "setInterval(() => {}, 1000)"],
          timeoutSeconds: 1,
          rerun: "manual",
        },
      },
    },
  });
  const apiServer = await startApiServer({ port: 0, servicesRoot });

  try {
    await postJson(`${apiServer.url}/api/services/broken-setup/install`);
    await postJson(`${apiServer.url}/api/services/broken-setup/config`);

    const failure = await postJson(`${apiServer.url}/api/services/broken-setup/setup/run/fail`);
    assert.equal(failure.status, 200);
    assert.equal(failure.body.ok, false);
    assert.equal(failure.body.runs[0].status, "failed");
    assert.equal(failure.body.runs[0].exitCode, 7);

    const timeout = await postJson(`${apiServer.url}/api/services/broken-setup/setup/run/timeout`);
    assert.equal(timeout.status, 200);
    assert.equal(timeout.body.ok, false);
    assert.equal(timeout.body.runs[0].status, "timeout");
  } finally {
    await apiServer.stop();
    await resetSetupTestState();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("CLI setup list and run expose stable JSON output", async () => {
  await resetSetupTestState();
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-setup-cli-");
  const workspaceRoot = path.join(tempRoot, "workspace");
  await mkdir(workspaceRoot, { recursive: true });
  const serviceRoot = await writeManifest(servicesRoot, "cli-setup", {
    id: "cli-setup",
    name: "CLI Setup",
    description: "CLI setup proof.",
    setup: {
      steps: {
        write: {
          executable: process.execPath,
          args: ["runtime/setup-writer.mjs"],
          timeoutSeconds: 5,
        },
      },
    },
  });
  await writeSetupScript(serviceRoot);

  try {
    const list = JSON.parse(
      await runCli(["setup", "list", "--services-root", servicesRoot, "--workspace-root", workspaceRoot, "--json"]),
    );
    assert.deepEqual(list.services, [{ serviceId: "cli-setup", steps: ["write"] }]);

    await runCli(["install", "cli-setup", "--services-root", servicesRoot, "--workspace-root", workspaceRoot, "--json"]);
    const apiServer = await startApiServer({ port: 0, servicesRoot, workspaceRoot });
    try {
      assert.equal((await postJson(`${apiServer.url}/api/services/cli-setup/config`)).status, 200);
    } finally {
      await apiServer.stop();
    }

    const run = JSON.parse(
      await runCli(["setup", "run", "cli-setup", "--services-root", servicesRoot, "--workspace-root", workspaceRoot, "--json"]),
    );
    assert.equal(run.result.ok, true);
    assert.equal(run.result.runs[0].stepId, "write");
    assert.equal(run.result.runs[0].status, "succeeded");
  } finally {
    await resetSetupTestState();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("bootstrapBaselineServices runs non-manual setup steps for provider-role services", async () => {
  await resetSetupTestState();
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-setup-bootstrap-");
  const workspaceRoot = path.join(tempRoot, "workspace");

  try {
    const localcert = await writeExecutableFixtureService(servicesRoot, "@localcert", {
      role: "provider",
      healthcheck: null,
      setup: {
        steps: {
          generate: {
            executable: process.execPath,
            args: ["runtime/setup-writer.mjs"],
            timeoutSeconds: 5,
          },
        },
      },
    });
    await writeSetupScript(localcert.serviceRoot);
    await writeExecutableFixtureService(servicesRoot, "@archive", { role: "provider", enabled: false, healthcheck: null });
    await writeExecutableFixtureService(servicesRoot, "@java", { role: "provider", healthcheck: null });
    await writeExecutableFixtureService(servicesRoot, "@nginx", { role: "provider", healthcheck: null });
    await writeExecutableFixtureService(servicesRoot, "@traefik", { depend_on: ["@localcert", "@nginx"] });
    await writeExecutableFixtureService(servicesRoot, "@node", { role: "provider", healthcheck: null });
    await writeExecutableFixtureService(servicesRoot, "@python", { role: "provider", enabled: false, healthcheck: null });
    await writeExecutableFixtureService(servicesRoot, "@secretsbroker");
    await writeExecutableFixtureService(servicesRoot, "echo-service", { depend_on: ["@node", "@traefik"] });
    await writeExecutableFixtureService(servicesRoot, "@serviceadmin", { depend_on: ["@node"] });

    const result = await bootstrapBaselineServices({ servicesRoot, workspaceRoot, version: "setup-bootstrap-test" });
    const localcertResult = result.services.find((service) => service.serviceId === "@localcert");

    assert.ok(localcertResult);
    assert.deepEqual(
      localcertResult.actions.map((action) => `${action.action}:${action.status}`),
      ["install:completed", "config:completed", "setup:completed", "start:skipped"],
    );
    assert.equal(getLifecycleState("@localcert").setup.steps.generate.status, "succeeded");
    assert.equal(getLifecycleState("@localcert").running, false);

    const rerun = await bootstrapBaselineServices({ servicesRoot, workspaceRoot, version: "setup-bootstrap-test" });
    const rerunLocalcert = rerun.services.find((service) => service.serviceId === "@localcert");
    assert.ok(rerunLocalcert);
    assert.ok(rerunLocalcert.actions.some((action) => action.action === "setup" && action.status === "skipped"));
  } finally {
    await resetSetupTestState();
    await rm(tempRoot, { recursive: true, force: true });
  }
});
