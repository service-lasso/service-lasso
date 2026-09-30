import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { retainReceipt } from "../scripts/retain-packaged-admin-lifecycle-receipt.mjs";

const script = new URL("../scripts/verify-packaged-admin-lifecycle-artifacts.mjs", import.meta.url);
const runId = "431", runAttempt = "2", workflowSha = "a".repeat(40);
const receipt = { schema: "service-lasso.admin-trusted-unlock-consumer.v1", outcome: "nonzero_exit", exitCode: 1, signal: null, trustedUnlock: { classification: "missing" } };
async function fixture(mutator) {
  const root = await mkdtemp(path.join(tmpdir(), "packaged-custody-"));
  for (const platform of ["linux", "win32", "darwin"]) {
    const directory = path.join(root, `packaged-admin-lifecycle-${platform}-${runId}-${runAttempt}`);
    await mkdir(directory);
    const evidence = path.join(directory, `packaged-admin-lifecycle-${platform}.json`), retained = path.join(directory, "admin-trusted-unlock-receipt.json"), privateReceipt = path.join(await mkdtemp(path.join(tmpdir(), "packaged-private-")), "runner-private-receipt.json");
    await writeFile(evidence, JSON.stringify({ schema: "service-lasso.packaged-admin-lifecycle.v1", platform, outcome: "failure" }));
    await writeFile(privateReceipt, JSON.stringify(receipt));
    await retainReceipt({ receiptPath: privateReceipt, evidencePath: evidence, retainedPath: retained, runId, runAttempt, workflowSha, platform });
  }
  await mutator?.(root); return root;
}
function verify(root) { return spawnSync(process.execPath, [fileURLToPath(script)], { env: { ...process.env, PACKAGED_ARTIFACTS_ROOT: root, GITHUB_RUN_ID: runId, GITHUB_RUN_ATTEMPT: runAttempt, GITHUB_SHA: workflowSha }, encoding: "utf8" }); }
test("AC-4BY.2 aggregate validates executable three-platform failed-Cypress receipt custody", async () => { const result = verify(await fixture()); assert.equal(result.status, 0, result.stderr); });
for (const [label, mutate] of [
  ["missing", async (root) => writeFile(path.join(root, `packaged-admin-lifecycle-linux-${runId}-${runAttempt}`, "admin-trusted-unlock-receipt.json"), "")],
  ["private", async (root) => writeFile(path.join(root, `packaged-admin-lifecycle-linux-${runId}-${runAttempt}`, "admin-trusted-unlock-receipt.json"), JSON.stringify({ ...receipt, secret: "x" }))],
  ["malformed", async (root) => writeFile(path.join(root, `packaged-admin-lifecycle-linux-${runId}-${runAttempt}`, "admin-trusted-unlock-receipt.json"), "{")],
  ["stale", async (root) => { const file = path.join(root, `packaged-admin-lifecycle-linux-${runId}-${runAttempt}`, "packaged-admin-lifecycle-linux.json"); const value = JSON.parse(await readFile(file)); value.run.id = "430"; await writeFile(file, JSON.stringify(value)); }],
  ["attempt mismatch", async (root) => { const file = path.join(root, `packaged-admin-lifecycle-linux-${runId}-${runAttempt}`, "packaged-admin-lifecycle-linux.json"); const value = JSON.parse(await readFile(file)); value.run.attempt = "1"; await writeFile(file, JSON.stringify(value)); }],
  ["extra material", async (root) => writeFile(path.join(root, `packaged-admin-lifecycle-linux-${runId}-${runAttempt}`, "extra.json"), "{}")],
]) test(`AC-4BY.2 aggregate rejects ${label} receipt custody`, async () => { assert.notEqual(verify(await fixture(mutate)).status, 0); });
