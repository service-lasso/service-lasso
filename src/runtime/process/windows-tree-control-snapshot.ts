import { classifyProcessIdentity, inspectProcess, inspectWindowsProcessTree,
  type ProcessFingerprint, type ProcessInspection } from "./identity.js";

export async function inspectKnownWindowsTreeMembers(
  rootIdentity: ProcessFingerprint,
  knownMembers: ProcessFingerprint[],
  deadlineMs: number,
  signal: AbortSignal,
  verifiedMembersOnly = false,
  dependencies: { inspectTree?: typeof inspectWindowsProcessTree; inspectIdentity?: typeof inspectProcess } = {},
): Promise<{
  members: ProcessFingerprint[];
  verifiedMembersOnly: boolean;
  inspectProcess: (pid: number, options?: { deadlineMs?: number; signal?: AbortSignal }) => Promise<ProcessInspection>;
}> {
  const currentTree = await (dependencies.inspectTree ?? inspectWindowsProcessTree)(rootIdentity, { deadlineMs, signal });
  const excluded = new Set(currentTree.excludedMemberPids ?? []);
  const retainedMembers = knownMembers.filter(member => !excluded.has(member.pid));
  const currentPids = new Set(currentTree.members.map(identity => identity.pid));
  // A tree omission is not an absence receipt. Keep the prior immutable
  // fingerprint until a fresh exact-PID inspection says it is absent; a live,
  // inaccessible, changed, or terminally-unavailable PID stays fail closed.
  const retainedByPid = new Map(retainedMembers
    .filter(identity => !currentPids.has(identity.pid))
    .map(identity => [identity.pid, identity]));
  const currentByPid = new Map(currentTree.members.map((identity) => [identity.pid, identity]));
  const members = [
    ...retainedByPid.values(),
    ...currentTree.members,
  ];
  if (verifiedMembersOnly || currentTree.verifiedMembersOnly) {
    const currentByPid = new Map(currentTree.members.map(identity => [identity.pid, identity]));
    for (const expected of retainedMembers) {
      const actual = currentByPid.get(expected.pid);
      if (actual && classifyProcessIdentity(expected, { status: "running", identity: actual }, "win32") !== "owned") {
        throw new Error(`Cannot verify process ${expected.pid} while controlling its process tree.`);
      }
    }
    return {
      members,
      verifiedMembersOnly: true,
      inspectProcess: async (pid, options) => {
        const current = currentByPid.get(pid);
        if (current) return { status: "running", identity: current };
        return await (dependencies.inspectIdentity ?? inspectProcess)(pid, {
          deadlineMs: Math.min(deadlineMs, options?.deadlineMs ?? deadlineMs),
          signal: options?.signal ?? signal,
        });
      },
    };
  }
  const inspectionByPid = new Map<number, ProcessInspection>(currentTree.members.map((identity) => [
    identity.pid,
    { status: "running", identity },
  ]));
  for (const expected of knownMembers) {
    const actual = currentByPid.get(expected.pid);
    if (!actual) {
      continue;
    }
    if (classifyProcessIdentity(expected, { status: "running", identity: actual }, "win32") !== "owned") {
      throw new Error(`Cannot verify process ${expected.pid} while controlling its process tree.`);
    }
    inspectionByPid.set(expected.pid, { status: "running", identity: actual });
  }
  return {
    members,
    verifiedMembersOnly: false,
    inspectProcess: async (pid, options) => inspectionByPid.get(pid) ?? await (dependencies.inspectIdentity ?? inspectProcess)(pid, {
      deadlineMs: Math.min(deadlineMs, options?.deadlineMs ?? deadlineMs),
      signal: options?.signal ?? signal,
    }),
  };
}
