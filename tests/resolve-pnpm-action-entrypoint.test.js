import test from "node:test";
import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const resolver = fileURLToPath(new URL("../scripts/resolve-pnpm-action-entrypoint.mjs", import.meta.url));

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "pnpm-action-entrypoint-"));
  const bin = path.join(root, "pnpm-action-pinned-entrypoint", "bin");
  const prefix = path.join(root, "admin-trusted-unlock-pnpm-10.34.5");
  const entrypoint = path.join(prefix, "node_modules", "pnpm", "bin", "pnpm.cjs");
  await mkdir(bin, { recursive: true });
  await mkdir(path.join(prefix, "node_modules"), { recursive: true });
  await cp(path.join(process.cwd(), "node_modules", "pnpm"), path.join(prefix, "node_modules", "pnpm"), { recursive: true });
  return { root, bin, prefix, entrypoint };
}

test("proves an actual isolated pnpm package manifest, regular CJS entrypoint, digest, and absolute runtime identity", async () => {
  const { root, bin, prefix, entrypoint } = await fixture();
  const environment = path.join(root, "github-env");
  const result = spawnSync(process.execPath, [resolver], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, PNPM_ACTION_BIN_DEST: bin, ADMIN_PNPM_PREFIX: prefix, RUNNER_TEMP: root, GITHUB_ENV: environment },
  });
  assert.equal(result.status, 0, result.stderr);
  const bindings = await readFile(environment, "utf8");
  const evidence = JSON.parse(await readFile(path.join(root, "pnpm-action-pinned-entrypoint", "identity.json"), "utf8"));
  assert.ok(bindings.includes(`ADMIN_PNPM_NODE=${evidence.caller.node}\n`));
  assert.ok(bindings.includes(`ADMIN_PNPM_ENTRYPOINT=${evidence.caller.entrypoint}\n`));
  assert.equal(evidence.action.ref, "ea17c68df8912ef543352723c149a84f56e3d413");
  assert.equal(evidence.caller.version, "10.34.5");
  assert.match(evidence.caller.entrypoint, /node_modules[\\/]pnpm[\\/]bin[\\/]pnpm\.cjs$/i);
  assert.match(evidence.caller.node, /node\.exe$/i);
  assert.match(evidence.caller.manifestSha256, /^[0-9a-f]{64}$/);
  assert.match(evidence.caller.entrypointSha256, /^[0-9a-f]{64}$/);
});
