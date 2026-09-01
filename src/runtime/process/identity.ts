import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, readdir, readlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  isProcessControlDeadlineError,
  remainingProcessControlMs,
  runProcessControlCommand,
} from "./deadline.js";

const execFileAsync = promisify(execFileCallback);
const WINDOWS_PROCESS_INSPECTION_TIMEOUT_MS = 15_000;
const WINDOWS_PROCESS_TREE_INSPECTION_RETRY_MAX_DELAY_MS = 250;
let windowsCurrentProcessInspectionPromise: Promise<ProcessInspection> | null =
  null;

export interface ProcessFingerprint {
  pid: number;
  createdAt: string;
  executablePath: string;
  commandHash: string;
}

export type ProcessInspection =
  | { status: "running"; identity: ProcessFingerprint }
  | { status: "not_running"; reason: string }
  | { status: "unknown"; reason: string };

export type ProcessIdentityClassification =
  | "owned"
  | "not_running"
  | "identity_mismatch"
  | "unknown_owner";

export interface ProcessInspectorDependencies {
  platform?: NodeJS.Platform;
  readFile?: (
    filePath: string,
    encoding?: BufferEncoding,
  ) => Promise<string | Buffer>;
  readlink?: (filePath: string) => Promise<string>;
  deadlineMs?: number;
  signal?: AbortSignal;
  windowsSystemRoot?: string;
  runCommand?: (
    command: string,
    args: string[],
    options?: { deadlineMs?: number; signal?: AbortSignal },
  ) => Promise<{ stdout: string }>;
}

function normalizeCommandLine(commandLine: string | readonly string[]): string {
  const value =
    typeof commandLine === "string" ? commandLine : commandLine.join(" ");
  return value.replace(/\s+/g, " ").trim();
}

export function hashProcessCommandLine(
  commandLine: string | readonly string[],
): string {
  return createHash("sha256")
    .update(normalizeCommandLine(commandLine))
    .digest("hex");
}

function normalizeExecutablePath(
  value: string,
  platform: NodeJS.Platform = process.platform,
): string {
  const normalized =
    platform === "win32"
      ? path.win32.normalize(value.trim())
      : path.normalize(value.trim());
  return platform === "win32" ? normalized.toLowerCase() : normalized;
}

function isMissingProcessError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException)?.code;
  return code === "ENOENT" || code === "ESRCH";
}

function errorReason(error: unknown): string {
  const code = (error as NodeJS.ErrnoException)?.code;
  if (typeof code === "string" && code) {
    return code.toLowerCase();
  }
  return error instanceof Error ? error.message : String(error);
}

function parseLinuxStartTicks(stat: string): number | null {
  const commandEnd = stat.lastIndexOf(")");
  if (commandEnd < 0) {
    return null;
  }

  const fieldsAfterCommand = stat
    .slice(commandEnd + 2)
    .trim()
    .split(/\s+/);
  const startTicks = Number(fieldsAfterCommand[19]);
  return Number.isFinite(startTicks) && startTicks >= 0 ? startTicks : null;
}

function parseLinuxBootTime(procStat: string): number | null {
  const match = procStat.match(/^btime\s+(\d+)$/m);
  if (!match) {
    return null;
  }
  const seconds = Number(match[1]);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
}

