import { spawn } from "node:child_process";
import { readdir, readFile, readlink } from "node:fs/promises";
import {
  classifyProcessIdentity,
  inspectProcess,
  type ProcessFingerprint,
} from "./identity.js";
import type { ProcessOwnershipEntry } from "./registry.js";

type ProcessTreeGroup = ProcessOwnershipEntry["processGroup"];

export interface OwnedProcessTreeTarget {
  rootPid: number;
  rootIdentity: ProcessFingerprint | null;
  processGroup: ProcessTreeGroup;
  knownMembers?: ProcessFingerprint[];
  rootExitObserved?: boolean;
}

export interface ProcessTreeTerminationResult {
  forced: boolean;
}

interface PosixProcessRow {
  pid: number;
  parentPid: number;
  processGroupId: number;
  state: string;
}

interface WindowsProcessRow {
  pid: number;
  parentPid: number;
}

type ProcessTreeSignalEvidence =
  | {
      kind: "posix-group";
      rootPid: number;
      processGroupId: number;
    }
  | {
      kind: "verified-members";
      rootPid: number;
      members: ProcessFingerprint[];
    }
  | {
      kind: "windows-taskkill";
      rootPid: number;
      rootIdentity: ProcessFingerprint | null;
      members: ProcessFingerprint[];
      commandSucceeded: boolean;
    };

const PROCESS_TREE_POLL_INTERVAL_MS = 25;

export function createSpawnProcessGroup(
  pid: number,
  platform: NodeJS.Platform = process.platform,
): ProcessTreeGroup {
  return platform === "win32"
    ? { kind: "none", id: null }
    : { kind: "posix", id: String(pid) };
}

function isMissingProcessError(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === "ESRCH";
}

async function waitForCommandExit(command: string, args: string[]): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    const child = spawn(command, args, {
      stdio: "ignore",
      windowsHide: true,
    });
    child.once("close", (exitCode) => resolve(exitCode === 0));
    child.once("error", () => resolve(false));
  });
}

async function waitForCommandOutput(command: string, args: string[]): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
    });
    let output = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      output += chunk;
    });
    child.once("close", (exitCode) => {
      if (exitCode === 0) {
        resolve(output);
      } else {
        reject(new Error(`Unable to inspect the Windows process table (PowerShell exited ${exitCode ?? "unknown"}).`));
      }
    });
    child.once("error", reject);
  });
}

async function readWindowsProcessTable(): Promise<WindowsProcessRow[]> {
  const command = [
    "Get-CimInstance Win32_Process",
    "| Select-Object ProcessId,ParentProcessId",
    "| ConvertTo-Json -Compress",
  ].join(" ");
  const stdout = await waitForCommandOutput(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", command],
  );
  if (!stdout.trim()) {
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error("Unable to parse the Windows process table.");
  }
  const entries = Array.isArray(parsed) ? parsed : [parsed];
  return entries.flatMap((entry) => {
    if (!entry || typeof entry !== "object") {
      return [];
    }
    const candidate = entry as { ProcessId?: unknown; ParentProcessId?: unknown };
    const pid = Number(candidate.ProcessId);
    const parentPid = Number(candidate.ParentProcessId);
    return Number.isInteger(pid) && pid > 0 && Number.isInteger(parentPid) && parentPid >= 0
      ? [{ pid, parentPid }]
      : [];
  });
}

async function readPsProcessTable(): Promise<PosixProcessRow[]> {
  const stdout = await new Promise<string>((resolve, reject) => {
    const child = spawn("ps", ["-axo", "pid=,ppid=,pgid=,state="], {
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
    });
    let output = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      output += chunk;
    });
    child.once("close", (exitCode) => {
      if (exitCode === 0) {
        resolve(output);
      } else {
        reject(new Error(`Unable to inspect the POSIX process table (ps exited ${exitCode ?? "unknown"}).`));
      }
    });
    child.once("error", reject);
  });

  return stdout.split(/\r?\n/).flatMap((line) => {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(\S+)/);
    if (!match) {
      return [];
    }
    return [{
      pid: Number(match[1]),
      parentPid: Number(match[2]),
      processGroupId: Number(match[3]),
      state: match[4],
    }];
  });
}

function parseStatusNamespaceId(status: string, field: "NSpid" | "NSpgid"): number | null {
  const match = status.match(new RegExp(`^${field}:\\s+([\\d\\s]+)$`, "m"));
  if (!match) {
    return null;
  }
  const ids = match[1].trim().split(/\s+/).map(Number).filter(Number.isFinite);
  return ids.at(-1) ?? null;
}

