// This is intentionally invoked before npm ci, build, test, or a Core import.
// It records the checked-out candidate and the runner that is about to execute
// those actions; later receipts transport this fact but never recreate it.
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { lstat, mkdir, open, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const required = ["ADMIN_PLATFORM", "GITHUB_RUN_ID", "GITHUB_RUN_ATTEMPT", "QUALIFICATION_INITIAL_RECEIPT_PATH", "GITHUB_WORKSPACE"];
for (const name of required) if (!process.env[name]) throw new Error(`first_custody_${name.toLowerCase()}_missing`);
const receiptPath = path.resolve(process.env.QUALIFICATION_INITIAL_RECEIPT_PATH);
const root = path.dirname(receiptPath);
if (root !== path.resolve(process.env.QUALIFICATION_EVIDENCE_ROOT ?? root)) throw new Error("first_custody_receipt_root_invalid");

async function exclusiveJson(file, value) {
  const handle = await open(file, "wx", 0o600);
  try { await handle.writeFile(`${JSON.stringify(value)}\n`, "utf8"); await handle.sync(); }
  finally { await handle.close(); }
}
async function fileState(candidate) {
  const metadata = await lstat(candidate).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
  if (!metadata) return { state: "ABSENT" };
  if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error("first_custody_owned_path_invalid");
  const bytes = await readFile(candidate);
  return { state: "FILE", size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
}
async function parentChain(candidate) {
  const chain = [];
  for (let cursor = path.resolve(candidate); ;) {
    const metadata = await lstat(cursor);
    if (metadata.isSymbolicLink()) throw new Error("first_custody_parent_link");
    chain.push({ path: cursor, kind: metadata.isDirectory() ? "DIRECTORY" : metadata.isFile() ? "FILE" : "OTHER" });
    const parent = path.dirname(cursor); if (parent === cursor) return chain;
    cursor = parent;
  }
}
async function command(command, args) {
  try {
    const result = await execFileAsync(command, args, { cwd: process.env.GITHUB_WORKSPACE, timeout: 5_000, windowsHide: true, encoding: "utf8" });
    return { command: [command, ...args], status: 0, stdoutSha256: createHash("sha256").update(result.stdout).digest("hex"), stderrSha256: createHash("sha256").update(result.stderr).digest("hex") };
  } catch (error) { return { command: [command, ...args], status: Number.isSafeInteger(error.code) ? error.code : null, unavailable: error.code === "ENOENT", stdoutSha256: createHash("sha256").update(error.stdout ?? "").digest("hex"), stderrSha256: createHash("sha256").update(error.stderr ?? "").digest("hex") }; }
}
const ownedPaths = [
  "src/runtime/process/windows-process-inspector.cs", "src/runtime/process/windows-process-inspector.exe", "src/runtime/process/windows-process-inspector.provenance.json",
  "src/runtime/execution/windows-managed-launcher-native.cs", "src/runtime/execution/windows-managed-launcher-native.exe", "src/runtime/execution/windows-managed-launcher-native.provenance.json",
  "src/runtime/security/windows-dpapi-helper.cs", "src/runtime/security/windows-dpapi-helper.exe", "src/runtime/security/windows-dpapi-helper.provenance.json",
  "tests/fixtures/windows-held-exit-probe.cs", "tests/fixtures/windows-held-exit-probe.exe", "tests/fixtures/windows-held-exit-probe.provenance.json",
];
const workspace = path.resolve(process.env.GITHUB_WORKSPACE);
const sourceCommands = await Promise.all([command("git", ["rev-parse", "HEAD"]), command("git", ["rev-parse", "HEAD^{tree}"])]);
const [headRaw, treeRaw] = await Promise.all([execFileAsync("git", ["rev-parse", "HEAD"], { cwd: workspace }), execFileAsync("git", ["rev-parse", "HEAD^{tree}"], { cwd: workspace })]);
const head = headRaw.stdout.trim(), tree = treeRaw.stdout.trim();
if (!/^[0-9a-f]{40}$/u.test(head) || !/^[0-9a-f]{40}$/u.test(tree) || head !== process.env.QUALIFICATION_CANDIDATE_SHA) throw new Error("first_custody_candidate_binding_invalid");
const runtime = await fileState(process.execPath);
const nativeAssets = await Promise.all(ownedPaths.map(async (relative) => ({ path: relative, parents: await parentChain(path.join(workspace, relative)), file: await fileState(path.join(workspace, relative)) })));
const journal = { schema: "service-lasso.qualification-first-custody-journal.v1", private: true, commands: [...sourceCommands, await command("npm", ["--version"]), await command("csc", ["-version"]) ] };
await mkdir(root, { recursive: true, mode: 0o700 });
await exclusiveJson(path.join(root, "first-custody-journal.json"), journal);
await exclusiveJson(receiptPath, {
  schema: "service-lasso.qualification-initial-receipt.v2", private: true, platform: process.env.ADMIN_PLATFORM,
  run: { id: process.env.GITHUB_RUN_ID, attempt: process.env.GITHUB_RUN_ATTEMPT }, source: { head, tree },
  runner: { platform: process.platform, arch: process.arch, release: os.release(), pid: process.pid, ppid: process.ppid, executable: runtime },
  ownedPaths: nativeAssets, registries: [process.env.SERVICE_LASSO_INSTANCE_REGISTRY_PATH, process.env.SERVICE_LASSO_HOST_PORT_REGISTRY_PATH].map((candidate) => ({ path: candidate, state: "ABSENT" })),
  journal: "first-custody-journal.json",
});
