import { spawn } from "node:child_process";
import { readdir, readFile, readlink } from "node:fs/promises";
import {
  classifyProcessIdentity,
  inspectProcess,
  type ProcessFingerprint,
  type ProcessInspection,
} from "./identity.js";
import {
  isProcessControlDeadlineError,
  ProcessControlDeadlineError,
  processControlDeadline,
  remainingProcessControlMs,
  runProcessControlCommand,
  withProcessControlDeadline,
} from "./deadline.js";
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

export interface ProcessTreeControlDependencies {
  platform?: NodeJS.Platform;
  deadlineMs?: number;
  signal?: AbortSignal;
  inspectProcess?: (
    pid: number,
    options?: { deadlineMs?: number; signal?: AbortSignal },
  ) => Promise<ProcessInspection>;
  killProcess?: (pid: number, signal: NodeJS.Signals | 0) => void;
  readFile?: (filePath: string, encoding: BufferEncoding) => Promise<string>;
  readWindowsProcessTable?: (
    options?: { deadlineMs?: number; signal?: AbortSignal },
  ) => Promise<Array<{ pid: number; parentPid: number }>>;
  runWindowsCommand?: (
    command: string,
    args: string[],
    options: { captureOutput: boolean; signal: AbortSignal },
  ) => Promise<{ exitCode: number | null; stdout: string }>;
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
const PRE_SIGNAL_IDENTITY_ATTEMPTS = 3;

export function createSpawnProcessGroup(
  pid: number,
  platform: NodeJS.Platform = process.platform,
): ProcessTreeGroup {
  return platform === "win32"
    ? { kind: "none", id: null }
    : { kind: "posix", id: String(pid) };
}

function isMissingProcessError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException)?.code;
  return code === "ENOENT" || code === "ESRCH";
}

function processInspector(dependencies: ProcessTreeControlDependencies): (pid: number) => Promise<ProcessInspection> {
  return async (pid) => await withProcessControlDeadline(
    async (signal) => dependencies.inspectProcess
      ? await dependencies.inspectProcess(pid, { deadlineMs: dependencies.deadlineMs, signal })
      : await inspectProcess(pid, { deadlineMs: dependencies.deadlineMs, signal }),
    dependencies,
  );
}

function processKiller(dependencies: ProcessTreeControlDependencies): (pid: number, signal: NodeJS.Signals | 0) => void {
  return dependencies.killProcess ?? ((pid, signal) => {
    process.kill(pid, signal);
  });
}

async function verifyPostSignalExit(
  pid: number,
  dependencies: ProcessTreeControlDependencies,
): Promise<boolean> {
  const probePresence = (): "present" | "absent" | "unknown" => {
    try {
      processKiller(dependencies)(pid, 0);
      return "present";
    } catch (error) {
      return isMissingProcessError(error) ? "absent" : "unknown";
    }
  };
  const initialPresence = probePresence();
  if (initialPresence === "absent") {
    return true;
  }
  if (initialPresence === "unknown") {
    return false;
  }

  const platform = dependencies.platform ?? process.platform;
  if (platform === "linux") {
    const readProcessFile = dependencies.readFile ?? ((filePath, encoding) => readFile(filePath, encoding));
    try {
      const stat = await readProcessFile(`/proc/${pid}/stat`, "utf8");
      const commandEnd = stat.lastIndexOf(")");
      if (commandEnd < 0) {
        return false;
      }
      const state = stat.slice(commandEnd + 2).trim().split(/\s+/)[0];
      return state?.toUpperCase().startsWith("Z") === true;
    } catch (error) {
      return isMissingProcessError(error) && probePresence() === "absent";
    }
  }
  return false;
}

async function runWindowsCommand(
  command: string,
  args: string[],
  captureOutput: boolean,
  dependencies: ProcessTreeControlDependencies,
): Promise<{ exitCode: number | null; stdout: string }> {
  return await runProcessControlCommand(command, args, {
    captureOutput,
    deadlineMs: dependencies.deadlineMs,
    signal: dependencies.signal,
    runner: dependencies.runWindowsCommand,
  });
}

async function waitForCommandExit(
  command: string,
  args: string[],
  dependencies: ProcessTreeControlDependencies,
): Promise<boolean> {
  const result = await runWindowsCommand(command, args, false, dependencies);
  return result.exitCode === 0;
}

