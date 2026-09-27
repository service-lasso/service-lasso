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
  inspectProcess: (pid: number) => Promise<ProcessInspection>;
}> {
  const currentTree = await (dependencies.inspectTree ?? inspectWindowsProcessTree)(rootIdentity, { deadlineMs, signal });
  const excluded = new Set(currentTree.excludedMemberPids ?? []);
  const retainedMembers = knownMembers.filter(member => !excluded.has(member.pid));
  const currentPids = new Set(currentTree.members.map(identity => identity.pid));
  const members = [
    ...retainedMembers.filter(identity => !currentPids.has(identity.pid)),
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
    // Membership omission is not an exit receipt. Signal-time classification
    // uses fresh immutable identities under the same caller-owned deadline.
    return {
      members,
      verifiedMembersOnly: true,
      inspectProcess: pid => (dependencies.inspectIdentity ?? inspectProcess)(pid, { deadlineMs, signal }),
    };
  }
  const currentByPid = new Map(currentTree.members.map((identity) => [identity.pid, identity]));
  const inspectionByPid = new Map<number, ProcessInspection>(currentTree.members.map((identity) => [
    identity.pid,
    { status: "running", identity },
  ]));
  for (const expected of knownMembers) {
    const actual = currentByPid.get(expected.pid);
    if (!actual) {
      inspectionByPid.set(expected.pid, { status: "not_running", reason: "process_not_running" });
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
    inspectProcess: async (pid) => inspectionByPid.get(pid) ?? {
      status: "not_running",
      reason: "process_not_running",
    },
  };
}
