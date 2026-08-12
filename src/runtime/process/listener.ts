import { execFile as execFileCallback } from "node:child_process";
import { readdir, readFile, readlink } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { promisify } from "node:util";

const execFileAsync = promisify(execFileCallback);
const MAX_PROC_PIDS = 65_536;
const MAX_SOCKET_INODES = 256;
const MAX_DESCRIPTORS_PER_PID = 4_096;
const LINUX_INSPECTION_TIMEOUT_MS = 5_000;

export type TcpListenerProcessInspection =
  | { status: "listening"; pids: number[] }
  | { status: "not_listening" }
  | { status: "unknown"; reason: "inspection_unavailable" | "listener_owner_unverifiable" };

export interface TcpListenerInspectorDependencies {
  platform?: NodeJS.Platform;
  runCommand?: (command: string, args: string[]) => Promise<{ stdout: string }>;
  readdir?: typeof readdir;
  readFile?: typeof readFile;
  readlink?: typeof readlink;
  now?: () => number;
  maxDescriptorsPerPid?: number;
  inspectionTimeoutMs?: number;
}

class InspectionDeadlineExceeded extends Error {}

async function withinDeadline<T>(
  operation: () => Promise<T>,
  deadline: number,
  now: () => number,
): Promise<T> {
  const remainingMs = Math.ceil(deadline - now());
  if (remainingMs <= 0) throw new InspectionDeadlineExceeded();
  let timeout: NodeJS.Timeout | undefined;
  try {
    const result = await Promise.race([
      operation(),
      new Promise<T>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new InspectionDeadlineExceeded()), remainingMs);
      }),
    ]);
    if (now() >= deadline) throw new InspectionDeadlineExceeded();
    return result;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function runCommand(command: string, args: string[]): Promise<{ stdout: string }> {
  const result = await execFileAsync(command, args, {
    windowsHide: true,
    timeout: 5_000,
    maxBuffer: 1024 * 1024,
  });
  return { stdout: result.stdout };
}

function uniquePids(values: number[]): number[] {
  return [...new Set(values.filter((value) => Number.isInteger(value) && value > 0))].sort((left, right) => left - right);
}

function normalizeHost(value: string): string {
  const host = value.trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost") return "127.0.0.1";
  if (host === "::1") return "00000000000000000000000001000000";
  return host;
}

function windowsAddressMatches(candidate: string, expectedHost: string): boolean {
  const expected = normalizeHost(expectedHost);
  const actual = normalizeHost(candidate);
  return actual === expected || actual === "0.0.0.0" || actual === "::";
}

async function inspectWindows(
  host: string,
  port: number,
  execute: NonNullable<TcpListenerInspectorDependencies["runCommand"]>,
): Promise<TcpListenerProcessInspection> {
  try {
    const { stdout } = await execute("netstat.exe", ["-ano", "-p", "tcp"]);
    const pids: number[] = [];
    for (const line of stdout.split(/\r?\n/)) {
      const columns = line.trim().split(/\s+/);
      if (columns.length < 5 || columns[0]?.toUpperCase() !== "TCP" || columns[3]?.toUpperCase() !== "LISTENING") {
        continue;
      }
      const localAddress = columns[1] ?? "";
      const separator = localAddress.lastIndexOf(":");
      if (separator <= 0 || Number(localAddress.slice(separator + 1)) !== port) continue;
      const candidateHost = localAddress.slice(0, separator).replace(/^\[|\]$/g, "");
      if (windowsAddressMatches(candidateHost, host)) pids.push(Number(columns[4]));
    }
    const unique = uniquePids(pids);
    return unique.length > 0 ? { status: "listening", pids: unique } : { status: "not_listening" };
  } catch {
    return { status: "unknown", reason: "inspection_unavailable" };
  }
}

function linuxAddressMatches(encoded: string, expectedHost: string): boolean {
  const expected = normalizeHost(expectedHost);
  if (encoded === "00000000" || encoded === "00000000000000000000000000000000") return true;
  if (expected === "127.0.0.1") return encoded === "0100007F";
  if (expected === "00000000000000000000000001000000") return encoded === expected;
  return true;
}

function linuxListenerInodes(contents: string, host: string, port: number): string[] {
  const expectedPort = port.toString(16).toUpperCase().padStart(4, "0");
  const inodes: string[] = [];
  for (const line of contents.split(/\r?\n/).slice(1)) {
    const columns = line.trim().split(/\s+/);
    if (columns.length < 10 || columns[3] !== "0A") continue;
    const [encodedAddress, encodedPort] = (columns[1] ?? "").split(":");
    if (encodedPort !== expectedPort || !linuxAddressMatches(encodedAddress ?? "", host)) continue;
    if (/^\d+$/.test(columns[9])) inodes.push(columns[9]);
    if (inodes.length >= MAX_SOCKET_INODES) break;
  }
  return [...new Set(inodes)];
}

