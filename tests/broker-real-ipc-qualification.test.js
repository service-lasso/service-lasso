import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { lstat, mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { discoverServices } from "../dist/runtime/discovery/discoverServices.js";
import { BROKER_IDENTITY_LEASE_ENV, issueScopedBrokerIdentity } from "../dist/runtime/broker/identity.js";
import {
  bootstrapSecretsBrokerVault,
  loadSecretsBrokerRuntimeContext,
  readSecretsBrokerRuntimeCredentials,
} from "../dist/runtime/broker/runtime.js";
import { getLifecycleState, resetLifecycleState, setLifecycleState } from "../dist/runtime/lifecycle/store.js";
import { createServiceRegistry } from "../dist/runtime/manager/DependencyGraph.js";
import { writeManifest } from "./test-helpers.js";

const requireBrokerBinary = process.env.SERVICE_LASSO_REQUIRE_TEST_BROKER_BINARY === "1";
const brokerBinary = process.env.SERVICE_LASSO_TEST_BROKER_BINARY;

function markPrepared(serviceId, binary) {
  const state = getLifecycleState(serviceId);
  setLifecycleState(serviceId, {
    ...state,
    installed: true,
    configured: true,
    installArtifacts: {
      ...state.installArtifacts,
      artifact: {
        sourceType: "release-qualification",
        repo: "service-lasso/lasso-secretsbroker",
        channel: null,
        tag: "2026.8.18-2ee1ba5",
        assetName: path.basename(binary),
        assetUrl: null,
        archiveType: null,
        archivePath: null,
        extractedPath: path.dirname(binary),
        command: binary,
        args: ["serve"],
        checksum: null,
      },
    },
  });
}

async function waitForBrokerReady(context, child, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    assert.equal(child.exitCode, null, "Real Secrets Broker exited before IPC readiness.");
    if ((await context.probe()).ready) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Real Secrets Broker IPC did not become ready inside the qualification window.");
}

async function stopBroker(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, "exit");
  child.kill();
  const stopped = await Promise.race([
    exited.then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), 10_000)),
  ]);
  if (!stopped && child.exitCode === null && child.signalCode === null) {
    child.kill("SIGKILL");
    await exited;
  }
}