async function inspectLinuxProcess(
  pid: number,
  processPath: string,
  dependencies: Required<
    Pick<ProcessInspectorDependencies, "readFile" | "readlink" | "runCommand">
  >,
): Promise<ProcessInspection> {
  try {
    const [statValue, commandValue, procStatValue, executableLink] =
      await Promise.all([
        dependencies.readFile(`${processPath}/stat`, "utf8"),
        dependencies.readFile(`${processPath}/cmdline`),
        dependencies.readFile("/proc/stat", "utf8"),
        dependencies.readlink(`${processPath}/exe`).catch(() => null),
      ]);
    const stat = String(statValue);
    const procStat = String(procStatValue);
    const commandBuffer = Buffer.isBuffer(commandValue)
      ? commandValue
      : Buffer.from(commandValue);
    const commandParts = commandBuffer
      .toString("utf8")
      .split("\0")
      .filter((entry) => entry.length > 0);
    const commandEnd = stat.lastIndexOf(")");
    const fieldsAfterCommand =
      commandEnd >= 0
        ? stat
            .slice(commandEnd + 2)
            .trim()
            .split(/\s+/)
        : [];
    if (fieldsAfterCommand[0] === "Z") {
      return { status: "not_running", reason: "process_is_zombie" };
    }
    const executablePath = executableLink?.trim() || commandParts[0] || "";
    const startTicks = parseLinuxStartTicks(stat);
    const bootTimeSeconds = parseLinuxBootTime(procStat);

    if (
      commandParts.length === 0 ||
      startTicks === null ||
      bootTimeSeconds === null ||
      !executablePath
    ) {
      return { status: "unknown", reason: "linux_process_evidence_incomplete" };
    }

    let clockTicks = 100;
    try {
      const result = await dependencies.runCommand("getconf", ["CLK_TCK"]);
      const parsed = Number(result.stdout.trim());
      if (Number.isFinite(parsed) && parsed > 0) {
        clockTicks = parsed;
      }
    } catch {
      // POSIX systems conventionally use 100 when getconf is unavailable.
    }

    const createdAt = new Date(
      (bootTimeSeconds + startTicks / clockTicks) * 1000,
    ).toISOString();
    return {
      status: "running",
      identity: {
        pid,
        createdAt,
        executablePath: path.normalize(executablePath),
        commandHash: hashProcessCommandLine(commandParts),
      },
    };
  } catch (error) {
    if (isMissingProcessError(error)) {
      return { status: "not_running", reason: "process_not_running" };
    }

    try {
      const [started, executable, command] = await Promise.all([
        dependencies.runCommand("ps", ["-p", String(pid), "-o", "lstart="]),
        dependencies.runCommand("ps", ["-p", String(pid), "-o", "exe="]),
        dependencies.runCommand("ps", ["-p", String(pid), "-o", "args="]),
      ]);
      const createdAt = new Date(started.stdout.trim());
      const executablePath = executable.stdout.trim();
      const commandLine = command.stdout.trim();
      if (
        !Number.isFinite(createdAt.getTime()) ||
        !executablePath ||
        !commandLine
      ) {
        return {
          status: "unknown",
          reason: "linux_ps_process_evidence_incomplete",
        };
      }
      return {
        status: "running",
        identity: {
          pid,
          createdAt: createdAt.toISOString(),
          executablePath: path.normalize(executablePath),
          commandHash: hashProcessCommandLine(commandLine),
        },
      };
    } catch (fallbackError) {
      const exitCode = (fallbackError as { code?: unknown })?.code;
      return exitCode === 1 || isMissingProcessError(fallbackError)
        ? { status: "not_running", reason: "process_not_running" }
        : {
            status: "unknown",
            reason: `linux_process_inspection_failed:${errorReason(error)};ps:${errorReason(fallbackError)}`,
          };
    }
  }
}

function parseNamespacePids(status: string): number[] {
  const match = status.match(/^NSpid:\s+([\d\s]+)$/m);
  return match
    ? match[1].trim().split(/\s+/).map(Number).filter(Number.isFinite)
    : [];
}

type LinuxProcessPathResolution =
  | { status: "resolved"; path: string }
  | { status: "not_running"; reason: string }
  | { status: "unknown"; reason: string };

async function resolveLinuxProcessPath(
  pid: number,
): Promise<LinuxProcessPathResolution> {
  if (pid === process.pid) {
    return { status: "resolved", path: "/proc/self" };
  }

  try {
    const selfStatus = await readFile("/proc/self/status", "utf8");
    const selfNamespacePids = parseNamespacePids(selfStatus);
    if (selfNamespacePids.length <= 1) {
      return { status: "resolved", path: `/proc/${pid}` };
    }

    const currentPidNamespace = await readlink("/proc/self/ns/pid");
    const candidates: string[] = [];
    for (const entry of await readdir("/proc", { withFileTypes: true })) {
      if (!entry.isDirectory() || !/^\d+$/.test(entry.name)) {
        continue;
      }
      const candidatePath = `/proc/${entry.name}`;
      try {
        const [status, pidNamespace] = await Promise.all([
          readFile(`${candidatePath}/status`, "utf8"),
          readlink(`${candidatePath}/ns/pid`),
        ]);
        const namespacePids = parseNamespacePids(status);
        if (
          namespacePids.at(-1) === pid &&
          pidNamespace === currentPidNamespace
        ) {
          candidates.push(candidatePath);
        }
      } catch {
        // Processes may exit or deny inspection during the bounded scan.
      }
    }
    if (candidates.length === 1) {
      return { status: "resolved", path: candidates[0] };
    }
    if (candidates.length > 1) {
      return { status: "unknown", reason: "linux_namespaced_pid_ambiguous" };
    }

    try {
      process.kill(pid, 0);
      return { status: "unknown", reason: "linux_namespaced_pid_unresolved" };
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === "ESRCH"
        ? { status: "not_running", reason: "process_not_running" }
        : {
            status: "unknown",
            reason: `linux_namespaced_pid_probe_failed:${errorReason(error)}`,
          };
    }
  } catch {
    return { status: "resolved", path: `/proc/${pid}` };
  }
}

