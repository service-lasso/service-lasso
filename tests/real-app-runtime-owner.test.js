import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import {
  discoverOwningRuntime,
  observeBoundedJsonObject,
  RuntimeOwnerFailure,
  waitForBaselineCompletion,
} from "../scripts/runtime-owner.mjs";

const fixtureSource = String.raw`
  import { mkdir, writeFile } from "node:fs/promises";
  import http from "node:http";
  import path from "node:path";
  const workspaceRoot = process.env.FIXTURE_WORKSPACE_ROOT;
  const servicesRoot = process.env.FIXTURE_SERVICES_ROOT;
  const mode = process.env.FIXTURE_MODE;
  const server = http.createServer((request, response) => {
    response.setHeader("content-type", "application/json");
    if (request.url === "/api/health") {
      response.end(JSON.stringify({ status: "ok", api: { status: "up" } }));
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ error: "not_found" }));
  });
  server.listen(0, "127.0.0.1", async () => {
    const port = server.address().port;
    const stateRoot = path.join(workspaceRoot, ".service-lasso");
    await mkdir(stateRoot, { recursive: true });
    await writeFile(path.join(stateRoot, "runtime-instance.json"), JSON.stringify({
      instanceId: "fixture-instance",
      generationId: "fixture-generation",
      servicesRoot,
      workspaceRoot,
      pid: process.pid,
      apiPort: port,
      apiUrl: "http://127.0.0.1:" + port,
      phase: "running",
      status: "active"
    }));
    process.send({ type: "ready", port });
    if (mode === "delayed-bootstrap") {
      setTimeout(() => console.log(JSON.stringify({
        schema: "service-lasso.baseline-start.v1",
        status: "completed",
        instanceId: "fixture-instance",
        generationId: "fixture-generation",
        ownerPid: process.pid,
        apiUrl: "http://127.0.0.1:" + port,
        servicesRoot,
        workspaceRoot,
        requestedServiceIds: ["fixture-service"],
        serviceOrder: ["fixture-service"],
        services: [{ serviceId: "fixture-service", status: "completed" }]
      })), 300);
    }
    if (mode === "exit") {
      process.on("message", (message) => {
        if (message === "exit") process.exit(23);
      });
    }
  });
  process.on("SIGTERM", () => server.close(() => process.exit(0)));
`;

function ownerFor(child) {
  let exit = null;
  const closed = new Promise((resolve) => {
    child.once("close", (code, signal) => {
      exit = { code, signal };
      resolve(exit);
    });
  });
  return { pid: child.pid, closed, get exit() { return exit; } };
}

function waitForReady(child) {
  return new Promise((resolve, reject) => {
    child.once("message", resolve);
    child.once("error", reject);
  });
}

async function hasListener(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });
}

