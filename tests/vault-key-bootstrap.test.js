import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { mkdtemp, rm, writeFile } from "node:fs/promises";

import {
  buildVaultKeyBootstrapResponse,
  resolveVaultKey,
} from "../dist/runtime/setup/vault-key.js";

test("vault key resolution prefers OS-managed, file, env, then CLI sources", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "service-lasso-vault-key-"));
  const keyFile = path.join(tempRoot, "vault-key.txt");
  await writeFile(keyFile, "file-key-material\n");

  try {
    const osManaged = await resolveVaultKey({
      osManagedKey: "os-managed-key-material",
      filePath: keyFile,
      env: {
        SERVICE_LASSO_VAULT_KEY: "env-key-material",
      },
      cliValue: "cli-key-material",
    });
    assert.equal(osManaged.source.type, "os-managed");
    assert.equal(osManaged.keyMaterial, "os-managed-key-material");

    const file = await resolveVaultKey({
      filePath: keyFile,
      env: {
        SERVICE_LASSO_VAULT_KEY: "env-key-material",
      },
      cliValue: "cli-key-material",
    });
    assert.equal(file.source.type, "file");
    assert.equal(file.source.filePath, keyFile);
    assert.equal(file.keyMaterial, "file-key-material");

    const env = await resolveVaultKey({
      env: {
        SERVICE_LASSO_VAULT_KEY: "env-key-material",
      },
      cliValue: "cli-key-material",
    });
    assert.equal(env.source.type, "env");
    assert.equal(env.source.envName, "SERVICE_LASSO_VAULT_KEY");
    assert.equal(env.keyMaterial, "env-key-material");

    const cli = await resolveVaultKey({
      env: {},
      cliValue: "cli-key-material",
    });
    assert.equal(cli.source.type, "cli");
    assert.equal(cli.keyMaterial, "cli-key-material");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("vault key bootstrap responses never echo supplied key material", async () => {
  const supplied = await resolveVaultKey({
    env: {
      SERVICE_LASSO_VAULT_KEY: "externally-supplied-key-material",
    },
  });

  const response = buildVaultKeyBootstrapResponse(supplied, { revealGeneratedKey: true });
  const serialized = JSON.stringify(response);

  assert.equal(response.source.type, "env");
  assert.equal(response.source.supplied, true);
  assert.equal(response.source.reveal, "never");
  assert.equal(response.oneTimeReveal, null);
  assert.match(response.source.fingerprint.display, /^sha256:[a-f0-9]{16}$/u);
  assert.equal(serialized.includes("externally-supplied-key-material"), false);
});

test("generated vault keys require one-time reveal confirmation", async () => {
  const generated = await resolveVaultKey({
    env: {},
    generatedByteLength: 32,
  });

  const response = buildVaultKeyBootstrapResponse(generated, { revealGeneratedKey: true });

  assert.equal(generated.source.type, "generated");
  assert.equal(generated.source.supplied, false);
  assert.equal(response.source.reveal, "once");
  assert.equal(response.oneTimeReveal?.key, generated.keyMaterial);
  assert.equal(response.oneTimeReveal?.confirmationRequired, true);
  assert.ok(response.warnings.some((warning) => warning.includes("revealed once")));
});