interface WindowsProcessJson {
  Status?: unknown;
  ProcessId?: unknown;
  ParentProcessId?: unknown;
  CreationDate?: unknown;
  ExecutablePath?: unknown;
  CommandLine?: unknown;
}

interface WindowsProcessTreeJson {
  Status?: unknown;
  RootStatus?: unknown;
  Processes?: unknown;
}

export interface WindowsProcessTreeInspection {
  rootStatus: "owned" | "exited";
  members: ProcessFingerprint[];
}

function parseWindowsProcessJson(
  stdout: string,
  pid: number,
): ProcessInspection {
  if (!stdout.trim()) {
    return { status: "unknown", reason: "windows_process_output_missing" };
  }

  try {
    const value = JSON.parse(stdout) as WindowsProcessJson;
    if (value.Status === "not_running") {
      return { status: "not_running", reason: "process_not_running" };
    }
    if (
      value.Status !== "running" ||
      Number(value.ProcessId) !== pid ||
      typeof value.CreationDate !== "string" ||
      !Number.isFinite(Date.parse(value.CreationDate)) ||
      typeof value.ExecutablePath !== "string" ||
      !value.ExecutablePath.trim() ||
      typeof value.CommandLine !== "string" ||
      !value.CommandLine.trim()
    ) {
      return {
        status: "unknown",
        reason: "windows_process_evidence_incomplete",
      };
    }

    return {
      status: "running",
      identity: {
        pid,
        createdAt: new Date(value.CreationDate).toISOString(),
        executablePath: path.win32.normalize(value.ExecutablePath),
        commandHash: hashProcessCommandLine(value.CommandLine),
      },
    };
  } catch {
    return { status: "unknown", reason: "windows_process_output_invalid" };
  }
}

const WINDOWS_NATIVE_PROCESS_INSPECTOR_PATH = fileURLToPath(
  new URL("./windows-process-inspector.exe", import.meta.url),
);

export async function classifyWindowsProcessIdentityFast(
  expected: ProcessFingerprint,
  dependencies: Pick<
    ProcessInspectorDependencies,
    "deadlineMs" | "signal" | "runCommand" | "windowsSystemRoot"
  > = {},
): Promise<ProcessIdentityClassification> {
  if (!Number.isInteger(expected.pid) || expected.pid <= 0) {
    return "not_running";
  }
  const inspection = await inspectWindowsProcess(
    expected.pid,
    dependencies.runCommand,
    dependencies,
  );
  return classifyProcessIdentity(expected, inspection, "win32");
}

async function runWindowsNativeProcessInspector(
  pid: number,
  includeDescendants: boolean,
  runCommand: ProcessInspectorDependencies["runCommand"],
  options: Pick<
    ProcessInspectorDependencies,
    "deadlineMs" | "signal" | "windowsSystemRoot"
  >,
): Promise<{ exitCode: number | null; stdout: string }> {
  return await runProcessControlCommand(
    WINDOWS_NATIVE_PROCESS_INSPECTOR_PATH,
    [String(pid), ...(includeDescendants ? ["--include-descendants"] : [])],
    {
      captureOutput: true,
      deadlineMs: options.deadlineMs,
      signal: options.signal,
      runner: runCommand
        ? async (executable, args, helperOptions) => ({
            exitCode: 0,
            ...(await runCommand(executable, args, {
              deadlineMs: options.deadlineMs,
              signal: helperOptions.signal,
            })),
          })
        : undefined,
    },
  );
}

