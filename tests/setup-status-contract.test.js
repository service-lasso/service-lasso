import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  readRuntimeSetupStatus,
  toPublicRuntimeSetupStatus,
} from "../dist/runtime/setup/first-run.js";
import { writePrivateJson } from "../dist/runtime/security/private-json.js";

test("public first-run setup projection omits internal vault and credential evidence", () => {
  const status = {
    contractVersion: "service-lasso.setup-status.v1",
    state: "setup_required",
    setupMode: true,
    vault: {
      required: true,
      ready: false,
      path: "C:\\sensitive-workspace\\.service-lasso\\secretsbroker\\store.json",
    },
    operator: {
      osUsername: "operator",
      identitySource: "vault",
    },
    trustBoundary: {
      bindHost: "127.0.0.1",
      localOnly: true,
      localhostBootstrapAllowed: true,
      remoteBootstrapAllowed: false,
      setupTokenConfigured: false,
      blockers: [],
    },
  };

  const publicStatus = toPublicRuntimeSetupStatus(status);
  const serialized = JSON.stringify(publicStatus);

  assert.deepEqual(publicStatus.vault, { required: true, ready: false });
  assert.equal(Object.hasOwn(publicStatus.vault, "path"), false);
  assert.doesNotMatch(
    serialized,
    /sensitive-workspace|store\.json|master-key|signing-key|credentialMaterial|tokenValue/i,
  );
});

test("an initialized vault with a missing OS wrapper remains outside first-run mode", async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "service-lasso-locked-setup-"));
  const privateRoot = path.join(workspaceRoot, ".service-lasso");
  const brokerRoot = path.join(privateRoot, "secretsbroker");
  const storePath = path.join(brokerRoot, "store.json");
  const workspaceId = `slw_${createHash("sha256").update(path.resolve(workspaceRoot).toLowerCase()).digest("hex").slice(0, 24)}`;
  const transport = process.platform === "win32"
    ? { kind: "windows-named-pipe", socketPath: `\\\\.\\pipe\\service-lasso-secretsbroker-${workspaceId}` }
    : { kind: "unix-socket", socketPath: path.join(os.tmpdir(), `service-lasso-secretsbroker-${workspaceId}.sock`) };
  try {
    await mkdir(brokerRoot, { recursive: true });
    await writeFile(storePath, "{}\n", { mode: 0o600 });
    await writePrivateJson(privateRoot, path.join(brokerRoot, "runtime-credentials.json"), {
      version: 1,
      workspaceId,
      createdAt: new Date().toISOString(),
      apiToken: "a".repeat(43),
      launchSigningKey: "b".repeat(43),
      masterKey: "c".repeat(43),
      transport,
      transportBinding: null,
      storePath,
      auditPath: path.join(brokerRoot, "audit.jsonl"),
      eventsPath: path.join(brokerRoot, "events.jsonl"),
      wrapperPath: path.join(brokerRoot, "master-key-wrapper.json"),
    });

    const status = await readRuntimeSetupStatus({
      workspaceRoot,
      bindHost: "127.0.0.1",
    });
    assert.equal(status.state, "not_required");
    assert.equal(status.setupMode, false);
    assert.equal(status.vault.ready, true);
    assert.equal(status.trustBoundary.localhostBootstrapAllowed, false);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});
