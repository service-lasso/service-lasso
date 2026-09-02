import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { createServer } from "node:http";
import { promisify } from "node:util";
import { execFile as execFileCallback } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import AdmZip from "adm-zip";
import { startApiServer } from "../dist/server/index.js";
import { resetLifecycleState } from "../dist/runtime/lifecycle/store.js";
import { readStoredState } from "../dist/runtime/state/readState.js";
import { ensureTestSecretsBrokerReady, makeTempServicesRoot, writeExecutableFixtureService, writeManifest } from "./test-helpers.js";

const execFile = promisify(execFileCallback);
const oldTag = "2026.4.20-old";
const latestTag = "2026.4.24-new";
const assetName = "echo-hook.zip";

async function waitFor(readinessCheck, timeoutMs = 10_000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const result = await readinessCheck();
    if (result) {
      return result;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  throw new Error("Timed out waiting for recovery E2E readiness.");
}

async function runCli(args, cwd = path.resolve(".")) {
  const cliPath = path.join(cwd, "dist", "cli.js");
  const result = await execFile(process.execPath, [cliPath, ...args], {
    cwd,
    env: {
      ...process.env,
      npm_package_version: "0.1.0-test",
    },
  });

  return result.stdout.trim();
}

async function getJson(url) {
  const response = await fetch(url);
  return {
    status: response.status,
    body: await response.json(),
  };
}

async function postJson(url, body = {}) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  return {
    status: response.status,
    body: await response.json(),
  };
}

async function writeInstalledArtifact(serviceRoot) {
  const stateRoot = path.join(serviceRoot, ".state");
  await mkdir(stateRoot, { recursive: true });
  await writeFile(
    path.join(stateRoot, "install.json"),
    JSON.stringify(
      {
        installed: true,
        artifact: {
          sourceType: "github-release",
          repo: "service-lasso/echo-hook-fixture",
          tag: oldTag,
          assetName,
          archivePath: `active/${oldTag}/${assetName}`,
        },
      },
      null,
      2,
    ),
  );
}

function createEchoHookArchive() {
  const zip = new AdmZip();
  zip.addFile("runtime/echo-hook.mjs", Buffer.from('console.log("echo hook updated");\n', "utf8"));
  return zip.toBuffer();
}