async function inspectLinux(
  host: string,
  port: number,
  dependencies: TcpListenerInspectorDependencies,
): Promise<TcpListenerProcessInspection> {
  const read = dependencies.readFile ?? readFile;
  const list = dependencies.readdir ?? readdir;
  const link = dependencies.readlink ?? readlink;
  const now = dependencies.now ?? (() => performance.now());
  const timeoutMs = Math.min(
    LINUX_INSPECTION_TIMEOUT_MS,
    Math.max(1, dependencies.inspectionTimeoutMs ?? LINUX_INSPECTION_TIMEOUT_MS),
  );
  const maxDescriptorsPerPid = Math.min(
    MAX_DESCRIPTORS_PER_PID,
    Math.max(1, dependencies.maxDescriptorsPerPid ?? MAX_DESCRIPTORS_PER_PID),
  );
  const deadline = now() + timeoutMs;
  let inodes: string[];
  try {
    const tables = await withinDeadline(
      () => Promise.all([
        read("/proc/net/tcp", "utf8").catch(() => ""),
        read("/proc/net/tcp6", "utf8").catch(() => ""),
      ]),
      deadline,
      now,
    );
    inodes = [...new Set(tables.flatMap((table) => linuxListenerInodes(String(table), host, port)))];
  } catch {
    return { status: "unknown", reason: "inspection_unavailable" };
  }
  if (inodes.length === 0) return { status: "not_listening" };

  const wanted = new Set(inodes.map((inode) => `socket:[${inode}]`));
  const pids: number[] = [];
  let ownerInspectionDenied = false;
  let inspectionBoundExceeded = false;
  try {
    const allCandidates = (await withinDeadline(
      () => list("/proc", { withFileTypes: true }),
      deadline,
      now,
    )).filter((entry) => entry.isDirectory() && /^\d+$/.test(entry.name));
    if (allCandidates.length > MAX_PROC_PIDS) inspectionBoundExceeded = true;
    const candidates = allCandidates.slice(0, MAX_PROC_PIDS);
    for (const candidate of candidates) {
      const fdRoot = `/proc/${candidate.name}/fd`;
      try {
        const descriptors = await withinDeadline(() => list(fdRoot), deadline, now);
        let matched = false;
        for (const descriptor of descriptors.slice(0, maxDescriptorsPerPid)) {
          try {
            if (wanted.has(await withinDeadline(() => link(`${fdRoot}/${descriptor}`), deadline, now))) {
              pids.push(Number(candidate.name));
              matched = true;
              break;
            }
          } catch (error) {
            if (error instanceof InspectionDeadlineExceeded) throw error;
            if ((error as NodeJS.ErrnoException).code === "EACCES") ownerInspectionDenied = true;
          }
        }
        if (!matched && descriptors.length > maxDescriptorsPerPid) inspectionBoundExceeded = true;
      } catch (error) {
        if (error instanceof InspectionDeadlineExceeded) throw error;
        if ((error as NodeJS.ErrnoException).code === "EACCES") ownerInspectionDenied = true;
      }
    }
  } catch {
    return { status: "unknown", reason: "inspection_unavailable" };
  }
  if (inspectionBoundExceeded) return { status: "unknown", reason: "inspection_unavailable" };
  const unique = uniquePids(pids);
  if (unique.length > 0) return { status: "listening", pids: unique };
  return {
    status: "unknown",
    reason: ownerInspectionDenied ? "listener_owner_unverifiable" : "inspection_unavailable",
  };
}

async function inspectDarwin(
  port: number,
  execute: NonNullable<TcpListenerInspectorDependencies["runCommand"]>,
): Promise<TcpListenerProcessInspection> {
  try {
    const { stdout } = await execute("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"]);
    const pids = uniquePids(stdout.split(/\s+/).map(Number));
    return pids.length > 0 ? { status: "listening", pids } : { status: "not_listening" };
  } catch (error) {
    const exitCode = (error as { code?: unknown }).code;
    return exitCode === 1 ? { status: "not_listening" } : { status: "unknown", reason: "inspection_unavailable" };
  }
}

export async function inspectTcpListenerProcesses(
  host: string,
  port: number,
  dependencies: TcpListenerInspectorDependencies = {},
): Promise<TcpListenerProcessInspection> {
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    return { status: "unknown", reason: "inspection_unavailable" };
  }
  const platform = dependencies.platform ?? process.platform;
  const execute = dependencies.runCommand ?? runCommand;
  if (platform === "win32") return await inspectWindows(host, port, execute);
  if (platform === "linux") return await inspectLinux(host, port, dependencies);
  if (platform === "darwin") return await inspectDarwin(port, execute);
  return { status: "unknown", reason: "inspection_unavailable" };
}