async function readLinuxProcessTable(): Promise<PosixProcessRow[]> {
  const currentPidNamespace = await readlink("/proc/self/ns/pid");
  const entries = (await readdir("/proc", { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && /^\d+$/.test(entry.name));
  const candidates = await Promise.all(entries.map(async (entry) => {
    const processPath = `/proc/${entry.name}`;
    try {
      const [stat, status, pidNamespace] = await Promise.all([
        readFile(`${processPath}/stat`, "utf8"),
        readFile(`${processPath}/status`, "utf8"),
        readlink(`${processPath}/ns/pid`),
      ]);
      if (pidNamespace !== currentPidNamespace) {
        return null;
      }
      const commandEnd = stat.lastIndexOf(")");
      if (commandEnd < 0) {
        return null;
      }
      const fields = stat.slice(commandEnd + 2).trim().split(/\s+/);
      const namespacePid = parseStatusNamespaceId(status, "NSpid");
      const namespaceProcessGroupId = parseStatusNamespaceId(status, "NSpgid");
      const hostParentPid = Number(fields[1]);
      if (!namespacePid || !namespaceProcessGroupId || !Number.isInteger(hostParentPid)) {
        return null;
      }
      return {
        hostPid: Number(entry.name),
        hostParentPid,
        pid: namespacePid,
        processGroupId: namespaceProcessGroupId,
        state: fields[0] ?? "?",
      };
    } catch {
      return null;
    }
  }));
  const present = candidates.filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== null);
  const namespacePidByHostPid = new Map(present.map((candidate) => [candidate.hostPid, candidate.pid]));
  return present.map((candidate) => ({
    pid: candidate.pid,
    parentPid: namespacePidByHostPid.get(candidate.hostParentPid) ?? 0,
    processGroupId: candidate.processGroupId,
    state: candidate.state,
  }));
}

async function readPosixProcessTable(): Promise<PosixProcessRow[]> {
  return process.platform === "linux"
    ? await readLinuxProcessTable()
    : await readPsProcessTable();
}

function activeRows(rows: PosixProcessRow[]): PosixProcessRow[] {
  return rows.filter((row) => !row.state.toUpperCase().startsWith("Z"));
}

function collectDescendantRows<T extends { pid: number; parentPid: number }>(rows: T[], rootPid: number): T[] {
  const byParent = new Map<number, T[]>();
  for (const row of rows) {
    const children = byParent.get(row.parentPid) ?? [];
    children.push(row);
    byParent.set(row.parentPid, children);
  }

  const descendants: T[] = [];
  const queue = [...(byParent.get(rootPid) ?? [])];
  while (queue.length > 0) {
    const row = queue.shift();
    if (!row) {
      continue;
    }
    descendants.push(row);
    queue.push(...(byParent.get(row.pid) ?? []));
  }
  return descendants;
}

async function requireOwnedIdentity(identity: ProcessFingerprint): Promise<"owned" | "exited"> {
  const classification = classifyProcessIdentity(identity, await inspectProcess(identity.pid));
  if (classification === "owned") {
    return "owned";
  }
  if (classification === "not_running" || classification === "identity_mismatch") {
    return "exited";
  }
  throw new Error(`Cannot verify process ${identity.pid} while controlling its process tree.`);
}

async function captureVerifiedMembers(target: OwnedProcessTreeTarget): Promise<ProcessFingerprint[]> {
  if (!target.rootIdentity) {
    throw new Error(`Cannot control legacy process tree ${target.rootPid} without verified root identity.`);
  }
  if (await requireOwnedIdentity(target.rootIdentity) === "exited") {
    return [];
  }

  const rows = process.platform === "win32"
    ? await readWindowsProcessTable()
    : activeRows(await readPosixProcessTable());
  const descendantRows = collectDescendantRows(rows, target.rootPid);
  const descendants: ProcessFingerprint[] = [];
  for (const row of descendantRows) {
    const inspection = await inspectProcess(row.pid);
    if (inspection.status === "running") {
      descendants.push(inspection.identity);
      continue;
    }
    if (inspection.status === "unknown") {
      throw new Error(`Cannot verify descendant process ${row.pid}: ${inspection.reason}.`);
    }
  }
  return [...descendants.reverse(), target.rootIdentity];
}

export async function captureOwnedProcessTreeMembers(
  target: OwnedProcessTreeTarget,
): Promise<ProcessFingerprint[]> {
  if (process.platform === "win32") {
    return await captureVerifiedMembers(target);
  }

  const processGroupId = target.processGroup.kind === "posix"
    ? Number(target.processGroup.id)
    : Number.NaN;
  if (Number.isInteger(processGroupId) && processGroupId > 0 && processGroupId === target.rootPid) {
    const rows = activeRows(await readPosixProcessTable())
      .filter((row) => row.processGroupId === processGroupId);
    const members: ProcessFingerprint[] = [];
    for (const row of rows) {
      const inspection = await inspectProcess(row.pid);
      if (inspection.status === "running") {
        members.push(inspection.identity);
      } else if (inspection.status === "unknown") {
        throw new Error(`Cannot verify process-group member ${row.pid}: ${inspection.reason}.`);
      }
    }
    return members;
  }

  return await captureVerifiedMembers(target);
}

async function signalVerifiedMembers(
  members: ProcessFingerprint[],
  signal: "SIGTERM" | "SIGKILL",
): Promise<void> {
  for (const member of members) {
    if (await requireOwnedIdentity(member) !== "owned") {
      continue;
    }
    try {
      process.kill(member.pid, signal);
    } catch (error) {
      if (!isMissingProcessError(error)) {
        throw error;
      }
    }
  }
}

async function signalOwnedProcessTree(
  target: OwnedProcessTreeTarget,
  signal: "SIGTERM" | "SIGKILL",
): Promise<ProcessTreeSignalEvidence> {
  if (process.platform === "win32") {
    const rootStatus = target.rootExitObserved
      ? "exited"
      : target.rootIdentity
      ? await requireOwnedIdentity(target.rootIdentity)
      : "owned";
    const members = target.knownMembers && target.knownMembers.length > 0
      ? target.knownMembers.filter((member) => !target.rootExitObserved || member.pid !== target.rootPid)
      : target.rootIdentity && rootStatus === "owned"
        ? await captureVerifiedMembers(target)
        : [];
    if (rootStatus === "exited") {
      await signalVerifiedMembers(members, signal);
      return {
        kind: "verified-members",
        rootPid: target.rootPid,
        members,
      };
    }
    const args = ["/pid", String(target.rootPid), "/t"];
    if (signal === "SIGKILL") {
      args.push("/f");
    }
    return {
      kind: "windows-taskkill",
      rootPid: target.rootPid,
      rootIdentity: target.rootIdentity,
      members,
      commandSucceeded: await waitForCommandExit("taskkill", args),
    };
  }

  const processGroupId = target.processGroup.kind === "posix"
    ? Number(target.processGroup.id)
    : Number.NaN;
  if (Number.isInteger(processGroupId) && processGroupId > 0 && processGroupId === target.rootPid) {
    try {
      process.kill(-processGroupId, signal);
    } catch (error) {
      if (!isMissingProcessError(error)) {
        throw error;
      }
    }
    return { kind: "posix-group", rootPid: target.rootPid, processGroupId };
  }

  const members = target.knownMembers && target.knownMembers.length > 0
    ? target.knownMembers
    : await captureVerifiedMembers(target);
  await signalVerifiedMembers(members, signal);
  return { kind: "verified-members", rootPid: target.rootPid, members };
}

async function hasRunningEvidence(evidence: ProcessTreeSignalEvidence): Promise<boolean> {
  if (evidence.kind === "posix-group") {
    const rows = activeRows(await readPosixProcessTable());
    return rows.some((row) => row.processGroupId === evidence.processGroupId);
  }

  if (evidence.kind === "windows-taskkill") {
    if (!evidence.rootIdentity && evidence.members.length === 0) {
      return !evidence.commandSucceeded;
    }
    for (const member of evidence.members) {
      if (await requireOwnedIdentity(member) === "owned") {
        return true;
      }
    }
    return false;
  }

  for (const member of evidence.members) {
    if (await requireOwnedIdentity(member) === "owned") {
      return true;
    }
  }
  return false;
}

async function waitForProcessTreeExit(
  evidence: ProcessTreeSignalEvidence,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + Math.max(0, timeoutMs);
  while (true) {
    if (!await hasRunningEvidence(evidence)) {
      return true;
    }
    if (Date.now() >= deadline) {
      return false;
    }
    await new Promise((resolve) => setTimeout(resolve, PROCESS_TREE_POLL_INTERVAL_MS));
  }
}

async function forceSignaledProcessTree(evidence: ProcessTreeSignalEvidence): Promise<ProcessTreeSignalEvidence> {
  if (evidence.kind === "posix-group") {
    try {
      process.kill(-evidence.processGroupId, "SIGKILL");
    } catch (error) {
      if (!isMissingProcessError(error)) {
        throw error;
      }
    }
    return evidence;
  }

  if (evidence.kind === "windows-taskkill") {
    const rootStillOwned = evidence.rootIdentity
      ? await requireOwnedIdentity(evidence.rootIdentity) === "owned"
      : true;
    const commandSucceeded = rootStillOwned
      ? await waitForCommandExit("taskkill", ["/pid", String(evidence.rootPid), "/t", "/f"])
      : evidence.commandSucceeded;
    await signalVerifiedMembers(evidence.members, "SIGKILL");
    return {
      ...evidence,
      commandSucceeded,
    };
  }

  await signalVerifiedMembers(evidence.members, "SIGKILL");
  return evidence;
}

export async function terminateOwnedProcessTree(
  target: OwnedProcessTreeTarget,
  timeoutMs: number,
): Promise<ProcessTreeTerminationResult> {
  const gracefulEvidence = await signalOwnedProcessTree(target, "SIGTERM");
  if (await waitForProcessTreeExit(gracefulEvidence, timeoutMs)) {
    return { forced: false };
  }

  const forcedEvidence = await forceSignaledProcessTree(gracefulEvidence);
  if (!await waitForProcessTreeExit(forcedEvidence, timeoutMs)) {
    throw new Error(`Process tree rooted at PID ${target.rootPid} did not stop after forced termination.`);
  }
  return { forced: true };
}
