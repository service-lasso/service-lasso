import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, readdir, readlink } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import {
  isProcessControlDeadlineError,
  remainingProcessControlMs,
  runProcessControlCommand,
} from "./deadline.js";

const execFileAsync = promisify(execFileCallback);
const WINDOWS_PROCESS_INSPECTION_TIMEOUT_MS = 15_000;
const MAX_WINDOWS_PROCESS_INSPECTION_TEST_TIMEOUT_MS = 60_000;
let windowsProcessInspectionTestTimeoutMs: number | null = null;

export interface ProcessFingerprint {
  pid: number;
  createdAt: string;
  executablePath: string;
  commandHash: string;
}

export function setWindowsProcessInspectionTimeoutForTests(timeoutMs: number | null): void {
  if (process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS !== "1") {
    throw new Error("Windows process inspection test timeout requires explicit test hooks.");
  }
  if (
    timeoutMs !== null &&
    (!Number.isInteger(timeoutMs) ||
      timeoutMs < WINDOWS_PROCESS_INSPECTION_TIMEOUT_MS ||
      timeoutMs > MAX_WINDOWS_PROCESS_INSPECTION_TEST_TIMEOUT_MS)
  ) {
    throw new RangeError(
      `Windows process inspection test timeout must be null or an integer from ${WINDOWS_PROCESS_INSPECTION_TIMEOUT_MS} to ${MAX_WINDOWS_PROCESS_INSPECTION_TEST_TIMEOUT_MS}.`,
    );
  }
  windowsProcessInspectionTestTimeoutMs = timeoutMs;
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

interface WindowsNativeProcessJson {
  Status?: unknown;
  ProcessId?: unknown;
  StartTime?: unknown;
  ExecutablePath?: unknown;
}

export interface ProcessInspectorDependencies {
  platform?: NodeJS.Platform;
  readFile?: (filePath: string, encoding?: BufferEncoding) => Promise<string | Buffer>;
  readlink?: (filePath: string) => Promise<string>;
  deadlineMs?: number;
  signal?: AbortSignal;
  runCommand?: (
    command: string,
    args: string[],
    options?: { deadlineMs?: number; signal?: AbortSignal },
  ) => Promise<{ stdout: string }>;
}

function normalizeCommandLine(commandLine: string | readonly string[]): string {
  const value = typeof commandLine === "string" ? commandLine : commandLine.join(" ");
  return value.replace(/\s+/g, " ").trim();
}

export function hashProcessCommandLine(commandLine: string | readonly string[]): string {
  return createHash("sha256").update(normalizeCommandLine(commandLine)).digest("hex");
}

function normalizeExecutablePath(value: string, platform: NodeJS.Platform = process.platform): string {
  const normalized = platform === "win32"
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

  const fieldsAfterCommand = stat.slice(commandEnd + 2).trim().split(/\s+/);
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
  dependencies: Required<Pick<ProcessInspectorDependencies, "readFile" | "readlink" | "runCommand">>,
): Promise<ProcessInspection> {
  try {
    const [statValue, commandValue, procStatValue, executableLink] = await Promise.all([
      dependencies.readFile(`${processPath}/stat`, "utf8"),
      dependencies.readFile(`${processPath}/cmdline`),
      dependencies.readFile("/proc/stat", "utf8"),
      dependencies.readlink(`${processPath}/exe`).catch(() => null),
    ]);
    const stat = String(statValue);
    const procStat = String(procStatValue);
    const commandBuffer = Buffer.isBuffer(commandValue) ? commandValue : Buffer.from(commandValue);
    const commandParts = commandBuffer
      .toString("utf8")
      .split("\0")
      .filter((entry) => entry.length > 0);
    const commandEnd = stat.lastIndexOf(")");
    const fieldsAfterCommand = commandEnd >= 0 ? stat.slice(commandEnd + 2).trim().split(/\s+/) : [];
    if (fieldsAfterCommand[0] === "Z") {
      return { status: "not_running", reason: "process_is_zombie" };
    }
    const executablePath = executableLink?.trim() || commandParts[0] || "";
    const startTicks = parseLinuxStartTicks(stat);
    const bootTimeSeconds = parseLinuxBootTime(procStat);

    if (commandParts.length === 0 || startTicks === null || bootTimeSeconds === null || !executablePath) {
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

    const createdAt = new Date((bootTimeSeconds + startTicks / clockTicks) * 1000).toISOString();
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
      if (!Number.isFinite(createdAt.getTime()) || !executablePath || !commandLine) {
        return { status: "unknown", reason: "linux_ps_process_evidence_incomplete" };
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
  return match ? match[1].trim().split(/\s+/).map(Number).filter(Number.isFinite) : [];
}

type LinuxProcessPathResolution =
  | { status: "resolved"; path: string }
  | { status: "not_running"; reason: string }
  | { status: "unknown"; reason: string };

async function resolveLinuxProcessPath(pid: number): Promise<LinuxProcessPathResolution> {
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
        if (namespacePids.at(-1) === pid && pidNamespace === currentPidNamespace) {
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
        : { status: "unknown", reason: `linux_namespaced_pid_probe_failed:${errorReason(error)}` };
    }
  } catch {
    return { status: "resolved", path: `/proc/${pid}` };
  }
}

interface WindowsProcessJson {
  ProcessId?: unknown;
  CreationDate?: unknown;
  ExecutablePath?: unknown;
  CommandLine?: unknown;
}

function parseWindowsProcessJson(stdout: string, pid: number): ProcessInspection {
  if (!stdout.trim()) {
    return { status: "not_running", reason: "process_not_running" };
  }

  try {
    const value = JSON.parse(stdout) as WindowsProcessJson;
    if (
      Number(value.ProcessId) !== pid ||
      typeof value.CreationDate !== "string" ||
      !Number.isFinite(Date.parse(value.CreationDate)) ||
      typeof value.ExecutablePath !== "string" ||
      !value.ExecutablePath.trim() ||
      typeof value.CommandLine !== "string" ||
      !value.CommandLine.trim()
    ) {
      return { status: "unknown", reason: "windows_process_evidence_incomplete" };
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

function parseWindowsNativeIdentity(
  stdout: string,
  expected: ProcessFingerprint,
): ProcessIdentityClassification {
  if (!stdout.trim()) {
    return "unknown_owner";
  }
  try {
    const value = JSON.parse(stdout) as WindowsNativeProcessJson;
    if (value.Status === "not_running") {
      return "not_running";
    }
    if (
      value.Status !== "running" ||
      Number(value.ProcessId) !== expected.pid ||
      typeof value.StartTime !== "string" ||
      !Number.isFinite(Date.parse(value.StartTime)) ||
      typeof value.ExecutablePath !== "string" ||
      !value.ExecutablePath.trim()
    ) {
      return "unknown_owner";
    }

    // A Windows process creation timestamp identifies the immutable process
    // instance behind a numeric PID. The executable image corroborates that
    // identity; the command line cannot change during the instance lifetime,
    // so the already-persisted command hash need not be re-read through WMI.
    return new Date(value.StartTime).toISOString() === expected.createdAt &&
      normalizeExecutablePath(value.ExecutablePath, "win32") === normalizeExecutablePath(expected.executablePath, "win32")
      ? "owned"
      : "identity_mismatch";
  } catch {
    return "unknown_owner";
  }
}

export async function classifyWindowsProcessIdentityFast(
  expected: ProcessFingerprint,
  dependencies: Pick<ProcessInspectorDependencies, "deadlineMs" | "signal" | "runCommand"> = {},
): Promise<ProcessIdentityClassification> {
  if (!Number.isInteger(expected.pid) || expected.pid <= 0) {
    return "not_running";
  }
  const injectedRunner = dependencies.runCommand;
  const command = [
    `$process = Get-Process -Id ${expected.pid} -ErrorAction SilentlyContinue`,
    "if ($null -eq $process) {",
    "  [pscustomobject]@{ Status = 'not_running' } | ConvertTo-Json -Compress",
    "  exit 0",
    "}",
    "try {",
    "  $result = [pscustomobject]@{",
    "    Status = 'running'",
    "    ProcessId = $process.Id",
    "    StartTime = $process.StartTime.ToUniversalTime().ToString('o')",
    "    ExecutablePath = $process.Path",
    "  }",
    "  $result | ConvertTo-Json -Compress",
    "} catch {",
    "  [pscustomobject]@{ Status = 'unknown' } | ConvertTo-Json -Compress",
    "}",
  ].join("\n");

  try {
    const result = await runProcessControlCommand(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", command],
      {
        captureOutput: true,
        deadlineMs: dependencies.deadlineMs,
        signal: dependencies.signal,
        runner: injectedRunner
          ? async (executable, args, helperOptions) => ({
              exitCode: 0,
              ...(await injectedRunner(executable, args, {
                deadlineMs: dependencies.deadlineMs,
                signal: helperOptions.signal,
              })),
            })
          : undefined,
      },
    );
    return result.exitCode === 0
      ? parseWindowsNativeIdentity(result.stdout, expected)
      : "unknown_owner";
  } catch (error) {
    if (isProcessControlDeadlineError(error)) {
      throw error;
    }
    return "unknown_owner";
  }
}

async function inspectWindowsProcess(
  pid: number,
  runCommand: ProcessInspectorDependencies["runCommand"],
  options: Pick<ProcessInspectorDependencies, "deadlineMs" | "signal">,
): Promise<ProcessInspection> {
  const command = [
    `$query = 'SELECT ProcessId, CreationDate, ExecutablePath, CommandLine FROM Win32_Process WHERE ProcessId = ${pid}'`,
    "$searcher = [System.Management.ManagementObjectSearcher]::new($query)",
    "try {",
    "  $process = @($searcher.Get())[0]",
    "  if ($null -eq $process) { exit 0 }",
    "  $result = [pscustomobject]@{",
    "    ProcessId = [int]$process.ProcessId",
    "    CreationDate = [System.Management.ManagementDateTimeConverter]::ToDateTime([string]$process.CreationDate).ToUniversalTime().ToString('o')",
    "    ExecutablePath = [string]$process.ExecutablePath",
    "    CommandLine = [string]$process.CommandLine",
    "  }",
    "  $result | ConvertTo-Json -Compress",
    "} finally {",
    "  $searcher.Dispose()",
    "}",
  ].join("\n");

  try {
    const result = await runProcessControlCommand(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", command],
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
    return parseWindowsProcessJson(result.stdout, pid);
  } catch (error) {
    if (isProcessControlDeadlineError(error)) {
      throw error;
    }
    return isMissingProcessError(error)
      ? { status: "not_running", reason: "process_not_running" }
      : { status: "unknown", reason: `windows_process_inspection_failed:${errorReason(error)}` };
  }
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
    if (!Number.isFinite(createdAt.getTime()) || !executablePath || !commandLine) {
      return { status: "unknown", reason: "darwin_process_evidence_incomplete" };
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
      : { status: "unknown", reason: `darwin_process_inspection_failed:${errorReason(error)}` };
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
  const readFileDependency = dependencies.readFile ?? ((filePath, encoding) => readFile(filePath, encoding));
  const readlinkDependency = dependencies.readlink ?? readlink;
  const runCommand = dependencies.runCommand ?? (async (command, args, options = {}) => {
    const timeout = options.deadlineMs === undefined
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
    const resolution: LinuxProcessPathResolution = dependencies.readFile || dependencies.readlink
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
    return await inspectWindowsProcess(pid, dependencies.runCommand, {
      ...dependencies,
      deadlineMs: dependencies.deadlineMs ?? Date.now() +
        (windowsProcessInspectionTestTimeoutMs ?? WINDOWS_PROCESS_INSPECTION_TIMEOUT_MS),
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
    normalizeExecutablePath(expected.executablePath, platform) === normalizeExecutablePath(actual.executablePath, platform) &&
    expected.commandHash === actual.commandHash
    ? "owned"
    : "identity_mismatch";
}