async function startReleaseServer() {
  const server = createServer((request, response) => {
    if (!request.url) {
      response.statusCode = 404;
      response.end();
      return;
    }

    const url = new URL(request.url, "http://127.0.0.1");
    if (url.pathname === "/repos/service-lasso/echo-hook-fixture/releases/latest") {
      const baseUrl = `http://127.0.0.1:${server.address().port}`;
      response.setHeader("content-type", "application/json; charset=utf-8");
      response.end(JSON.stringify({
        tag_name: latestTag,
        name: latestTag,
        html_url: `${baseUrl}/releases/${latestTag}`,
        published_at: "2026-04-24T00:00:00Z",
        assets: [
          {
            name: assetName,
            browser_download_url: `${baseUrl}/downloads/${assetName}`,
          },
        ],
      }));
      return;
    }

    if (url.pathname === `/downloads/${assetName}`) {
      response.statusCode = 200;
      response.end(createEchoHookArchive());
      return;
    }

    response.statusCode = 404;
    response.end();
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    stop: async () => {
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

function hookAppendScript(label) {
  return `require("node:fs").appendFileSync(process.env.HOOK_LOG, "${label}\\n")`;
}

function createEchoHookManifest(releaseServer) {
  return {
    id: "echo-hook",
    name: "Echo Hook E2E",
    description: "Echo-style service used for recovery hook E2E verification.",
    version: oldTag,
    artifact: {
      kind: "archive",
      source: {
        type: "github-release",
        repo: "service-lasso/echo-hook-fixture",
        tag: oldTag,
        api_base_url: releaseServer.baseUrl,
      },
      platforms: {
        default: {
          assetName,
          archiveType: "zip",
          command: "node",
          args: ["runtime/echo-hook.mjs"],
        },
      },
    },
    updates: {
      mode: "install",
      track: "latest",
      installWindow: {
        start: "00:00",
        end: "00:00",
        timezone: "UTC",
      },
      runningService: "skip",
    },
    hooks: {
      preUpgrade: [
        {
          name: "echo-pre-upgrade",
          command: process.execPath,
          args: ["-e", hookAppendScript("pre")],
          env: { HOOK_LOG: "hook.log" },
        },
      ],
      postUpgrade: [
        {
          name: "echo-post-upgrade",
          command: process.execPath,
          args: ["-e", hookAppendScript("post")],
          env: { HOOK_LOG: "hook.log" },
        },
      ],
    },
  };
}

test("recovery E2E keeps API, CLI, monitor health, supervised restart, doctor, and hooks in agreement", async (context) => {
  resetLifecycleState();
  const { tempRoot, servicesRoot, workspaceRoot } = await makeTempServicesRoot("service-lasso-recovery-e2e-");
  const releaseServer = await startReleaseServer();
  let apiServer = null;

  try {
    await ensureTestSecretsBrokerReady(workspaceRoot);
    const { serviceRoot: echoRecoveryRoot } = await writeExecutableFixtureService(servicesRoot, "echo-recovery", {
      exitCode: 2,
      exitFileRelativePath: "./runtime/crash.txt",
      monitoring: {
        enabled: true,
        intervalSeconds: 1,
      },
      restartPolicy: {
        enabled: true,
        onCrash: true,
        maxAttempts: 1,
        backoffSeconds: 1,
      },
      doctor: {
        enabled: true,
        failurePolicy: "block",
        steps: [
          {
            name: "echo-doctor",
            command: process.execPath,
            args: ["-e", "process.exit(0)"],
          },
        ],
      },
    });

    const echoHookRoot = await writeManifest(servicesRoot, "echo-hook", createEchoHookManifest(releaseServer));
    await writeInstalledArtifact(echoHookRoot);

    apiServer = await startApiServer({
      port: 0,
      servicesRoot,
      workspaceRoot,
      monitor: true,
      monitorIntervalMs: 50,
    });

    for (const action of ["install", "config", "start"]) {
      const response = await postJson(`${apiServer.url}/api/services/echo-recovery/${action}`);
      assert.equal(response.status, 200, `${action} failed: ${JSON.stringify(response.body)}`);
    }

    await writeFile(path.join(echoRecoveryRoot, "runtime", "crash.txt"), "crash\n", "utf8");

    let lastRecovery = null;
    let recoveryState;
    try {
      recoveryState = await waitFor(async () => {
        const response = await getJson(`${apiServer.url}/api/services/echo-recovery/recovery`);
        lastRecovery = response.body.recovery;
        const events = response.body.recovery.events;
        const hasMonitorHealth = events.some((event) => event.kind === "monitor" && event.action === "healthy");
        const hasDoctor = events.some((event) => event.kind === "doctor" && event.ok === true);
        const hasRestart = events.some((event) => event.kind === "restart" && event.ok === true);
        return hasMonitorHealth && hasDoctor && hasRestart ? response.body.recovery : null;
      }, 30_000);
    } catch (error) {
      throw new Error(`Recovery events did not converge: ${JSON.stringify(lastRecovery)}`, { cause: error });
    }
    assert.ok(recoveryState.events.some((event) => event.kind === "doctor" && event.ok));
    assert.ok(recoveryState.events.some((event) => event.kind === "restart" && event.ok));
    context.diagnostic("recovery events converged");

    const cliRecovery = JSON.parse(await runCli([
      "recovery",
      "status",
      "echo-recovery",
      "--services-root",
      servicesRoot,
      "--workspace-root",
      workspaceRoot,
      "--json",
    ]));
    assert.equal(cliRecovery.services[0].serviceId, "echo-recovery");
    assert.ok(cliRecovery.services[0].recovery.events.some((event) => event.kind === "monitor" && event.action === "healthy"));
    assert.ok(cliRecovery.services[0].recovery.events.some((event) => event.kind === "restart" && event.ok));
    context.diagnostic("CLI recovery state agreed");

    const updateInstall = await postJson(`${apiServer.url}/api/services/echo-hook/update/install`, { confirm: true });
    assert.equal(updateInstall.status, 200);
    context.diagnostic("update install completed");

    const hookState = await readStoredState(echoHookRoot);
    const hookLog = await readFile(path.join(echoHookRoot, "hook.log"), "utf8");
    assert.deepEqual(hookLog.trim().split(/\r?\n/), ["pre", "post"]);
    const persistedHookEvents = hookState.recovery.events.filter((event) => event.kind === "hook");
    assert.deepEqual(persistedHookEvents.map((event) => event.phase), ["preUpgrade", "postUpgrade"]);

    const apiHookRecovery = await getJson(`${apiServer.url}/api/services/echo-hook/recovery`);
    assert.equal(apiHookRecovery.status, 200);
    const apiHookEvents = apiHookRecovery.body.recovery.events.filter((event) => event.kind === "hook");
    assert.deepEqual(apiHookEvents.map((event) => event.kind), ["hook", "hook"]);

    const cliHookRecovery = await waitFor(async () => {
      const recovery = JSON.parse(await runCli([
        "recovery",
        "status",
        "echo-hook",
        "--services-root",
        servicesRoot,
        "--workspace-root",
        workspaceRoot,
        "--json",
      ]));
      const events = recovery.services[0].recovery.events.filter((event) => event.kind === "hook");
      return events.map((event) => event.phase).join(",") === "preUpgrade,postUpgrade" ? recovery : null;
    });
    const cliHookEvents = cliHookRecovery.services[0].recovery.events.filter((event) => event.kind === "hook");
    assert.deepEqual(cliHookEvents.map((event) => event.phase), ["preUpgrade", "postUpgrade"]);
  } finally {
    if (apiServer) {
      context.diagnostic("stopping API server");
      await apiServer.stop();
      context.diagnostic("API server stopped");
    }
    await releaseServer.stop();
    resetLifecycleState();
    await rm(tempRoot, { recursive: true, force: true });
  }
});
