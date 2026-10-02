import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile, symlink, rename } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { promisify } from "node:util";
import { sha256, validAcl, darwinCacheHeader, nonReparseDirectory, createExclusiveDirectory, ownership, chain, recheck } from "../scripts/private-first-custody-v3-lib.mjs";

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
  for (const mutation of ["tracked", "registry", "journal", "native", "raw", "eof", "duplicate", "output", "blob", "extra", "compiler", "parent", "lineage", "order", "tool", "caller", "birth", "pidReuse", "helper", "helperLibrary", "helperSelf", "helperTarget", "privacy"]) { const f = await fixture(); try { await produce(f);
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
       if (mutation === "helperSelf" || mutation === "helperTarget") { const journalPath = path.join(f.privateRoot, "first-custody-journal.json"), journal = JSON.parse(await readFile(journalPath, "utf8")), helper = journal.commands[0].native.helper; if (!helper) journal.commands[0].native.birthObserved = false; else { const raw = JSON.parse(Buffer.from(helper.first.stdout.data).toString("utf8")); if (mutation === "helperSelf") raw.self.chain[0].birth = "0"; else raw.target.chain[0].imageSha256 = "0".repeat(64); const bytes = Buffer.from(JSON.stringify(raw)); helper.first.stdout = bytes; helper.first.stdoutSha256 = sha256(bytes); } await writeFile(journalPath, JSON.stringify(journal) + "\n"); }
       if (mutation === "eof") { const journalPath = path.join(f.privateRoot, "first-custody-journal.json"), journal = JSON.parse(await readFile(journalPath, "utf8")); journal.commands[1].result.stdoutEof = false; await writeFile(journalPath, JSON.stringify(journal) + "\n"); }
       if (mutation === "tool") { const receipt = JSON.parse(await readFile(f.env.QUALIFICATION_INITIAL_RECEIPT_PATH, "utf8")); receipt.tools[0].file.sha256 = "0".repeat(64); await writeFile(f.env.QUALIFICATION_INITIAL_RECEIPT_PATH, JSON.stringify(receipt) + "\n"); }
      if (mutation === "order") { const journalPath = path.join(f.privateRoot, "first-custody-journal.json"), journal = JSON.parse(await readFile(journalPath, "utf8")); journal.commands.reverse(); await writeFile(journalPath, JSON.stringify(journal) + "\n"); }
      if (mutation === "duplicate") await writeFile(f.env.QUALIFICATION_INITIAL_RECEIPT_PATH, "{\"schema\":\"x\",\"schema\":\"x\"}\n");
      const target = mutation === "output" ? path.join(f.evidence, "initial-projection.json") : mutation === "privacy" ? path.join(f.evidence, "private", "initial-projection.json") : path.join(f.evidence, mutation + ".json");
      await assert.rejects(command(projector, ["--input", f.env.QUALIFICATION_INITIAL_RECEIPT_PATH, "--journal", path.join(f.privateRoot, "first-custody-journal.json"), "--output", target], f.workspace, f.env));
    } finally { await rm(f.root, { recursive: true, force: true }); } }
});
// Policy models cover SID deduplication; they do not claim a SYSTEM token exists.
test("BR008 exact Windows SID policy accepts unique ordinary/SYSTEM/Admin sets and rejects effective ACE drift", () => {
  for (const current of ["S-1-5-21-123-456-789-1001", "S-1-5-18", "S-1-5-32-544"]) {
    const proof = { owner: current, current, protected: true, rules: [...new Set([current, "S-1-5-18", "S-1-5-32-544"])].map(sid => ({ sid, type: "Allow", rights: 2032127, inherited: false, inheritance: 3, propagation: 0 })) };
    assert.equal(validAcl(proof), true);
    for (const mutate of [
      p => p.rules.push({ ...p.rules[0] }),
      p => p.rules[0].sid = "S-1-1-0",
      p => p.rules[0].sid = "S-1-5-21-999-999-999-999",
      p => p.rules[0].inherited = true,
      p => p.rules[0].rights = 2,
      p => p.rules[0].inheritance = 0,
      p => p.rules[0].propagation = 1,
      p => p.rules[0].type = "Deny",
      p => p.protected = false,
      p => p.owner = "S-1-1-0"
    ]) { const changed = structuredClone(proof); mutate(changed); assert.equal(validAcl(changed), false); }
  }
});
test("BR008 directory boundary rejects an actual symlink or Windows junction", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "custody-parent-"));
  try {
    const actual = path.join(root, "actual"), alias = path.join(root, "alias");
    await mkdir(actual);
    await symlink(actual, alias, process.platform === "win32" ? "junction" : "dir");
    await assert.rejects(nonReparseDirectory(alias, root));
    await mkdir(path.join(actual, "child"));
    await assert.rejects(nonReparseDirectory(path.join(alias, "child"), root));
  } finally { await rm(root, { recursive: true, force: true }); }
});
test("BR008 Darwin complete cache mutations fail despite coherently resealed journal and receipt", { skip: process.platform !== "darwin" }, async () => {
  for (const scenario of ["cachePath", "loadedImageUuid", "cacheUuid", "cacheHeaderUuid", "cacheHeaderSha256", "cacheHeaderSha256:raw", "cacheUuid:raw"]) {
    const key = scenario.split(":")[0];
    const f = await fixture();
    try {
      await produce(f);
      const journalPath = path.join(f.privateRoot, "first-custody-journal.json");
      const journal = JSON.parse(await readFile(journalPath, "utf8"));
      for (const command of journal.commands) {
        const library = command.native.helper.libraries[0];
        library[key] = key === "cachePath" ? "/System/forged-cache" : "0".repeat(key === "cacheHeaderSha256" ? 64 : 32);
        if (key === "cacheUuid") library.cacheHeaderUuid = library.cacheUuid;
        if (key === "cacheHeaderUuid") library.cacheUuid = library.cacheHeaderUuid;
        if (scenario.endsWith(":raw")) for (const probe of [command.native.helper.first, command.native.helper.second]) {
          const raw = JSON.parse(Buffer.from(probe.stdout.data).toString("utf8")); raw.dyldCache = { ...library }; const bytes = Buffer.from(JSON.stringify(raw)); probe.stdout = bytes; probe.stdoutSha256 = sha256(bytes);
        }
      }
      const bytes = JSON.stringify(journal) + "\n";
      await writeFile(journalPath, bytes);
      const receipt = JSON.parse(await readFile(f.env.QUALIFICATION_INITIAL_RECEIPT_PATH, "utf8"));
      receipt.journal.file = { size: Buffer.byteLength(bytes), sha256: sha256(bytes) };
      await writeFile(f.env.QUALIFICATION_INITIAL_RECEIPT_PATH, JSON.stringify(receipt) + "\n");
      await assert.rejects(command(projector, ["--input", f.env.QUALIFICATION_INITIAL_RECEIPT_PATH, "--journal", journalPath, "--output", path.join(f.evidence, key + ".json")], f.workspace, f.env));
    } finally { await rm(f.root, { recursive: true, force: true }); }
  }
});
test("BR008 Darwin held cache header refuses non-OS writable fixtures and physical aliases", { skip: process.platform !== "darwin" }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "custody-cache-"));
  try {
    const file = path.join(root, "cache"), alias = path.join(root, "alias");
    const header = Buffer.alloc(104); header.write("dyld_"); await writeFile(file, header);
    await assert.rejects(darwinCacheHeader(file));
    await symlink(file, alias);
    await assert.rejects(darwinCacheHeader(alias));
  } finally { await rm(root, { recursive: true, force: true }); }
});
// This exercises the actual current Windows identity; SYSTEM/Admin policy models above
// are explicitly not substitutes for native receipts under those tokens.
test("BR008 native Windows owned root rejects broad foreign and inherited ACL writers", { skip: process.platform !== "win32" }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "custody-acl-"));
  const powershell = path.join(process.env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  try {
    for (const sid of ["S-1-1-0", "S-1-5-32-545"]) {
      const directory = path.join(root, sid);
      await createExclusiveDirectory(directory, root);
      await ownership(directory, root);
      const script = "$ErrorActionPreference='Stop';$p=$env:SERVICE_LASSO_CUSTODY_TARGET;$i=Get-Item -LiteralPath $p;$a=$i.GetAccessControl();$a.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($env:SERVICE_LASSO_TEST_SID,'Write','Allow')));$i.SetAccessControl($a)";
      await exec(powershell, ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true, env: { ...process.env, SERVICE_LASSO_CUSTODY_TARGET: directory, SERVICE_LASSO_TEST_SID: sid } });
      await assert.rejects(ownership(directory, root));
    }
    const directory = path.join(root, "inherited");
    await createExclusiveDirectory(directory, root);
    const script = "$ErrorActionPreference='Stop';$i=Get-Item -LiteralPath $env:SERVICE_LASSO_CUSTODY_TARGET;$a=$i.GetAccessControl();$a.SetAccessRuleProtection($false,$true);$i.SetAccessControl($a)";
    await exec(powershell, ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true, env: { ...process.env, SERVICE_LASSO_CUSTODY_TARGET: directory } });
    await assert.rejects(ownership(directory, root));
  } finally { await rm(root, { recursive: true, force: true }); }
});
test("BR008 actual directory parent replacement invalidates its retained identity snapshot", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "custody-replace-"));
  try {
    const parent = path.join(root, "parent");
    await mkdir(parent);
    const snapshot = await chain(parent, root);
    await rename(parent, path.join(root, "retained-original"));
    await mkdir(parent);
    await assert.rejects(recheck(snapshot), /first_custody_parent_replaced/u);
  } finally { await rm(root, { recursive: true, force: true }); }
});
