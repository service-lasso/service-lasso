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
async function nativeAssetHashes() {
  const assetPaths = [
    "runtime/process/windows-process-inspector.cs",
    "runtime/process/windows-process-inspector.exe",
    "runtime/process/windows-process-inspector.provenance.json",
    "runtime/execution/windows-managed-launcher-native.exe",
    "runtime/execution/windows-managed-launcher-native.provenance.json",
  ];
  const result = {};
  for (const relativePath of assetPaths) {
    const sourcePath = path.join(process.cwd(), "src", relativePath);
    const buildPath = path.join(process.cwd(), "dist", relativePath);
    result[relativePath] = {
      sourceSha256: (await inspectPath(sourcePath)).state === "present" ? await sha256File(sourcePath) : null,
      buildSha256: (await inspectPath(buildPath)).state === "present" ? await sha256File(buildPath) : null,
    };
  }
  return result;
}
async function gitIdentity() {
  const run = async (args) => (await execFileAsync("git", args, { encoding: "utf8" })).stdout.trim();
  return { head: await run(["rev-parse", "HEAD"]), tree: await run(["rev-parse", "HEAD^{tree}"]) };
}
function commandForNpm(args) { return process.platform === "win32" ? { command: "cmd.exe", args: ["/d", "/s", "/c", "npm", ...args] } : { command: "npm", args }; }
function hashText(value) { return createHash("sha256").update(value, "utf8").digest("hex"); }
function typedSpawnError(error) {
  return {
    kind: "spawn_error",
    name: typeof error?.name === "string" ? error.name.slice(0, 80) : "Error",
    code: typeof error?.code === "string" ? error.code.slice(0, 80) : null,
  };
}
function emptyNativeCustody() {
  return {
    status: "not_observed",
    reason: process.platform === "win32" ? "awaiting_spawn" : "platform_not_windows",
  };
}
async function inspectNativeCustody(child, label, launchCwd) {
  if (process.platform !== "win32") return { status: "not_observed", reason: "platform_not_windows" };
  if (!Number.isInteger(child.pid) || child.pid <= 0) return { status: "not_observed", reason: "child_not_created" };
  const inspectorPath = path.join(process.cwd(), "src", "runtime", "process", "windows-process-inspector.exe");
  try {
    const { stdout } = await execFileAsync(inspectorPath, [String(child.pid), "--include-descendants"], {
      windowsHide: true,
      timeout: 10_000,
      maxBuffer: 1024 * 1024,
      encoding: "utf8",
    });
    const tree = JSON.parse(stdout);
    if (tree?.Status !== "tree" || tree?.RootStatus !== "running" || !Array.isArray(tree.Processes)) {
      return { status: "not_observed", reason: "native_identity_unavailable" };
    }
    const root = tree.Processes.find((entry) => entry?.ProcessId === child.pid);
    if (!root || !Number.isInteger(root.ParentProcessId) || typeof root.CreationDate !== "string" ||
      typeof root.ExecutablePath !== "string" || typeof root.CommandLine !== "string") {
      return { status: "not_observed", reason: "native_identity_incomplete" };
    }
    const processes = tree.Processes.map((entry) => ({
      pid: Number.isInteger(entry?.ProcessId) ? entry.ProcessId : null,
      parentPid: Number.isInteger(entry?.ParentProcessId) ? entry.ParentProcessId : null,
      createdAt: typeof entry?.CreationDate === "string" ? entry.CreationDate : null,
      executableSha256: typeof entry?.ExecutablePath === "string" ? hashText(entry.ExecutablePath) : null,
      commandSha256: typeof entry?.CommandLine === "string" ? hashText(entry.CommandLine) : null,
    }));
    if (processes.some((entry) => entry.pid === null || entry.parentPid === null || entry.createdAt === null || entry.executableSha256 === null || entry.commandSha256 === null)) {
      return { status: "not_observed", reason: "native_identity_incomplete" };
    }
    return {
      status: "observed",
      source: "windows-process-inspector",
      label,
      launchCwdSha256: hashText(launchCwd),
      root: processes.find((entry) => entry.pid === child.pid),
      processChain: processes,
    };
  } catch {
    return { status: "not_observed", reason: "native_inspector_failed" };
  }
}
function startProcess(label, command, args, env) {
  const startedAt = new Date().toISOString();
  const injectSpawnFailure = process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS === "1" &&
    process.env.SERVICE_LASSO_ISOLATED_TEST_SPAWN_ERROR === label;
  const child = spawn(injectSpawnFailure ? `${command}.service-lasso-test-missing` : command, args, { stdio: "inherit", env });
  const ownership = {
    childCreated: Number.isInteger(child.pid) && child.pid > 0,
    pid: Number.isInteger(child.pid) && child.pid > 0 ? child.pid : null,
    nodeObservedAt: startedAt,
    nativeCustody: emptyNativeCustody(),
  };
  const record = { label, ownership, spawnError: null, close: null };
  const nativeCustody = new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    child.once("spawn", () => void inspectNativeCustody(child, label, process.cwd()).then(finish));
    child.once("error", () => finish({ status: "not_observed", reason: "spawn_error" }));
    child.once("close", () => finish({ status: "not_observed", reason: "child_not_created" }));
  });
  const closed = new Promise((resolve) => {
    // Spawn errors do not establish terminal process state.  Keep their typed
    // classification, then wait for the actual ChildProcess close event.
    child.once("error", (error) => { record.spawnError = typedSpawnError(error); });
    child.once("close", (code, signal) => resolve({ code, signal, closedAt: new Date().toISOString() }));
  });
  return { record, closed, nativeCustody };
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
  nativeAssets: await nativeAssetHashes(),
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
  const buildCommand = commandForNpm(["run", "build"]);
  const build = startProcess("build", buildCommand.command, buildCommand.args, childEnv);
  receipt.processes.push(build.record);
  await persistReceipt();
  build.record.close = await build.closed;
  await persistReceipt();
  build.record.ownership.nativeCustody = await build.nativeCustody;
  await persistReceipt();
  if (build.record.close.code !== 0 || build.record.close.signal) throw new Error("Build did not close successfully.");
  receipt.nativeAssets = await nativeAssetHashes();
  await persistReceipt();
  const test = startProcess("test", process.execPath, ["--test", "--test-concurrency=1", ...testFiles], childEnv);
  receipt.processes.push(test.record);
  await persistReceipt();
  test.record.close = await test.closed;
  await persistReceipt();
  test.record.ownership.nativeCustody = await test.nativeCustody;
  receipt.terminal = { outcome: test.record.close.code === 0 && !test.record.close.signal ? "passed" : "failed", trueCloseExit: test.record.close };
  await persistReceipt();
  if (receipt.terminal.outcome !== "passed") throw new Error("Test runner did not close successfully.");
} catch (error) {
  const lastClosedProcess = [...receipt.processes].reverse().find((entry) => entry.close !== null);
  receipt.terminal = {
    ...receipt.terminal,
    outcome: "failed",
    trueCloseExit: receipt.terminal?.trueCloseExit ?? lastClosedProcess?.close ?? null,
    error: error instanceof Error ? error.message : String(error),
  };
  await persistReceipt();
  throw error;
}
console.log(`Isolated test receipt retained at ${receiptPath}`);
