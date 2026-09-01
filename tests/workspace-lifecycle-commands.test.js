import test from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile } from "node:fs/promises";
import { startApiServer } from "../dist/server/index.js";
import { runWorkspaceLifecycleCommand } from "../dist/runtime/lifecycle/workspace-commands.js";
import { inspectProcess } from "../dist/runtime/process/identity.js";
import {
  classifyRegisteredProcess,
  findProcessOwnership,
  getProcessRegistryPath,
  recordProcessOwnership,
} from "../dist/runtime/process/registry.js";
import { makeTempServicesRoot } from "./test-helpers.js";

const execFileAsync = promisify(execFile);
const cliPath = path.resolve("dist", "cli.js");

/**
 * @returns {Promise<{ stdout: string, stderr: string }>}
 */
async function runCli(args, options = {}) {
  return execFileAsync(process.execPath, [cliPath, ...args], {
    windowsHide: true,
    timeout: 60_000,
    ...options,
  });
}

/**
 * Occupies a loopback TCP port until closed.
 */
async function occupyPort(port) {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  const address = server.address();
  const boundPort = typeof address === "object" && address !== null ? address.port : port;
  return {
    port: boundPort,
    close: async () => {
      await new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}

async function spawnKeepAlive(cwd) {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    cwd,
    stdio: "ignore",
    windowsHide: true,
  });
  await new Promise((resolve, reject) => {
    child.once("spawn", resolve);
    child.once("error", reject);
  });
  return child;
}

function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

test("workspace start is idempotent when the exact runtime is already healthy", async () => {
  const fixture = await makeTempServicesRoot("service-lasso-870-already-running-");
  try {
    const first = await runWorkspaceLifecycleCommand({
      action: "start",
      servicesRoot: fixture.servicesRoot,
      workspaceRoot: fixture.workspaceRoot,
      port: 0,
      portPolicy: "automatic",
    });
    assert.equal(first.ok, true);
    assert.equal(first.outcome, "started");
    assert.equal(first.health, "healthy");
    assert.ok(first.apiUrl);

    const second = await runWorkspaceLifecycleCommand({
      action: "start",
      servicesRoot: fixture.servicesRoot,
      workspaceRoot: fixture.workspaceRoot,
      port: 0,
      portPolicy: "automatic",
    });
    assert.equal(second.ok, true);
    assert.equal(second.outcome, "already_running");
    assert.equal(second.apiUrl, first.apiUrl);
    assert.equal(second.instanceId, first.instanceId);

    const cli = await runCli([
      "start",
      "--services-root",
      fixture.servicesRoot,
      "--workspace-root",
      fixture.workspaceRoot,
      "--json",
    ]);
    const cliBody = JSON.parse(cli.stdout);
    assert.equal(cliBody.schema, "service-lasso.workspace-lifecycle.v1");
    assert.equal(cliBody.outcome, "already_running");
    assert.equal(cliBody.ok, true);

    const stopped = await runWorkspaceLifecycleCommand({
      action: "stop",
      servicesRoot: fixture.servicesRoot,
      workspaceRoot: fixture.workspaceRoot,
    });
    assert.equal(stopped.ok, true);
    assert.equal(stopped.outcome, "stopped");
  } finally {
    await runWorkspaceLifecycleCommand({
      action: "stop",
      servicesRoot: fixture.servicesRoot,
      workspaceRoot: fixture.workspaceRoot,
    }).catch(() => undefined);
  }
});

test("workspace stop is idempotent when the workspace is already stopped", async () => {
  const fixture = await makeTempServicesRoot("service-lasso-870-already-stopped-");
  const first = await runWorkspaceLifecycleCommand({
    action: "stop",
    servicesRoot: fixture.servicesRoot,
    workspaceRoot: fixture.workspaceRoot,
  });
  assert.equal(first.ok, true);
  assert.equal(first.outcome, "already_stopped");
  assert.equal(first.health, "stopped");
  assert.ok(Array.isArray(first.logPaths));
  assert.ok(Array.isArray(first.blockers));

  const second = await runWorkspaceLifecycleCommand({
    action: "stop",
    servicesRoot: fixture.servicesRoot,
    workspaceRoot: fixture.workspaceRoot,
  });
  assert.equal(second.ok, true);
  assert.equal(second.outcome, "already_stopped");
});