async function inspectWindowsProcessOnce(
  pid: number,
  runCommand: ProcessInspectorDependencies["runCommand"],
  options: Pick<
    ProcessInspectorDependencies,
    "deadlineMs" | "signal" | "windowsSystemRoot"
  >,
): Promise<ProcessInspection> {
  try {
    const result = await runWindowsNativeProcessInspector(
      pid,
      false,
      runCommand,
      options,
    );
    return result.exitCode === 0
      ? parseWindowsProcessJson(result.stdout, pid)
      : { status: "unknown", reason: "windows_process_helper_failed" };
  } catch (error) {
    if (isProcessControlDeadlineError(error)) {
      throw error;
    }
    return {
      status: "unknown",
      reason: `windows_process_inspection_failed:${errorReason(error)}`,
    };
  }
}

async function inspectWindowsProcess(
  pid: number,
  runCommand: ProcessInspectorDependencies["runCommand"],
  options: Pick<
    ProcessInspectorDependencies,
    "deadlineMs" | "signal" | "windowsSystemRoot"
  >,
): Promise<ProcessInspection> {
  let last: ProcessInspection = {
    status: "unknown",
    reason: "windows_process_inspection_not_attempted",
  };
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    last = await inspectWindowsProcessOnce(pid, runCommand, options);
    if (last.status !== "unknown") {
      return last;
    }
    if (attempt < 3) {
      if (options.signal?.aborted) {
        return last;
      }
      if (
        options.deadlineMs !== undefined &&
        remainingProcessControlMs(options.deadlineMs) <= 25
      ) {
        return last;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
  return last;
}

async function inspectWindowsProcessTreeOnce(
  expectedRoot: ProcessFingerprint,
  dependencies: Pick<
    ProcessInspectorDependencies,
    "deadlineMs" | "signal" | "runCommand" | "windowsSystemRoot"
  > = {},
): Promise<WindowsProcessTreeInspection> {
  if (!Number.isInteger(expectedRoot.pid) || expectedRoot.pid <= 0) {
    return { rootStatus: "exited", members: [] };
  }
  const result = await runWindowsNativeProcessInspector(
    expectedRoot.pid,
    true,
    dependencies.runCommand,
    {
      ...dependencies,
      deadlineMs:
        dependencies.deadlineMs ??
        Date.now() + WINDOWS_PROCESS_INSPECTION_TIMEOUT_MS,
    },
  );
  if (result.exitCode !== 0 || !result.stdout.trim()) {
    throw new Error("Native Windows process-tree inspection failed.");
  }

  let payload: WindowsProcessTreeJson;
  try {
    payload = JSON.parse(result.stdout) as WindowsProcessTreeJson;
  } catch {
    throw new Error("Native Windows process-tree evidence was malformed.");
  }
  if (
    payload.Status !== "tree" ||
    (payload.RootStatus !== "running" &&
      payload.RootStatus !== "not_running") ||
    !Array.isArray(payload.Processes)
  ) {
    throw new Error("Native Windows process-tree evidence was incomplete.");
  }

  const rows: Array<{
    identity: ProcessFingerprint;
    parentPid: number | null;
  }> = [];
  const seen = new Set<number>();
  for (const value of payload.Processes) {
    if (!value || typeof value !== "object") {
      throw new Error("Native Windows process-tree evidence was incomplete.");
    }
    const pid = Number((value as WindowsProcessJson).ProcessId);
    if (!Number.isInteger(pid) || pid <= 0 || seen.has(pid)) {
      throw new Error("Native Windows process-tree evidence was incomplete.");
    }
    const inspection = parseWindowsProcessJson(JSON.stringify(value), pid);
    if (inspection.status !== "running") {
      throw new Error("Native Windows process-tree evidence was incomplete.");
    }
    const parentPid =
      pid === expectedRoot.pid
        ? null
        : Number((value as WindowsProcessJson).ParentProcessId);
    if (
      pid !== expectedRoot.pid &&
      (parentPid === null ||
        !Number.isInteger(parentPid) ||
        parentPid <= 0 ||
        parentPid === pid)
    ) {
      throw new Error("Native Windows process-tree ancestry was invalid.");
    }
    seen.add(pid);
    rows.push({ identity: inspection.identity, parentPid });
  }

  const byPid = new Map(rows.map((row) => [row.identity.pid, row]));
  const root = byPid.get(expectedRoot.pid)?.identity;
  if (
    payload.RootStatus === "running" &&
    (!root ||
      classifyProcessIdentity(
        expectedRoot,
        { status: "running", identity: root },
        "win32",
      ) !== "owned")
  ) {
    throw new Error("Native Windows process-tree root identity changed.");
  }
  if (payload.RootStatus === "not_running" && root) {
    throw new Error(
      "Native Windows process-tree root evidence was inconsistent.",
    );
  }

  const rootCreatedAtMs = Date.parse(expectedRoot.createdAt);
  if (!Number.isFinite(rootCreatedAtMs)) {
    throw new Error("Native Windows process-tree root identity changed.");
  }
  for (const row of rows) {
    if (row.identity.pid === expectedRoot.pid) {
      continue;
    }
    if (Date.parse(row.identity.createdAt) < rootCreatedAtMs) {
      throw new Error("Native Windows process-tree ancestry was invalid.");
    }

    const visited = new Set<number>([row.identity.pid]);
    let current = row;
    while (current.parentPid !== expectedRoot.pid) {
      if (current.parentPid === null || visited.has(current.parentPid)) {
        throw new Error("Native Windows process-tree ancestry was invalid.");
      }
      visited.add(current.parentPid);
      const parent = byPid.get(current.parentPid);
      if (!parent) {
        throw new Error("Native Windows process-tree ancestry was invalid.");
      }
      if (
        Date.parse(current.identity.createdAt) <
        Date.parse(parent.identity.createdAt)
      ) {
        throw new Error("Native Windows process-tree ancestry was invalid.");
      }
      current = parent;
    }
  }

  const members = rows.map((row) => row.identity);
  return {
    rootStatus: payload.RootStatus === "running" ? "owned" : "exited",
    members: [
      ...members.filter((member) => member.pid !== expectedRoot.pid).reverse(),
      ...(root ? [root] : []),
    ],
  };
}

function isRetryableWindowsTreeSnapshotError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return new Set([
    "Native Windows process-tree inspection failed.",
    "Native Windows process-tree evidence was malformed.",
    "Native Windows process-tree evidence was incomplete.",
    "Native Windows process-tree ancestry was invalid.",
    "Native Windows process-tree root evidence was inconsistent.",
  ]).has(error.message);
}

export async function inspectWindowsProcessTree(
  expectedRoot: ProcessFingerprint,
  dependencies: Pick<
    ProcessInspectorDependencies,
    "deadlineMs" | "signal" | "runCommand" | "windowsSystemRoot"
  > = {},
): Promise<WindowsProcessTreeInspection> {
  if (!Number.isInteger(expectedRoot.pid) || expectedRoot.pid <= 0) {
    return { rootStatus: "exited", members: [] };
  }
  const deadlineMs =
    dependencies.deadlineMs ??
    Date.now() + WINDOWS_PROCESS_INSPECTION_TIMEOUT_MS;
  let lastError: unknown;
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await inspectWindowsProcessTreeOnce(expectedRoot, {
        ...dependencies,
        deadlineMs,
      });
    } catch (error) {
      lastError = error;
      if (
        !isRetryableWindowsTreeSnapshotError(error) ||
        dependencies.signal?.aborted ||
        remainingProcessControlMs(deadlineMs) <= 25
      ) {
        throw error;
      }
      const retryDelayMs = Math.min(
        WINDOWS_PROCESS_TREE_INSPECTION_RETRY_MAX_DELAY_MS,
        25 * 2 ** (attempt - 1),
        Math.max(0, remainingProcessControlMs(deadlineMs) - 25),
      );
      if (retryDelayMs <= 0) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }
  throw lastError;
}

