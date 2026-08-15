import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  bootstrapSecretsBrokerVault,
  loadSecretsBrokerRuntimeContext,
  readSecretsBrokerRuntimeCredentials,
  secretsBrokerCredentialsPath,
  secretsBrokerUnixSocketPath,
} from "../dist/runtime/broker/runtime.js";

test("broker Unix socket paths remain below the macOS sockaddr limit", () => {
  const workspaceId = `slw_${"a".repeat(24)}`;
  const ordinary = secretsBrokerUnixSocketPath(workspaceId, "/tmp");
  assert.equal(path.basename(ordinary), `service-lasso-secretsbroker-${workspaceId}.sock`);

  const bounded = secretsBrokerUnixSocketPath(workspaceId, `/var/folders/${"long-segment/".repeat(8)}T`);
  assert.equal(bounded, `/tmp/service-lasso-sb-${workspaceId}.sock`);
  assert.equal(Buffer.byteLength(bounded, "utf8") <= 100, true);
});

test("broker bootstrap creates protected credentials and invokes only metadata-safe command arguments", async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "service-lasso-broker-runtime-"));
  const fakeCommand = path.join(workspaceRoot, "broker-fixture.exe");
  const calls = [];
  try {
    await writeFile(fakeCommand, "fixture");
    const runCommand = async (command, cwd, args, environment) => {
      calls.push({ command, cwd, args: [...args], environment: { ...environment } });
      if (args[0] === "key" && args[1] === "initialize") {
        await writeFile(environment.SECRETSBROKER_STORE_PATH, "encrypted-store-fixture");
        return JSON.stringify({ outcome: "ready", state: "ready", keyId: "key_fixture", keyVersion: "v1" });
      }
      if (args[0] === "key" && args[1] === "import") {
        await writeFile(environment.SECRETSBROKER_WRAPPER_PATH, "protected-wrapper-fixture");
        return JSON.stringify({ outcome: "ready", state: "ready", keyId: "key_fixture", keyVersion: "v1" });
      }
      if (args[0] === "key" && (args[1] === "status" || args[1] === "wrapper-status")) {
        return process.platform === "win32"
          ? JSON.stringify({ outcome: "ready", state: "ready", ready: true, wrapper: { keyId: "key_fixture", keyVersion: "v1" } })
          : JSON.stringify({ available: true, state: "ready", keyId: "key_fixture", keyVersion: "v1", source: "flag/env" });
      }
      throw new Error("unexpected command");
    };
    const registry = { getById: () => ({ manifest: { id: "@secretsbroker" } }) };
    const result = await bootstrapSecretsBrokerVault(workspaceRoot, registry, {
      brokerCommand: { command: fakeCommand, cwd: workspaceRoot },
      runCommand,
    });
    assert.equal(result.ok, true);
    assert.equal(result.keyId, "key_fixture");
    assert.equal(result.keyVersion, "v1");

    const credentials = await readSecretsBrokerRuntimeCredentials(workspaceRoot);
    assert.ok(credentials);
    assert.equal(credentials.apiToken.length >= 32, true);
    assert.equal(credentials.launchSigningKey.length >= 32, true);
    assert.equal(credentials.masterKey.length >= 32, true);
    const serializedArgs = JSON.stringify(calls.map((entry) => entry.args));
    assert.equal(serializedArgs.includes(credentials.apiToken), false);
    assert.equal(serializedArgs.includes(credentials.launchSigningKey), false);
    assert.equal(serializedArgs.includes(credentials.masterKey), false);
    assert.equal(calls.every((entry) => entry.environment.SECRETSBROKER_AUDIT_HASH_CHAIN === "1"), true);
    assert.equal(
      calls.at(-1).args.join(" "),
      process.platform === "win32" ? `key wrapper-status --wrapper ${credentials.wrapperPath}` : "key status",
    );

    const storedCredentials = await readFile(secretsBrokerCredentialsPath(workspaceRoot), "utf8");
    if (process.platform === "win32") {
      assert.equal(storedCredentials.includes(credentials.apiToken), false);
      assert.equal(storedCredentials.includes(credentials.launchSigningKey), false);
      assert.equal(storedCredentials.includes(credentials.masterKey), false);
    }

    const second = await bootstrapSecretsBrokerVault(workspaceRoot, registry, {
      brokerCommand: { command: fakeCommand, cwd: workspaceRoot },
      runCommand,
    });
    assert.equal(second.keyId, "key_fixture");
    assert.equal(calls.filter((entry) => entry.args[1] === "initialize").length, 1);

    const runtimeContext = await loadSecretsBrokerRuntimeContext(workspaceRoot, registry);
    assert.ok(runtimeContext);
    assert.equal(runtimeContext.launchLeaseIssuer, undefined);
    assert.equal(typeof runtimeContext.serverEnv.SECRETSBROKER_API_TOKEN, "string");
    await assert.rejects(
      bootstrapSecretsBrokerVault(workspaceRoot, registry),
      /Secrets Broker must be installed before vault bootstrap\./,
    );
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});