test("CLI stop from a second process shuts down a reachable runtime API", async () => {
  const fixture = await makeTempServicesRoot("service-lasso-870-online-stop-");
  try {
    const started = await runWorkspaceLifecycleCommand({
      action: "start",
      servicesRoot: fixture.servicesRoot,
      workspaceRoot: fixture.workspaceRoot,
      port: 0,
      portPolicy: "automatic",
    });
    assert.equal(started.outcome, "started");
    const health = await fetch(`${started.apiUrl}/api/health`);
    assert.equal(health.status, 200);

    const cli = await runCli([
      "stop",
      "--services-root",
      fixture.servicesRoot,
      "--workspace-root",
      fixture.workspaceRoot,
      "--json",
    ]);
    const body = JSON.parse(cli.stdout);
    assert.equal(body.ok, true);
    assert.equal(body.outcome, "stopped");
    assert.equal(body.stopMode, "online");

    await assert.rejects(
      () => fetch(`${started.apiUrl}/api/health`, { signal: AbortSignal.timeout(1_000) }),
    );
  } finally {
    await runWorkspaceLifecycleCommand({
      action: "stop",
      servicesRoot: fixture.servicesRoot,
      workspaceRoot: fixture.workspaceRoot,
    }).catch(() => undefined);
  }
});

test("API-unreachable stop terminates only verified owned trees", async () => {
  const fixture = await makeTempServicesRoot("service-lasso-870-offline-stop-");
  const child = await spawnKeepAlive(fixture.tempRoot);
  try {
    await recordProcessOwnership(fixture.workspaceRoot, {
      ownerType: "service",
      ownerId: "offline-owned",
      serviceId: "offline-owned",
      pid: child.pid,
      ownerRoot: fixture.servicesRoot,
      lifecycleState: "running",
      source: "spawn",
    });
    const entry = await findProcessOwnership(fixture.workspaceRoot, "service", "offline-owned");
    assert.equal(await classifyRegisteredProcess(entry), "owned");

    const stopped = await runWorkspaceLifecycleCommand({
      action: "stop",
      servicesRoot: fixture.servicesRoot,
      workspaceRoot: fixture.workspaceRoot,
    });
    assert.equal(stopped.ok, true);
    assert.equal(stopped.outcome, "already_stopped");
    assert.equal(stopped.stopMode, "offline");
    assert.ok(stopped.stoppedServices.includes("offline-owned"));
    assert.equal(processIsAlive(child.pid), false);
  } finally {
    if (processIsAlive(child.pid)) {
      child.kill("SIGKILL");
    }
  }
});

test("API-unreachable stop never kills a mismatched PID", async () => {
  const fixture = await makeTempServicesRoot("service-lasso-870-pid-reuse-");
  const child = await spawnKeepAlive(fixture.tempRoot);
  try {
    await recordProcessOwnership(fixture.workspaceRoot, {
      ownerType: "service",
      ownerId: "reused-pid",
      serviceId: "reused-pid",
      pid: child.pid,
      ownerRoot: fixture.servicesRoot,
      lifecycleState: "running",
      source: "spawn",
    });
    const registryPath = getProcessRegistryPath(fixture.workspaceRoot);
    const registry = JSON.parse(await readFile(registryPath, "utf8"));
    const target = registry.entries.find((entry) => entry.ownerId === "reused-pid");
    assert.ok(target);
    target.identity = {
      ...target.identity,
      commandHash: "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
    };
    await writeFile(registryPath, `${JSON.stringify(registry, null, 2)}\n`);

    const inspection = await inspectProcess(child.pid);
    assert.equal(inspection.status, "running");

    const stopped = await runWorkspaceLifecycleCommand({
      action: "stop",
      servicesRoot: fixture.servicesRoot,
      workspaceRoot: fixture.workspaceRoot,
    });
    assert.equal(stopped.ok, true);
    assert.ok(stopped.blockers.some((blocker) => blocker.includes("identity_mismatch")));
    assert.equal(processIsAlive(child.pid), true);
  } finally {
    if (processIsAlive(child.pid)) {
      child.kill("SIGKILL");
    }
  }
});