async function inspectDarwinProcess(
  pid: number,
  runCommand: NonNullable<ProcessInspectorDependencies["runCommand"]>,
): Promise<ProcessInspection> {
  try {
    const [started, executable, command] = await Promise.all([
      runCommand("ps", ["-p", String(pid), "-o", "lstart="]),
      runCommand("ps", ["-p", String(pid), "-o", "comm="]),
      runCommand("ps", ["-p", String(pid), "-o", "command="]),
    ]);
    const createdAt = new Date(started.stdout.trim());
    const executablePath = executable.stdout.trim();
    const commandLine = command.stdout.trim();
    if (
      !Number.isFinite(createdAt.getTime()) ||
      !executablePath ||
      !commandLine
    ) {
      return {
        status: "unknown",
        reason: "darwin_process_evidence_incomplete",
      };
    }

    return {
      status: "running",
      identity: {
        pid,
        createdAt: createdAt.toISOString(),
        executablePath: path.normalize(executablePath),
        commandHash: hashProcessCommandLine(commandLine),
      },
    };
  } catch (error) {
    const exitCode = (error as { code?: unknown })?.code;
    return exitCode === 1 || isMissingProcessError(error)
      ? { status: "not_running", reason: "process_not_running" }
      : {
          status: "unknown",
          reason: `darwin_process_inspection_failed:${errorReason(error)}`,
        };
  }
}

