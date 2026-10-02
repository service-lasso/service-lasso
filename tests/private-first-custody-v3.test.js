import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { promisify } from "node:util";
import { sha256 } from "../scripts/private-first-custody-v3-lib.mjs";

const exec = promisify(execFile);
const producer = new URL("../scripts/record-packaged-admin-first-custody.mjs", import.meta.url);
const projector = new URL("../scripts/project-packaged-admin-first-custody.mjs", import.meta.url);
async function command(file, args, cwd, env) { return exec(process.execPath, [file.pathname, ...args], { cwd, env, windowsHide: true }); }
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "service-lasso-private-v3-"));
  const workspace = path.join(root, "checkout"), runtime = path.join(root, "runtime"), privateRoot = path.join(root, "private"), evidence = path.join(root, "evidence");
  await mkdir(path.join(workspace, "native"), { recursive: true });
  await writeFile(path.join(workspace, "native", "asset.cs"), "sealed-native-source\n");
  await writeFile(path.join(workspace, "package.json"), "{\"name\":\"private-v3-fixture\"}\n");
  await exec("git", ["init"], { cwd: workspace });
  await exec("git", ["config", "user.email", "fixture@example.invalid"], { cwd: workspace });
  await exec("git", ["config", "user.name", "fixture"], { cwd: workspace });
  await exec("git", ["add", "."], { cwd: workspace }); await exec("git", ["commit", "-m", "fixture"], { cwd: workspace });
  const { stdout } = await exec("git", ["rev-parse", "HEAD"], { cwd: workspace });
  return { root, workspace, privateRoot, evidence, env: { ...process.env, QUALIFICATION_PLATFORM: process.platform === "win32" ? "win32" : process.platform === "darwin" ? "darwin" : "linux", GITHUB_RUN_ID: "42", GITHUB_RUN_ATTEMPT: "1", GITHUB_WORKSPACE: workspace, QUALIFICATION_CANDIDATE_SHA: stdout.trim(), QUALIFICATION_PRIVATE_CUSTODY_ROOT: privateRoot, QUALIFICATION_INITIAL_RECEIPT_PATH: path.join(privateRoot, "initial-receipt.json"), SERVICE_LASSO_WORKSPACE_ROOT: runtime, SERVICE_LASSO_INSTANCE_REGISTRY_PATH: path.join(root, "instance-registry.json"), SERVICE_LASSO_HOST_PORT_REGISTRY_PATH: path.join(root, "host-port-registry.json") } };
}
async function produce(f) { await mkdir(f.root, { recursive: true }); await command(producer, [], f.workspace, f.env); await mkdir(f.evidence); await command(projector, ["--input", f.env.QUALIFICATION_INITIAL_RECEIPT_PATH, "--journal", path.join(f.privateRoot, "first-custody-journal.json"), "--output", path.join(f.evidence, "initial-projection.json")], f.workspace, f.env); }
test("BR004 private v3 producer, validator and projector bind real tracked bytes without publishing private fields", async () => {
  const f = await fixture(); try { await produce(f); const publicSource = await readFile(path.join(f.evidence, "initial-projection.json"), "utf8"); const privateSource = await readFile(f.env.QUALIFICATION_INITIAL_RECEIPT_PATH, "utf8"); const pub = JSON.parse(publicSource), priv = JSON.parse(privateSource);
    assert.equal(priv.schema, "service-lasso.qualification-initial-receipt.v3"); assert.equal(priv.source.tracked.length, 2); assert.equal(pub.privateVersion, "v3"); assert.equal(pub.privateInitialReceiptSha256, sha256(privateSource)); assert.equal(publicSource.includes(f.workspace), false); assert.equal(publicSource.includes("journal-0.stdout"), false); assert.equal(publicSource.includes("pid"), false);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});
test("BR004 validator rejects workspace/native state, registry, journal, duplicate JSON and output-boundary tampering", async () => {
  for (const mutation of ["tracked", "registry", "journal", "duplicate", "output"]) { const f = await fixture(); try { await produce(f);
      if (mutation === "tracked") await writeFile(path.join(f.workspace, "native", "asset.cs"), "tampered\n");
      if (mutation === "registry") await writeFile(f.env.SERVICE_LASSO_INSTANCE_REGISTRY_PATH, "present\n");
      if (mutation === "journal") await writeFile(path.join(f.privateRoot, "first-custody-journal.json"), "{\"schema\":\"service-lasso.qualification-first-custody-journal.v3\",\"private\":true,\"commands\":[]}\n");
      if (mutation === "duplicate") await writeFile(f.env.QUALIFICATION_INITIAL_RECEIPT_PATH, "{\"schema\":\"x\",\"schema\":\"x\"}\n");
      const target = mutation === "output" ? path.join(f.evidence, "initial-projection.json") : path.join(f.evidence, mutation + ".json");
      await assert.rejects(command(projector, ["--input", f.env.QUALIFICATION_INITIAL_RECEIPT_PATH, "--journal", path.join(f.privateRoot, "first-custody-journal.json"), "--output", target], f.workspace, f.env));
    } finally { await rm(f.root, { recursive: true, force: true }); } }
});