test("workspace restart renegotiates an occupied preferred API port", { timeout: 45_000 }, async () => {
  const fixture = await makeTempServicesRoot("service-lasso-870-restart-port-");
  try {
    const started = await runWorkspaceLifecycleCommand({
      action: "start",
      servicesRoot: fixture.servicesRoot,
      workspaceRoot: fixture.workspaceRoot,
      port: 0,
      portPolicy: "automatic",
    });
    assert.equal(started.outcome, "started");
    assert.ok(started.apiPort);

    const stopped = await runWorkspaceLifecycleCommand({
      action: "stop",
      servicesRoot: fixture.servicesRoot,
      workspaceRoot: fixture.workspaceRoot,
    });
    assert.equal(stopped.ok, true);

    const blocker = await occupyPort(0);
    try {
      const restarted = await runWorkspaceLifecycleCommand({
        action: "restart",
        servicesRoot: fixture.servicesRoot,
        workspaceRoot: fixture.workspaceRoot,
        port: blocker.port,
        portPolicy: "preferred",
      });
      assert.equal(restarted.ok, true);
      assert.equal(restarted.outcome, "restarted");
      assert.notEqual(restarted.apiPort, blocker.port);
      assert.ok(restarted.apiUrl);
      const health = await fetch(`${restarted.apiUrl}/api/health`);
      assert.equal(health.status, 200);
    } finally {
      await blocker.close();
      await runWorkspaceLifecycleCommand({
        action: "stop",
        servicesRoot: fixture.servicesRoot,
        workspaceRoot: fixture.workspaceRoot,
      });
    }
  } finally {
    await runWorkspaceLifecycleCommand({
      action: "stop",
      servicesRoot: fixture.servicesRoot,
      workspaceRoot: fixture.workspaceRoot,
    }).catch(() => undefined);
  }
});

test("concurrent workspace commands serialise through one host-wide lock", async () => {
  const fixture = await makeTempServicesRoot("service-lasso-870-concurrent-");
  try {
    const started = await runWorkspaceLifecycleCommand({
      action: "start",
      servicesRoot: fixture.servicesRoot,
      workspaceRoot: fixture.workspaceRoot,
      port: 0,
      portPolicy: "automatic",
    });
    assert.equal(started.outcome, "started");

    const [first, second] = await Promise.all([
      runWorkspaceLifecycleCommand({
        action: "start",
        servicesRoot: fixture.servicesRoot,
        workspaceRoot: fixture.workspaceRoot,
      }),
      runWorkspaceLifecycleCommand({
        action: "start",
        servicesRoot: fixture.servicesRoot,
        workspaceRoot: fixture.workspaceRoot,
      }),
    ]);
    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    assert.equal(first.outcome, "already_running");
    assert.equal(second.outcome, "already_running");
    assert.equal(first.apiUrl, started.apiUrl);
    assert.equal(second.apiUrl, started.apiUrl);
  } finally {
    await runWorkspaceLifecycleCommand({
      action: "stop",
      servicesRoot: fixture.servicesRoot,
      workspaceRoot: fixture.workspaceRoot,
    });
  }
});

test("authenticated runtime shutdown requires confirmation and stops the API", async () => {
  const fixture = await makeTempServicesRoot("service-lasso-870-http-shutdown-");
  const apiServer = await startApiServer({
    port: 0,
    servicesRoot: fixture.servicesRoot,
    workspaceRoot: fixture.workspaceRoot,
  });
  try {
    const denied = await fetch(`${apiServer.url}/api/runtime/actions/shutdown`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(denied.status, 409);

    const accepted = await fetch(`${apiServer.url}/api/runtime/actions/shutdown`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ confirm: true }),
    });
    assert.equal(accepted.status, 202);

    const deadline = Date.now() + 15_000;
    let down = false;
    while (Date.now() < deadline) {
      try {
        await fetch(`${apiServer.url}/api/health`, { signal: AbortSignal.timeout(500) });
      } catch {
        down = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.equal(down, true);
  } finally {
    await apiServer.stop().catch(() => undefined);
  }
});