test(
  "pinned real Broker serves management, KV, and resolve over authenticated OS IPC",
  { skip: !requireBrokerBinary },
  async () => {
    assert.ok(
      brokerBinary,
      "SERVICE_LASSO_TEST_BROKER_BINARY is required for the release-gated real Broker IPC qualification.",
    );
    const binary = path.resolve(brokerBinary);
    assert.equal((await lstat(binary)).isFile(), true);
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "service-lasso-real-broker-ipc-"));
    const servicesRoot = path.join(tempRoot, "services");
    const workspaceRoot = path.join(tempRoot, "workspace");
    let brokerProcess;
    let runtimeCredentials = null;
    let qualificationPhase = "fixture setup";

    try {
      await mkdir(servicesRoot, { recursive: true });
      await mkdir(workspaceRoot, { recursive: true });
      await writeManifest(servicesRoot, "@secretsbroker", {
        id: "@secretsbroker",
        name: "Secrets Broker",
        description: "Real IPC release qualification fixture.",
        executable: binary,
        args: ["serve"],
        env: { SECRETSBROKER_MODE: "production", SECRETSBROKER_TRANSPORT: "auto" },
        healthcheck: { type: "process" },
      });
      await writeManifest(servicesRoot, "sample-service", {
        id: "sample-service",
        name: "Sample Service",
        description: "Real IPC resolve fixture.",
        executable: process.execPath,
        args: ["--version"],
        env: { SAMPLE_REQUIRED_TOKEN: "${sample.API_TOKEN}" },
        healthcheck: { type: "process" },
        broker: {
          imports: [{
            namespace: "services/sample-service",
            ref: "sample.API_TOKEN",
            as: "SAMPLE_REQUIRED_TOKEN",
            required: true,
          }],
          accessPolicy: {
            serviceId: "sample-service",
            workspace: "local",
            grants: [{
              namespace: "services/sample-service",
              scope: "service",
              refs: ["sample.API_TOKEN"],
              operations: ["resolve"],
              purpose: "real IPC qualification",
            }],
          },
        },
      });

      resetLifecycleState();
      const registry = createServiceRegistry(await discoverServices(servicesRoot));
      const broker = registry.getById("@secretsbroker");
      const sample = registry.getById("sample-service");
      assert.ok(broker && sample);
      markPrepared("@secretsbroker", binary);

      qualificationPhase = "vault bootstrap";
      const bootstrap = await bootstrapSecretsBrokerVault(workspaceRoot, registry);
      assert.equal(
        bootstrap.transportKind,
        process.platform === "win32" ? "windows-named-pipe" : "unix-socket",
      );
      const context = await loadSecretsBrokerRuntimeContext(workspaceRoot, registry);
      assert.ok(context);
      runtimeCredentials = await readSecretsBrokerRuntimeCredentials(workspaceRoot);
      assert.ok(runtimeCredentials);

      qualificationPhase = "Broker subprocess start and readiness";
      brokerProcess = spawn(binary, ["serve"], {
        cwd: path.dirname(binary),
        env: { ...process.env, ...context.serverEnv },
        windowsHide: true,
        stdio: "ignore",
      });
      await waitForBrokerReady(context, brokerProcess);

      qualificationPhase = "management request";
      const management = await context.management({
        method: "GET",
        path: "/v1/management/lifecycle/status",
      });
      assert.equal(management.statusCode, 200);
      assert.equal(management.body.outcome, "ready");

      const probeRef = "services/sample-service/runtime/IPC_PROBE";
      const createPlan = await context.management({
        method: "POST",
        path: "/v1/management/secrets/create/dry-run",
        body: {
          requestId: "real-ipc-create-plan",
          serviceId: "@serviceadmin",
          ref: probeRef,
          operationId: "real-ipc-create",
          generationMode: "broker_generated",
          reason: "real IPC qualification",
        },
      });
      assert.equal(createPlan.statusCode, 200);
      assert.equal(createPlan.body.outcome, "dry_run_ready");
      const created = await context.management({
        method: "POST",
        path: "/v1/management/secrets/create/apply",
        body: {
          requestId: "real-ipc-create-apply",
          serviceId: "@serviceadmin",
          ref: probeRef,
          operationId: "real-ipc-create",
          generationMode: "broker_generated",
          reason: "real IPC qualification",
          confirm: true,
          plan: createPlan.body.plan,
        },
      });
      assert.equal(created.statusCode, 200);
      assert.equal(created.body.outcome, "applied");
      assert.equal(JSON.stringify(created.body).includes("value"), false);

      qualificationPhase = "KV metadata request";
      const kv = await context.operatorRequest({
        method: "GET",
        pathWithQuery: "/v1/kv/metadata/?list=true",
        headers: {},
      });
      assert.equal(kv.status, 200);
      assert.equal(kv.headers["content-type"]?.includes("application/json"), true);
      const kvBody = JSON.parse(kv.body.toString("utf8"));
      assert.equal(typeof kvBody, "object");

      qualificationPhase = "launch-lease issue";
      const identity = await issueScopedBrokerIdentity(sample, {
        launchLeaseIssuer: context.launchLeaseIssuer,
        transportBinding: context.transportBinding,
      });
      const identityLease = JSON.parse(identity.env[BROKER_IDENTITY_LEASE_ENV]);
      qualificationPhase = "launch resolve request";
      assert.deepEqual(
        await context.lookup({ service: sample, refs: ["sample.API_TOKEN"], identityLease }),
        [{ ref: "sample.API_TOKEN", status: "missing" }],
      );

      const publicEvidence = JSON.stringify({
        management: management.body,
        createPlan: createPlan.body,
        created: created.body,
        kv: kvBody,
      });
      assert.equal(publicEvidence.includes(runtimeCredentials.apiToken), false);
      assert.equal(publicEvidence.includes(runtimeCredentials.transport.socketPath), false);
    } catch (error) {
      const brokerExited = brokerProcess
        ? brokerProcess.exitCode !== null || brokerProcess.signalCode !== null
        : false;
      const causeName = error instanceof Error ? error.name : "unknown";
      const causeCode = error && typeof error === "object" && "code" in error &&
        typeof error.code === "string" && /^[a-z0-9_]+$/u.test(error.code)
        ? error.code
        : "none";
      throw new Error(
        `Real Broker IPC qualification failed during ${qualificationPhase}; brokerExited=${brokerExited}; cause=${causeName}/${causeCode}.`,
        { cause: error },
      );
    } finally {
      await stopBroker(brokerProcess);
      resetLifecycleState();
      if (runtimeCredentials?.transport.kind === "unix-socket") {
        await rm(runtimeCredentials.transport.socketPath, { force: true });
      }
      await rm(tempRoot, { recursive: true, force: true });
    }
  },
);
