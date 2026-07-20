import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, readdir, readlink } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFileCallback);

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
  readFile?: (filePath: string, encoding?: BufferEncoding) => Promise<string | Buffer>;
  readlink?: (filePath: string) => Promise<string>;
  runCommand?: (command: string, args: string[]) => Promise<{ stdout: string }>;
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

async function inspectWindowsProcess(
  pid: number,
  runCommand: NonNullable<ProcessInspectorDependencies["runCommand"]>,
): Promise<ProcessInspection> {
  const command = [
    `$process = Get-CimInstance Win32_Process -Filter \"ProcessId = ${pid}\"`,
    "if ($null -eq $process) { exit 0 }",
    "$result = [pscustomobject]@{",
    "ProcessId = $process.ProcessId",
    "CreationDate = $process.CreationDate.ToUniversalTime().ToString('o')",
    "ExecutablePath = $process.ExecutablePath",
    "CommandLine = $process.CommandLine",
    "}",
    "$result | ConvertTo-Json -Compress",
  ].join("; ");

  try {
    const result = await runCommand("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command]);
    return parseWindowsProcessJson(result.stdout, pid);
  } catch (error) {
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
  const runCommand = dependencies.runCommand ?? (async (command, args) => {
    const result = await execFileAsync(command, args, { windowsHide: true });
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
    return await inspectWindowsProcess(pid, runCommand);
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
