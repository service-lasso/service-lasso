import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { buildCliBinary } from "./build-cli-binary.mjs";

const execFile = promisify(execFileCallback);
const sentinel = "SERVICE_LASSO_CREDENTIAL_SENTINEL_DO_NOT_ECHO";
const runtimeDirectory = path.dirname(process.execPath).toLowerCase();
const safePath = (process.env.PATH ?? "").split(path.delimiter).filter((entry) => entry && path.resolve(entry).toLowerCase() !== runtimeDirectory).join(path.delimiter);
async function run(binaryPath, args, cwd) {
  try { return await execFile(binaryPath, args, { cwd, env: { ...process.env, PATH: safePath, SERVICE_LASSO_TEST_CREDENTIAL: sentinel }, windowsHide: true }); }
  catch (error) { return { stdout: error.stdout, stderr: error.stderr, code: error.code, message: error.message, failed: true }; }
}
const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "service-lasso-cli-binary-"));
try {
  const { binaryPath, provenancePath, provenance } = await buildCliBinary();
  assert.equal(provenance.schema, "service-lasso.cli-binary-provenance.v1");
  assert.equal(provenance.tools.node, "22.23.2");
  assert.ok(provenance.binary.bytes > 0);
  assert.deepEqual(JSON.parse(await readFile(provenancePath, "utf8")), provenance);
  const help = await run(binaryPath, ["--help"], temporaryRoot);
  assert.equal(help.failed, undefined, `${help.code ?? ""} ${help.message ?? ""} ${help.stderr ?? ""}`); assert.match(help.stdout, /Service Lasso CLI/);
  const version = await run(binaryPath, ["--version"], temporaryRoot);
  assert.equal(version.failed, undefined); assert.match(version.stdout, /\S/);
  const readContract = await run(binaryPath, ["readiness", "gate", "--json", "--services-root", temporaryRoot, "--workspace-root", temporaryRoot], temporaryRoot);
  assert.equal(readContract.failed, true); assert.doesNotThrow(() => JSON.parse(readContract.stdout));
  const invalid = await run(binaryPath, ["updates", "invalid-action"], temporaryRoot);
  assert.equal(invalid.failed, true); assert.notEqual(invalid.code, 0);
  for (const result of [help, version, readContract, invalid]) assert.doesNotMatch(`${result.stdout ?? ""}${result.stderr ?? ""}`, new RegExp(sentinel));
  console.log(JSON.stringify({ schema: "service-lasso.cli-binary-verification.v1", target: provenance.target, binarySha256: provenance.binary.sha256, scenarios: ["help", "version", "read-contract", "invalid-input", "no-node-path", "no-credential-leak"] }));
} finally { await rm(temporaryRoot, { recursive: true, force: true }); }