test("real-app owner discovery follows the subprocess runtime instance when its API port is renegotiated", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "service-lasso-owner-port-"));
  const workspaceRoot = path.join(tempRoot, "workspace");
  const servicesRoot = path.join(tempRoot, "services");
  await Promise.all([mkdir(workspaceRoot, { recursive: true }), mkdir(servicesRoot, { recursive: true })]);
  const child = spawn(process.execPath, ["--input-type=module", "-e", fixtureSource], {
    env: { ...process.env, FIXTURE_WORKSPACE_ROOT: workspaceRoot, FIXTURE_SERVICES_ROOT: servicesRoot, FIXTURE_MODE: "serve" },
    stdio: ["ignore", "ignore", "ignore", "ipc"],
    windowsHide: true,
  });
  const owner = ownerFor(child);
  let runtimePort = null;

  try {
    const ready = await waitForReady(child);
    runtimePort = ready.port;
    const runtime = await discoverOwningRuntime({ owner, servicesRoot, workspaceRoot, publishTimeoutMs: 2_000, healthTimeoutMs: 2_000 });
    assert.equal(runtime.ownerPid, child.pid);
    assert.equal(runtime.apiUrl, `http://127.0.0.1:${ready.port}`);
    assert.notEqual(ready.port, 17880, "fixture must prove discovery does not reuse the requested smoke port");
    assert.equal(runtime.generationId, "fixture-generation");
  } finally {
    child.kill("SIGTERM");
    await owner.closed;
    assert.equal(await hasListener(runtimePort), false, "owned subprocess listener must be released after termination");
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("real-app owner discovery reports a prompt typed redacted subprocess exit", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "service-lasso-owner-exit-"));
  const workspaceRoot = path.join(tempRoot, "workspace-sensitive-sentinel");
  const servicesRoot = path.join(tempRoot, "services-sensitive-sentinel");
  await Promise.all([mkdir(workspaceRoot, { recursive: true }), mkdir(servicesRoot, { recursive: true })]);
  const child = spawn(process.execPath, ["--input-type=module", "-e", fixtureSource], {
    env: { ...process.env, FIXTURE_WORKSPACE_ROOT: workspaceRoot, FIXTURE_SERVICES_ROOT: servicesRoot, FIXTURE_MODE: "exit" },
    stdio: ["ignore", "ignore", "ignore", "ipc"],
    windowsHide: true,
  });
  const owner = ownerFor(child);

  try {
    await waitForReady(child);
    const startedAt = Date.now();
    const discovery = discoverOwningRuntime({ owner, servicesRoot, workspaceRoot, publishTimeoutMs: 5_000, healthTimeoutMs: 5_000 });
    child.send("exit");
    await assert.rejects(discovery, (error) => {
      assert.ok(error instanceof RuntimeOwnerFailure);
      assert.equal(error.code, "owning_runtime_exited");
      assert.equal(error.diagnostic.causeClass, "nonzero_exit");
      assert.equal(error.diagnostic.owner.exitCode, 23);
      const serialized = JSON.stringify(error.diagnostic);
      assert.doesNotMatch(serialized, /sensitive-sentinel/i);
      assert.doesNotMatch(serialized, /workspaceRoot|servicesRoot|apiUrl/i);
      return true;
    });
    assert.ok(Date.now() - startedAt < 2_000, "owner exit must not wait for the API health timeout");
  } finally {
    if (!owner.exit) child.kill("SIGKILL");
    await owner.closed;
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("real-app verification waits for owner-bound baseline completion after API health", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "service-lasso-delayed-bootstrap-"));
  const workspaceRoot = path.join(tempRoot, "workspace");
  const servicesRoot = path.join(tempRoot, "services");
  await Promise.all([mkdir(workspaceRoot, { recursive: true }), mkdir(servicesRoot, { recursive: true })]);
  const child = spawn(process.execPath, ["--input-type=module", "-e", fixtureSource], {
    env: { ...process.env, FIXTURE_WORKSPACE_ROOT: workspaceRoot, FIXTURE_SERVICES_ROOT: servicesRoot, FIXTURE_MODE: "delayed-bootstrap" },
    stdio: ["ignore", "pipe", "ignore", "ipc"],
    windowsHide: true,
  });
  const owner = ownerFor(child);
  const output = observeBoundedJsonObject(child.stdout);
  let runtimePort = null;

  try {
    const ready = await waitForReady(child);
    runtimePort = ready.port;
    const runtime = await discoverOwningRuntime({ owner, servicesRoot, workspaceRoot, publishTimeoutMs: 2_000, healthTimeoutMs: 2_000 });
    assert.equal(output.bytes, 0, "API health must become available before the delayed bootstrap result");
    const startedAt = Date.now();
    const completion = await waitForBaselineCompletion({
      owner,
      runtime,
      output,
      servicesRoot,
      workspaceRoot,
      timeoutMs: 2_000,
    });
    assert.equal(completion.status, "completed");
    assert.equal(completion.ownerPid, child.pid);
    assert.ok(Date.now() - startedAt >= 150, "verification must not treat API health as baseline completion");
  } finally {
    child.kill("SIGTERM");
    await owner.closed;
    assert.equal(await hasListener(runtimePort), false);
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("real-app owner discovery classifies resource-exhaustion exits without raw process output", async () => {
  const owner = {
    pid: 4242,
    exit: { code: 137, signal: null },
    closed: Promise.resolve({ code: 137, signal: null }),
  };

  await assert.rejects(
    discoverOwningRuntime({
      owner,
      servicesRoot: path.join(os.tmpdir(), "secret-services"),
      workspaceRoot: path.join(os.tmpdir(), "secret-workspace"),
      publishTimeoutMs: 100,
      healthTimeoutMs: 100,
    }),
    (error) => {
      assert.ok(error instanceof RuntimeOwnerFailure);
      assert.equal(error.code, "owning_runtime_exited");
      assert.equal(error.diagnostic.causeClass, "resource_exhaustion");
      assert.deepEqual(Object.keys(error.diagnostic.owner).sort(), ["exitCode", "pid", "signal"]);
      return true;
    },
  );
});

test("baseline completion contract mismatch emits metadata-only diagnostics", async () => {
  const servicesRoot = path.join(os.tmpdir(), "services-contract-secret");
  const workspaceRoot = path.join(os.tmpdir(), "workspace-contract-secret");
  const owner = { pid: 4343, exit: null, closed: new Promise(() => {}) };
  const runtime = {
    apiUrl: "http://127.0.0.1:18123",
    instanceId: "fixture-instance",
    generationId: "fixture-generation",
    record: {
      instanceId: "fixture-instance",
      generationId: "fixture-generation",
      pid: owner.pid,
      apiPort: 18123,
      phase: "running",
      status: "active",
      servicesRoot,
      workspaceRoot,
    },
  };

  await assert.rejects(
    waitForBaselineCompletion({
      owner,
      runtime,
      output: { value: Promise.resolve({ schema: "wrong-contract", secret: "value-sentinel" }), bytes: 55 },
      servicesRoot,
      workspaceRoot,
      timeoutMs: 100,
    }),
    (error) => {
      assert.ok(error instanceof RuntimeOwnerFailure);
      assert.equal(error.code, "baseline_output_invalid");
      assert.equal(error.diagnostic.causeClass, "contract_mismatch");
      const serialized = JSON.stringify(error.diagnostic);
      assert.doesNotMatch(serialized, /contract-secret|value-sentinel|servicesRoot|workspaceRoot|apiUrl/i);
      return true;
    },
  );
});

test("ended incomplete baseline output fails promptly instead of waiting for completion timeout", async () => {
  const servicesRoot = path.join(os.tmpdir(), "ended-services");
  const workspaceRoot = path.join(os.tmpdir(), "ended-workspace");
  const owner = { pid: 4444, exit: null, closed: new Promise(() => {}) };
  const runtime = {
    apiUrl: "http://127.0.0.1:18124",
    instanceId: "fixture-instance",
    generationId: "fixture-generation",
    record: {
      instanceId: "fixture-instance",
      generationId: "fixture-generation",
      pid: owner.pid,
      apiPort: 18124,
      phase: "running",
      status: "active",
    },
  };
  const stdout = new PassThrough();
  const output = observeBoundedJsonObject(stdout);
  stdout.end('{"schema":"service-lasso.baseline-start.v1"');
  const startedAt = Date.now();

  await assert.rejects(
    waitForBaselineCompletion({ owner, runtime, output, servicesRoot, workspaceRoot, timeoutMs: 10_000 }),
    (error) => {
      assert.ok(error instanceof RuntimeOwnerFailure);
      assert.equal(error.code, "baseline_output_invalid");
      assert.equal(error.diagnostic.causeClass, "output_stream_ended");
      assert.ok(error.diagnostic.outputBytes > 0);
      return true;
    },
  );
  assert.ok(Date.now() - startedAt < 1_000, "incomplete closed stdout must fail promptly");
});