export async function inspectProcess(
  pid: number,
  dependencies: ProcessInspectorDependencies = {},
): Promise<ProcessInspection> {
  if (!Number.isInteger(pid) || pid <= 0) {
    return { status: "not_running", reason: "invalid_pid" };
  }

  const platform = dependencies.platform ?? process.platform;
  const readFileDependency =
    dependencies.readFile ??
    ((filePath, encoding) =>
      encoding === undefined ? readFile(filePath) : readFile(filePath, encoding));
  const readlinkDependency = dependencies.readlink ?? readlink;
  const runCommand =
    dependencies.runCommand ??
    (async (command, args, options = {}) => {
      const timeout =
        options.deadlineMs === undefined
          ? undefined
          : Math.max(1, remainingProcessControlMs(options.deadlineMs));
      const result = await execFileAsync(command, args, {
        windowsHide: true,
        signal: options.signal,
        timeout,
        killSignal: "SIGKILL",
      });
      return { stdout: result.stdout };
    });

  if (platform === "linux") {
    const resolution: LinuxProcessPathResolution =
      dependencies.readFile || dependencies.readlink
        ? { status: "resolved", path: `/proc/${pid}` }
        : await resolveLinuxProcessPath(pid);
    if (resolution.status !== "resolved") {
      return resolution;
    }
    return await inspectLinuxProcess(pid, resolution.path, {
      readFile: readFileDependency,
      readlink: readlinkDependency,
      runCommand,
    });
  }
  if (platform === "win32") {
    const cacheCurrentProcessIdentity =
      pid === process.pid &&
      dependencies.platform === undefined &&
      dependencies.runCommand === undefined &&
      dependencies.deadlineMs === undefined &&
      dependencies.signal === undefined &&
      dependencies.windowsSystemRoot === undefined;
    if (cacheCurrentProcessIdentity) {
      const pending =
        windowsCurrentProcessInspectionPromise ??
        inspectWindowsProcess(pid, undefined, {
          deadlineMs: Date.now() + WINDOWS_PROCESS_INSPECTION_TIMEOUT_MS,
        });
      windowsCurrentProcessInspectionPromise = pending;
      try {
        const inspection = await pending;
        if (
          inspection.status !== "running" &&
          windowsCurrentProcessInspectionPromise === pending
        ) {
          windowsCurrentProcessInspectionPromise = null;
        }
        return inspection;
      } catch (error) {
        if (windowsCurrentProcessInspectionPromise === pending) {
          windowsCurrentProcessInspectionPromise = null;
        }
        throw error;
      }
    }
    return await inspectWindowsProcess(pid, dependencies.runCommand, {
      ...dependencies,
      deadlineMs:
        dependencies.deadlineMs ??
        Date.now() + WINDOWS_PROCESS_INSPECTION_TIMEOUT_MS,
    });
  }
  if (platform === "darwin") {
    return await inspectDarwinProcess(pid, runCommand);
  }
  return { status: "unknown", reason: `unsupported_platform:${platform}` };
}

export function classifyProcessIdentity(
  expected: ProcessFingerprint,
  inspection: ProcessInspection,
  platform: NodeJS.Platform = process.platform,
): ProcessIdentityClassification {
  if (inspection.status === "not_running") {
    return "not_running";
  }
  if (inspection.status === "unknown") {
    return "unknown_owner";
  }

  const actual = inspection.identity;
  return expected.pid === actual.pid &&
    expected.createdAt === actual.createdAt &&
    normalizeExecutablePath(expected.executablePath, platform) ===
      normalizeExecutablePath(actual.executablePath, platform) &&
    expected.commandHash === actual.commandHash
    ? "owned"
    : "identity_mismatch";
}
