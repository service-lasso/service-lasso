const inputKeys = ["SERVICE_LASSO_WORKSPACE_ROOT", "SERVICE_LASSO_INSTANCE_REGISTRY_PATH", "SERVICE_LASSO_HOST_PORT_REGISTRY_PATH"];
const rawInputs = Object.fromEntries(inputKeys.map((key) => [key, process.env[key] ?? null]));
const suppliedInputs = inputKeys.filter((key) => rawInputs[key] !== null);

if (suppliedInputs.length !== 0 && suppliedInputs.length !== inputKeys.length) {
  throw new Error(`Provide all isolated-state inputs together; missing: ${inputKeys.filter((key) => rawInputs[key] === null).join(", ")}.`);
}
if (suppliedInputs.length === inputKeys.length) {
  for (const key of inputKeys) {
    const value = rawInputs[key];
    if (value.length === 0 || value.includes("\0") || !/^(?:[A-Za-z]:[\\/]|\\\\|\/)/.test(value)) throw new Error(`${key} must be a non-empty absolute path.`);
  }
  if (new Set(inputKeys.map((key) => rawInputs[key])).size !== inputKeys.length) throw new Error("Isolated-state inputs must use three distinct literal paths.");
}

const [{ mkdir, mkdtemp, writeFile, rename, lstat, readFile }, os, path, { glob }, { spawn }, { createHash }, { promisify }, { execFile }] = await Promise.all([
  import("node:fs/promises"), import("node:os"), import("node:path"), import("node:fs/promises"), import("node:child_process"), import("node:crypto"), import("node:util"), import("node:child_process"),
]);
const execFileAsync = promisify(execFile);

function assertDistinctResolvedPaths(inputs) {
  const resolved = inputKeys.map((key) => path.resolve(inputs[key]));
  if (new Set(resolved.map((value) => process.platform === "win32" ? value.toLowerCase() : value)).size !== resolved.length) throw new Error("Isolated-state inputs must resolve to three distinct paths.");
}
async function inspectPath(filePath) {
  try {
    const stat = await lstat(filePath);
    return { state: "present", kind: stat.isDirectory() ? "directory" : stat.isFile() ? "file" : "other" };
  } catch (error) {
    if (error?.code === "ENOENT") return { state: "missing" };
    throw error;
  }
}
async function sha256File(filePath) { return createHash("sha256").update(await readFile(filePath)).digest("hex"); }
async function gitIdentity() {
  const run = async (args) => (await execFileAsync("git", args, { encoding: "utf8" })).stdout.trim();
  return { head: await run(["rev-parse", "HEAD"]), tree: await run(["rev-parse", "HEAD^{tree}"]) };
}
function commandForNpm(args) { return process.platform === "win32" ? { command: "cmd.exe", args: ["/d", "/s", "/c", "npm", ...args] } : { command: "npm", args }; }
function closeProcess(label, command, args, env, onStarted) {
  const startedAt = new Date().toISOString();
  const child = spawn(command, args, { stdio: "inherit", env });
  const ownership = { pid: child.pid ?? null, observedBirthAt: startedAt };
  onStarted({ label, ownership });
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ label, ownership, close: { code, signal, closedAt: new Date().toISOString() } }));
  });
}

const usesExternalInputs = suppliedInputs.length === inputKeys.length;
const ownedRoot = usesExternalInputs ? null : await mkdtemp(path.join(os.tmpdir(), "service-lasso-test-host-state-"));
const inputs = usesExternalInputs ? Object.fromEntries(inputKeys.map((key) => [key, rawInputs[key]])) : {
  SERVICE_LASSO_WORKSPACE_ROOT: path.join(ownedRoot, "workspace"),
  SERVICE_LASSO_INSTANCE_REGISTRY_PATH: path.join(ownedRoot, "instances.json"),
  SERVICE_LASSO_HOST_PORT_REGISTRY_PATH: path.join(ownedRoot, "endpoint-allocations.json"),
};
assertDistinctResolvedPaths(inputs);

const workspaceRoot = inputs.SERVICE_LASSO_WORKSPACE_ROOT;
const instanceRegistryPath = inputs.SERVICE_LASSO_INSTANCE_REGISTRY_PATH;
const hostPortRegistryPath = inputs.SERVICE_LASSO_HOST_PORT_REGISTRY_PATH;
const receiptDirectory = path.join(path.dirname(instanceRegistryPath), "isolated-test-receipts");
const initialInputs = Object.fromEntries(await Promise.all(inputKeys.map(async (key) => [key, await inspectPath(inputs[key])])));
await mkdir(workspaceRoot, { recursive: true });
await mkdir(path.dirname(instanceRegistryPath), { recursive: true });
await mkdir(path.dirname(hostPortRegistryPath), { recursive: true });
await mkdir(receiptDirectory, { recursive: true });

const receiptPath = path.join(receiptDirectory, `run-${Date.now()}-${process.pid}.json`);
const receipt = {
  version: 1, inputMode: usesExternalInputs ? "external" : "owned-default", rawInputs, actualInputs: inputs,
  initial: initialInputs,
  git: await gitIdentity(), nativeHash: { executable: process.execPath, sha256: await sha256File(process.execPath) },
  receiptPath, processes: [], terminal: null,
};
async function persistReceipt() {
  const temporaryPath = `${receiptPath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(receipt, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  await rename(temporaryPath, receiptPath);
}
await persistReceipt();

const childEnv = { ...process.env, ...inputs };
const testFiles = [];
const requestedFiles = process.env.SERVICE_LASSO_ISOLATED_TEST_FILES;
if (requestedFiles) {
  for (const filePath of requestedFiles.split(",")) {
    if (!/^tests\/[A-Za-z0-9_./-]+\.test\.js$/.test(filePath) || filePath.includes("..")) throw new Error("SERVICE_LASSO_ISOLATED_TEST_FILES may contain only repository tests/*.test.js paths.");
    testFiles.push(filePath);
  }
} else for await (const filePath of glob("tests/**/*.test.js")) testFiles.push(filePath);
testFiles.sort();
if (testFiles.length === 0) throw new Error("No test files were found.");

try {
  const build = commandForNpm(["run", "build"]);
  const buildResult = await closeProcess("build", build.command, build.args, childEnv, (started) => receipt.processes.push(started));
  receipt.processes[receipt.processes.length - 1] = buildResult;
  await persistReceipt();
  if (buildResult.close.code !== 0 || buildResult.close.signal) throw new Error("Build did not close successfully.");
  const testResult = await closeProcess("test", process.execPath, ["--test", "--test-concurrency=1", ...testFiles], childEnv, (started) => receipt.processes.push(started));
  receipt.processes[receipt.processes.length - 1] = testResult;
  receipt.terminal = { outcome: testResult.close.code === 0 && !testResult.close.signal ? "passed" : "failed", trueCloseExit: testResult.close };
  await persistReceipt();
  if (receipt.terminal.outcome !== "passed") throw new Error("Test runner did not close successfully.");
} catch (error) {
  receipt.terminal = { ...receipt.terminal, outcome: "failed", error: error instanceof Error ? error.message : String(error) };
  await persistReceipt();
  throw error;
}
console.log(`Isolated test receipt retained at ${receiptPath}`);