async function waitForCommandOutput(
  command: string,
  args: string[],
  dependencies: ProcessTreeControlDependencies,
): Promise<string> {
  const result = await runWindowsCommand(command, args, true, dependencies);
  if (result.exitCode !== 0) {
    throw new Error(`Unable to inspect the Windows process table (PowerShell exited ${result.exitCode ?? "unknown"}).`);
  }
  return result.stdout;
}

async function readWindowsProcessTable(
  dependencies: ProcessTreeControlDependencies,
): Promise<WindowsProcessRow[]> {
  const command = [
    "Get-CimInstance Win32_Process",
    "| Select-Object ProcessId,ParentProcessId",
    "| ConvertTo-Json -Compress",
  ].join(" ");
  const stdout = await waitForCommandOutput(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", command],
    dependencies,
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
  const visitedPids = new Set<number>([rootPid]);
  const queue = [...(byParent.get(rootPid) ?? [])];
  while (queue.length > 0) {
    const row = queue.shift();
    if (!row || visitedPids.has(row.pid)) {
      continue;
    }
    visitedPids.add(row.pid);
    descendants.push(row);
    queue.push(...(byParent.get(row.pid) ?? []));
  }
  return descendants;
}

async function requireOwnedIdentity(
  identity: ProcessFingerprint,
  dependencies: ProcessTreeControlDependencies = {},
): Promise<"owned" | "exited"> {
  for (let attempt = 0; attempt < PRE_SIGNAL_IDENTITY_ATTEMPTS; attempt += 1) {
    const classification = classifyProcessIdentity(identity, await processInspector(dependencies)(identity.pid));
    if (classification === "owned") {
      return "owned";
    }
    if (classification === "not_running") {
      return "exited";
    }
    if (classification === "identity_mismatch") {
      break;
    }
    if (attempt + 1 < PRE_SIGNAL_IDENTITY_ATTEMPTS) {
      await new Promise((resolve) => setTimeout(resolve, PROCESS_TREE_POLL_INTERVAL_MS));
    }
  }
  throw new Error(`Cannot verify process ${identity.pid} while controlling its process tree.`);
}

async function requirePostSignalIdentity(
  identity: ProcessFingerprint,
  dependencies: ProcessTreeControlDependencies,
): Promise<"owned" | "exited" | "unverifiable"> {
  const classification = classifyProcessIdentity(identity, await processInspector(dependencies)(identity.pid));
  if (classification === "owned") {
    return "owned";
  }
  if (classification === "not_running") {
    return "exited";
  }
  if (classification === "unknown_owner" && await verifyPostSignalExit(identity.pid, dependencies)) {
    return "exited";
  }
  if (classification === "unknown_owner") {
    return "unverifiable";
  }
  throw new Error(`Cannot verify process ${identity.pid} while controlling its process tree.`);
}

async function inspectTreeMember(
  pid: number,
  label: "descendant" | "process-group member",
  dependencies: ProcessTreeControlDependencies,
): Promise<ProcessFingerprint | null> {
  let lastUnknownReason = "process_identity_unknown";
  for (let attempt = 0; attempt < PRE_SIGNAL_IDENTITY_ATTEMPTS; attempt += 1) {
    const inspection = await processInspector(dependencies)(pid);
    if (inspection.status === "running") {
      return inspection.identity;
    }
    if (inspection.status === "not_running") {
      return null;
    }
    lastUnknownReason = inspection.reason;
    if (attempt + 1 < PRE_SIGNAL_IDENTITY_ATTEMPTS) {
      await new Promise((resolve) => setTimeout(resolve, PROCESS_TREE_POLL_INTERVAL_MS));
    }
  }
  throw new Error(`Cannot verify ${label} process ${pid}: ${lastUnknownReason}.`);
}

async function captureVerifiedMembers(
  target: OwnedProcessTreeTarget,
  dependencies: ProcessTreeControlDependencies = {},
): Promise<ProcessFingerprint[]> {
  if (!target.rootIdentity) {
    throw new Error(`Cannot control legacy process tree ${target.rootPid} without verified root identity.`);
  }
  if (await requireOwnedIdentity(target.rootIdentity, dependencies) === "exited") {
    return [];
  }

  const rows = (dependencies.platform ?? process.platform) === "win32"
    ? dependencies.readWindowsProcessTable
      ? await withProcessControlDeadline(
          async (signal) => await dependencies.readWindowsProcessTable?.({
            deadlineMs: dependencies.deadlineMs,
            signal,
          }) ?? [],
          dependencies,
        )
      : await readWindowsProcessTable(dependencies)
    : activeRows(await readPosixProcessTable());
  const descendantRows = collectDescendantRows(rows, target.rootPid);
  const descendants: ProcessFingerprint[] = [];
  for (const row of descendantRows) {
    const identity = await inspectTreeMember(row.pid, "descendant", dependencies);
    if (identity) {
      descendants.push(identity);
    }
  }
  return [...descendants.reverse(), target.rootIdentity];
}

export async function captureOwnedProcessTreeMembers(
  target: OwnedProcessTreeTarget,
  dependencies: ProcessTreeControlDependencies = {},
): Promise<ProcessFingerprint[]> {
  if ((dependencies.platform ?? process.platform) === "win32") {
    return await captureVerifiedMembers(target, dependencies);
  }

  const processGroupId = target.processGroup.kind === "posix"
    ? Number(target.processGroup.id)
    : Number.NaN;
  if (Number.isInteger(processGroupId) && processGroupId > 0 && processGroupId === target.rootPid) {
    const rows = activeRows(await readPosixProcessTable())
      .filter((row) => row.processGroupId === processGroupId);
    const members: ProcessFingerprint[] = [];
    for (const row of rows) {
      const identity = await inspectTreeMember(row.pid, "process-group member", dependencies);
      if (identity) {
        members.push(identity);
      }
    }
    return members;
  }

  return await captureVerifiedMembers(target, dependencies);
}

async function signalVerifiedMembers(
  members: ProcessFingerprint[],
  signal: "SIGTERM" | "SIGKILL",
  dependencies: ProcessTreeControlDependencies,
  signalAlreadyAuthorized = false,
): Promise<void> {
  for (const member of members) {
    const identityState = signalAlreadyAuthorized
      ? await requirePostSignalIdentity(member, dependencies)
      : await requireOwnedIdentity(member, dependencies);
    if (identityState === "unverifiable") {
      throw new Error(`Cannot verify process ${member.pid} while controlling its process tree.`);
    }
    if (identityState !== "owned") {
      continue;
    }
    try {
      processKiller(dependencies)(member.pid, signal);
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
  dependencies: ProcessTreeControlDependencies,
): Promise<ProcessTreeSignalEvidence> {
  if ((dependencies.platform ?? process.platform) === "win32") {
    if (!target.rootExitObserved && !target.rootIdentity) {
      throw new Error(`Cannot control legacy process tree ${target.rootPid} without verified root identity.`);
    }
    const rootStatus = target.rootExitObserved
      ? "exited"
      : await requireOwnedIdentity(target.rootIdentity as ProcessFingerprint, dependencies);
    const members = target.knownMembers && target.knownMembers.length > 0
      ? target.knownMembers.filter((member) => !target.rootExitObserved || member.pid !== target.rootPid)
      : target.rootIdentity && rootStatus === "owned"
        // `taskkill /T` owns descendant discovery for a still-live, identity-
        // verified root. Retain the root as post-signal evidence without
        // blocking a caller stop on another full-table CIM scan; the Windows
        // monitor keeps the richer descendant snapshot for root-exit cleanup.
        ? [target.rootIdentity]
        : [];
    if (rootStatus === "exited") {
      await signalVerifiedMembers(members, signal, dependencies);
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
      commandSucceeded: await waitForCommandExit("taskkill", args, dependencies),
    };
  }

  const processGroupId = target.processGroup.kind === "posix"
    ? Number(target.processGroup.id)
    : Number.NaN;
  if (Number.isInteger(processGroupId) && processGroupId > 0 && processGroupId === target.rootPid) {
    try {
      processKiller(dependencies)(-processGroupId, signal);
    } catch (error) {
      if (!isMissingProcessError(error)) {
        throw error;
      }
    }
    return { kind: "posix-group", rootPid: target.rootPid, processGroupId };
  }

  const members = target.knownMembers && target.knownMembers.length > 0
    ? target.knownMembers
    : await captureVerifiedMembers(target, dependencies);
  await signalVerifiedMembers(members, signal, dependencies);
  return { kind: "verified-members", rootPid: target.rootPid, members };
}

async function hasRunningEvidence(
  evidence: ProcessTreeSignalEvidence,
  dependencies: ProcessTreeControlDependencies,
): Promise<boolean> {
  if (evidence.kind === "posix-group") {
    const rows = activeRows(await readPosixProcessTable());
    return rows.some((row) => row.processGroupId === evidence.processGroupId);
  }

  if (evidence.kind === "windows-taskkill") {
    if (!evidence.commandSucceeded) {
      return true;
    }
    if (!evidence.rootIdentity && evidence.members.length === 0) {
      return false;
    }
    for (const member of evidence.members) {
      if (await requirePostSignalIdentity(member, dependencies) !== "exited") {
        return true;
      }
    }
    return false;
  }

  for (const member of evidence.members) {
    if (await requirePostSignalIdentity(member, dependencies) !== "exited") {
      return true;
    }
  }
  return false;
}

async function waitForProcessTreeExit(
  evidence: ProcessTreeSignalEvidence,
  deadlineMs: number,
  dependencies: ProcessTreeControlDependencies,
): Promise<boolean> {
  while (true) {
    if (!await hasRunningEvidence(evidence, dependencies)) {
      return true;
    }
    const remainingMs = remainingProcessControlMs(deadlineMs);
    if (remainingMs <= 0) {
      return false;
    }
    await new Promise((resolve) => setTimeout(resolve, Math.min(PROCESS_TREE_POLL_INTERVAL_MS, remainingMs)));
  }
}

async function forceSignaledProcessTree(
  evidence: ProcessTreeSignalEvidence,
  dependencies: ProcessTreeControlDependencies,
): Promise<ProcessTreeSignalEvidence> {
  if (evidence.kind === "posix-group") {
    try {
      processKiller(dependencies)(-evidence.processGroupId, "SIGKILL");
    } catch (error) {
      if (!isMissingProcessError(error)) {
        throw error;
      }
    }
    return evidence;
  }

  if (evidence.kind === "windows-taskkill") {
    const rootState = evidence.rootIdentity
      ? await requirePostSignalIdentity(evidence.rootIdentity, dependencies)
      : "owned";
    if (rootState === "unverifiable") {
      throw new Error(`Cannot verify process ${evidence.rootPid} while controlling its process tree.`);
    }
    const rootStillOwned = rootState === "owned";
    const commandSucceeded = rootStillOwned
      ? await waitForCommandExit(
          "taskkill",
          ["/pid", String(evidence.rootPid), "/t", "/f"],
          dependencies,
        )
      : evidence.commandSucceeded;
    await signalVerifiedMembers(evidence.members, "SIGKILL", dependencies, true);
    return {
      ...evidence,
      commandSucceeded,
    };
  }

  await signalVerifiedMembers(evidence.members, "SIGKILL", dependencies, true);
  return evidence;
}

export async function terminateOwnedProcessTree(
  target: OwnedProcessTreeTarget,
  timeoutMs: number,
  dependencies: ProcessTreeControlDependencies = {},
): Promise<ProcessTreeTerminationResult> {
  const deadlineMs = processControlDeadline(timeoutMs, dependencies.deadlineMs);
  const initialRemainingMs = remainingProcessControlMs(deadlineMs);
  if (initialRemainingMs <= 0) {
    throw new ProcessControlDeadlineError();
  }
  const gracefulDeadlineMs = Math.min(
    deadlineMs,
    Date.now() + Math.max(1, Math.floor(initialRemainingMs / 2)),
  );
  const gracefulDependencies: ProcessTreeControlDependencies = {
    ...dependencies,
    deadlineMs: gracefulDeadlineMs,
  };
  let gracefulEvidence: ProcessTreeSignalEvidence | null = null;
  try {
    gracefulEvidence = await signalOwnedProcessTree(target, "SIGTERM", gracefulDependencies);
    if (await waitForProcessTreeExit(gracefulEvidence, gracefulDeadlineMs, gracefulDependencies)) {
      return { forced: false };
    }
  } catch (error) {
    if (!isProcessControlDeadlineError(error)) {
      throw error;
    }
  }

  if (remainingProcessControlMs(deadlineMs) <= 0) {
    throw new ProcessControlDeadlineError();
  }
  const forcedDependencies: ProcessTreeControlDependencies = {
    ...dependencies,
    deadlineMs,
  };
  const forcedEvidence = gracefulEvidence
    ? await forceSignaledProcessTree(gracefulEvidence, forcedDependencies)
    : await signalOwnedProcessTree(target, "SIGKILL", forcedDependencies);
  if (!await waitForProcessTreeExit(forcedEvidence, deadlineMs, forcedDependencies)) {
    throw new ProcessControlDeadlineError();
  }

  return { forced: true };
}
