import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { promisify } from "node:util";
import { sha256 } from "../scripts/private-first-custody-v3-lib.mjs";

const exec = promisify(execFile);
const producer = new URL("../scripts/record-packaged-admin-first-custody.mjs", import.meta.url);
const projector = new URL("../scripts/project-packaged-admin-first-custody.mjs", import.meta.url);
async function command(file, args, cwd, env) { return exec(process.execPath, [fileURLToPath(file), ...args], { cwd, env, windowsHide: true }); }
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "service-lasso-private-v3-"));
  const workspace = path.join(root, "checkout"), custody = path.join(root, "custody"), runtime = path.join(custody, "workspace"), privateRoot = path.join(custody, "private"), evidence = path.join(custody, "evidence");
  await mkdir(path.join(workspace, "native"), { recursive: true });
  await writeFile(path.join(workspace, "native", "asset.cs"), "sealed-native-source\n");
  await writeFile(path.join(workspace, "package.json"), "{\"name\":\"private-v3-fixture\"}\n");
  await exec("git", ["init"], { cwd: workspace });
  await exec("git", ["config", "user.email", "fixture@example.invalid"], { cwd: workspace });
  await exec("git", ["config", "user.name", "fixture"], { cwd: workspace });
  await exec("git", ["add", "."], { cwd: workspace }); await exec("git", ["commit", "-m", "fixture"], { cwd: workspace });
  const { stdout } = await exec("git", ["rev-parse", "HEAD"], { cwd: workspace });
  return { root, workspace, privateRoot, evidence, env: { ...process.env, QUALIFICATION_PLATFORM: process.platform === "win32" ? "win32" : process.platform === "darwin" ? "darwin" : "linux", GITHUB_RUN_ID: "42", GITHUB_RUN_ATTEMPT: "1", GITHUB_WORKSPACE: workspace, QUALIFICATION_CANDIDATE_SHA: stdout.trim(), QUALIFICATION_PRIVATE_CUSTODY_ROOT: privateRoot, QUALIFICATION_INITIAL_RECEIPT_PATH: path.join(privateRoot, "initial-receipt.json"), QUALIFICATION_EVIDENCE_ROOT: evidence, SERVICE_LASSO_WORKSPACE_ROOT: runtime, SERVICE_LASSO_INSTANCE_REGISTRY_PATH: path.join(custody, "instance-registry.json"), SERVICE_LASSO_HOST_PORT_REGISTRY_PATH: path.join(custody, "host-port-registry.json") } };
}
async function produce(f) { await command(producer, [], f.workspace, f.env); await command(projector, ["--input", f.env.QUALIFICATION_INITIAL_RECEIPT_PATH, "--journal", path.join(f.privateRoot, "first-custody-journal.json"), "--output", path.join(f.evidence, "initial-projection.json")], f.workspace, f.env); }
test("BR008 private v3 producer holds an observed native Git protocol and projects only closed identifiers", async () => {
  const f = await fixture(); try { await produce(f); const publicSource = await readFile(path.join(f.evidence, "initial-projection.json"), "utf8"); const privateSource = await readFile(f.env.QUALIFICATION_INITIAL_RECEIPT_PATH, "utf8"); const pub = JSON.parse(publicSource), priv = JSON.parse(privateSource);
    assert.equal(priv.schema, "service-lasso.qualification-initial-receipt.v3"); assert.equal(priv.source.tracked.length, 2); assert.equal(priv.runner.nativeBirthCustody, "HELD_NATIVE_V1"); assert.equal(priv.journal.commands[0].native.id, priv.journal.commands[0].native.id); assert.equal(pub.privateVersion, "v3"); assert.deepEqual(Object.keys(pub.localValidatorAttestation).sort(), ["schema", "validated"]); assert.equal(pub.privateInitialReceiptSha256, sha256(privateSource)); assert.equal(publicSource.includes(f.workspace), false); assert.equal(publicSource.includes("journal-0.stdout"), false); assert.equal(publicSource.includes("pid"), false);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});
test("BR008 validator rejects workspace/native state, registry, journal, native witness, raw output, duplicate JSON and output-boundary tampering", async () => {
  for (const mutation of ["tracked", "registry", "journal", "native", "raw", "eof", "duplicate", "output", "blob", "extra", "compiler", "parent", "lineage", "order", "tool", "caller", "birth", "pidReuse", "helper", "helperLibrary", "privacy"]) { const f = await fixture(); try { await produce(f);
      if (mutation === "tracked") await writeFile(path.join(f.workspace, "native", "asset.cs"), "tampered\n");
      if (mutation === "registry") await writeFile(f.env.SERVICE_LASSO_INSTANCE_REGISTRY_PATH, "present\n");
      if (mutation === "journal") await writeFile(path.join(f.privateRoot, "first-custody-journal.json"), "{\"schema\":\"service-lasso.qualification-first-custody-journal.v3\",\"private\":true,\"commands\":[],\"toolMetadata\":{}}\n");
      if (mutation === "native") { const journalPath = path.join(f.privateRoot, "first-custody-journal.json"), journal = JSON.parse(await readFile(journalPath, "utf8")); journal.commands[0].native.birthObserved = false; await writeFile(journalPath, JSON.stringify(journal) + "\n"); }
      if (mutation === "raw") await writeFile(path.join(f.privateRoot, "journal-0.stdout"), "forged output\n");
      if (mutation === "blob") { const receipt = JSON.parse(await readFile(f.env.QUALIFICATION_INITIAL_RECEIPT_PATH, "utf8")); receipt.source.tracked[0].gitBlob = "0".repeat(40); await writeFile(f.env.QUALIFICATION_INITIAL_RECEIPT_PATH, JSON.stringify(receipt) + "\n"); }
      if (mutation === "extra") await writeFile(path.join(f.workspace, "untracked-extra.txt"), "untracked\n");
      if (mutation === "compiler") { const journalPath = path.join(f.privateRoot, "first-custody-journal.json"), journal = JSON.parse(await readFile(journalPath, "utf8")); journal.toolMetadata.sourceStatus = "CLEAN_BY_HEAD_TREE_AND_TRACKED_BYTES"; await writeFile(journalPath, JSON.stringify(journal) + "\n"); }
      if (mutation === "parent") { const journalPath = path.join(f.privateRoot, "first-custody-journal.json"), journal = JSON.parse(await readFile(journalPath, "utf8")); journal.commands[0].native.parents[0].pid = 1; await writeFile(journalPath, JSON.stringify(journal) + "\n"); }
       if (mutation === "lineage") { const journalPath = path.join(f.privateRoot, "first-custody-journal.json"), journal = JSON.parse(await readFile(journalPath, "utf8")); journal.commands[0].native.parents[0].ppid = journal.commands[0].native.parents.at(-1).pid; await writeFile(journalPath, JSON.stringify(journal) + "\n"); }
       if (mutation === "caller") { const journalPath = path.join(f.privateRoot, "first-custody-journal.json"), journal = JSON.parse(await readFile(journalPath, "utf8")); journal.commands[0].native.sourceCaller.imageSha256 = "0".repeat(64); await writeFile(journalPath, JSON.stringify(journal) + "\n"); }
       if (mutation === "birth") { const journalPath = path.join(f.privateRoot, "first-custody-journal.json"), journal = JSON.parse(await readFile(journalPath, "utf8")); journal.commands[0].native.parents[0].birth = "0"; await writeFile(journalPath, JSON.stringify(journal) + "\n"); }
       if (mutation === "pidReuse") { const journalPath = path.join(f.privateRoot, "first-custody-journal.json"), journal = JSON.parse(await readFile(journalPath, "utf8")); journal.commands[0].native.parents[1].pid = journal.commands[0].native.parents[0].pid; await writeFile(journalPath, JSON.stringify(journal) + "\n"); }
       if (mutation === "helper") { const journalPath = path.join(f.privateRoot, "first-custody-journal.json"), journal = JSON.parse(await readFile(journalPath, "utf8")); journal.commands[0].native.helper = { platform: "win32" }; await writeFile(journalPath, JSON.stringify(journal) + "\n"); }
       if (mutation === "helperLibrary") { const journalPath = path.join(f.privateRoot, "first-custody-journal.json"), journal = JSON.parse(await readFile(journalPath, "utf8")); journal.commands[0].native.helper = { platform: "darwin", executable: "/bin/false", executableSha256: "0".repeat(64), scriptSha256: "0".repeat(64), scriptBytes: 1, libraries: [], first: {}, second: {} }; await writeFile(journalPath, JSON.stringify(journal) + "\n"); }
       if (mutation === "eof") { const journalPath = path.join(f.privateRoot, "first-custody-journal.json"), journal = JSON.parse(await readFile(journalPath, "utf8")); journal.commands[1].result.stdoutEof = false; await writeFile(journalPath, JSON.stringify(journal) + "\n"); }
       if (mutation === "tool") { const receipt = JSON.parse(await readFile(f.env.QUALIFICATION_INITIAL_RECEIPT_PATH, "utf8")); receipt.tools[0].file.sha256 = "0".repeat(64); await writeFile(f.env.QUALIFICATION_INITIAL_RECEIPT_PATH, JSON.stringify(receipt) + "\n"); }
      if (mutation === "order") { const journalPath = path.join(f.privateRoot, "first-custody-journal.json"), journal = JSON.parse(await readFile(journalPath, "utf8")); journal.commands.reverse(); await writeFile(journalPath, JSON.stringify(journal) + "\n"); }
      if (mutation === "duplicate") await writeFile(f.env.QUALIFICATION_INITIAL_RECEIPT_PATH, "{\"schema\":\"x\",\"schema\":\"x\"}\n");
      const target = mutation === "output" ? path.join(f.evidence, "initial-projection.json") : mutation === "privacy" ? path.join(f.evidence, "private", "initial-projection.json") : path.join(f.evidence, mutation + ".json");
      await assert.rejects(command(projector, ["--input", f.env.QUALIFICATION_INITIAL_RECEIPT_PATH, "--journal", path.join(f.privateRoot, "first-custody-journal.json"), "--output", target], f.workspace, f.env));
    } finally { await rm(f.root, { recursive: true, force: true }); } }
});
