import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { createServer } from "node:http";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import AdmZip from "adm-zip";
import { discoverServices } from "../dist/runtime/discovery/discoverServices.js";
import { resetLifecycleState } from "../dist/runtime/lifecycle/store.js";
import { createServiceRegistry } from "../dist/runtime/manager/DependencyGraph.js";
import { rehydrateDiscoveredServices } from "../dist/runtime/state/rehydrate.js";
import { readStoredState } from "../dist/runtime/state/readState.js";
import { installServiceUpdateCandidate } from "../dist/runtime/updates/actions.js";
import { makeTempServicesRoot, writeManifest } from "./test-helpers.js";

const oldTag = "2026.4.20-old";
const latestTag = "2026.4.24-new";
const assetName = "update-fixture.zip";

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
          repo: "service-lasso/update-fixture",
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

function createArchive() {
  const zip = new AdmZip();
  zip.addFile("runtime/update-fixture.mjs", Buffer.from('console.log("updated");\n', "utf8"));
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
    if (url.pathname === "/repos/service-lasso/update-fixture/releases/latest") {
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
      response.end(createArchive());
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

function baseManifest(releaseServer, serviceId, hooks) {
  return {
    id: serviceId,
    name: serviceId,
    description: "Update hook execution fixture.",
    version: oldTag,
    artifact: {
      kind: "archive",
      source: {
        type: "github-release",
        repo: "service-lasso/update-fixture",
        tag: oldTag,
        api_base_url: releaseServer.baseUrl,
      },
      platforms: {
        default: {
          assetName,
          archiveType: "zip",
          command: "node",
          args: ["runtime/update-fixture.mjs"],
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
    hooks,
  };
}

async function prepareHookService(servicesRoot, releaseServer, serviceId, hooks) {
  const serviceRoot = await writeManifest(servicesRoot, serviceId, baseManifest(releaseServer, serviceId, hooks));
  await writeInstalledArtifact(serviceRoot);
  const discovered = await discoverServices(servicesRoot);
  await rehydrateDiscoveredServices(discovered);
  const registry = createServiceRegistry(discovered);
  const service = registry.getById(serviceId);
  assert.ok(service);
  return { registry, service, serviceRoot };
}

test("update install runs pre-upgrade and post-upgrade hooks before reporting success", async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-update-hooks-pass-");
  const releaseServer = await startReleaseServer();

  try {
    const { service, serviceRoot } = await prepareHookService(servicesRoot, releaseServer, "hook-pass", {
      preUpgrade: [
        {
          name: "pre-upgrade",
          command: process.execPath,
          args: ["-e", hookAppendScript("pre")],
          env: { HOOK_LOG: "hook.log" },
        },
      ],
      postUpgrade: [
        {
          name: "post-upgrade",
          command: process.execPath,
          args: ["-e", hookAppendScript("post")],
          env: { HOOK_LOG: "hook.log" },
        },
      ],
    });

    const result = await installServiceUpdateCandidate(service);
    const stored = await readStoredState(serviceRoot);
    const hookLog = await readFile(path.join(serviceRoot, "hook.log"), "utf8");

    assert.equal(result.update.state, "installed");
    assert.equal(stored.install.artifact.tag, latestTag);
    assert.deepEqual(hookLog.trim().split(/\r?\n/), ["pre", "post"]);
    assert.deepEqual(stored.updates.hookResults.map((entry) => entry.phase), ["preUpgrade", "postUpgrade"]);
    assert.equal(stored.updates.hookResults.every((entry) => entry.ok), true);
    assert.deepEqual(stored.recovery.events.map((entry) => entry.kind), ["hook", "hook"]);
    assert.deepEqual(stored.recovery.events.map((entry) => entry.phase), ["preUpgrade", "postUpgrade"]);
  } finally {
    await releaseServer.stop();
    resetLifecycleState();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("blocking pre-upgrade hook prevents update install and persists failure evidence", async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-update-hooks-pre-fail-");
  const releaseServer = await startReleaseServer();

  try {
    const { service, serviceRoot } = await prepareHookService(servicesRoot, releaseServer, "hook-pre-fail", {
      preUpgrade: [
        {
          name: "pre-upgrade-fail",
          command: process.execPath,
          args: ["-e", "process.exit(7)"],
        },
      ],
    });

    await assert.rejects(
      () => installServiceUpdateCandidate(service),
      /preUpgrade hook blocked update install/,
    );
    const stored = await readStoredState(serviceRoot);
    assert.equal(stored.install.artifact.tag, oldTag);
    assert.equal(stored.updates.state, "failed");
    assert.equal(stored.updates.failed.sourceStatus, "pre_upgrade_hook_failed");
    assert.equal(stored.updates.hookResults[0].phase, "preUpgrade");
    assert.equal(stored.updates.hookResults[0].blocked, true);
    assert.equal(stored.recovery.events[0].kind, "hook");
    assert.equal(stored.recovery.events[0].blocked, true);
  } finally {
    await releaseServer.stop();
    resetLifecycleState();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("blocking post-upgrade hook reports failed install and invokes rollback/on-failure hooks", async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-update-hooks-post-fail-");
  const releaseServer = await startReleaseServer();

  try {
    const { service, serviceRoot } = await prepareHookService(servicesRoot, releaseServer, "hook-post-fail", {
      postUpgrade: [
        {
          name: "post-upgrade-fail",
          command: process.execPath,
          args: ["-e", "process.exit(9)"],
        },
      ],
      rollback: [
        {
          name: "rollback",
          command: process.execPath,
          args: ["-e", hookAppendScript("rollback")],
          env: { HOOK_LOG: "hook.log" },
        },
      ],
      onFailure: [
        {
          name: "on-failure",
          command: process.execPath,
          args: ["-e", hookAppendScript("failure")],
          env: { HOOK_LOG: "hook.log" },
        },
      ],
    });

    await assert.rejects(
      () => installServiceUpdateCandidate(service),
      /postUpgrade hook blocked update install/,
    );
    const stored = await readStoredState(serviceRoot);
    const hookLog = await readFile(path.join(serviceRoot, "hook.log"), "utf8");

    assert.equal(stored.install.artifact.tag, latestTag);
    assert.equal(stored.updates.state, "failed");
    assert.equal(stored.updates.failed.sourceStatus, "post_upgrade_hook_failed");
    assert.deepEqual(stored.updates.hookResults.map((entry) => entry.phase), ["postUpgrade", "rollback", "onFailure"]);
    assert.deepEqual(hookLog.trim().split(/\r?\n/), ["rollback", "failure"]);
    assert.deepEqual(stored.recovery.events.map((entry) => entry.phase), ["postUpgrade", "rollback", "onFailure"]);
  } finally {
    await releaseServer.stop();
    resetLifecycleState();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("timed out upgrade hook is treated as a blocking hook failure", async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-update-hooks-timeout-");
  const releaseServer = await startReleaseServer();

  try {
    const { service, serviceRoot } = await prepareHookService(servicesRoot, releaseServer, "hook-timeout", {
      preUpgrade: [
        {
          name: "pre-upgrade-timeout",
          command: process.execPath,
          args: ["-e", "setTimeout(() => {}, 5000)"],
          timeoutSeconds: 1,
        },
      ],
    });

    await assert.rejects(
      () => installServiceUpdateCandidate(service),
      /preUpgrade hook blocked update install/,
    );
    const stored = await readStoredState(serviceRoot);
    assert.equal(stored.updates.state, "failed");
    assert.equal(stored.updates.failed.sourceStatus, "pre_upgrade_hook_failed");
    assert.equal(stored.updates.hookResults[0].steps[0].timedOut, true);
    assert.equal(stored.recovery.events[0].kind, "hook");
    assert.equal(stored.recovery.events[0].steps[0].timedOut, true);
  } finally {
    await releaseServer.stop();
    resetLifecycleState();
    await rm(tempRoot, { recursive: true, force: true });
  }
});
