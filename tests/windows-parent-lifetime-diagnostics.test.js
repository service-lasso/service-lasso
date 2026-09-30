import assert from "node:assert/strict";
import test from "node:test";
import { hashProcessCommandLine, inspectWindowsProcessTree } from "../dist/runtime/process/identity.js";
import { projectWindowsTreeInspectionMetadata, windowsTreeInspectionFailureMetadata } from "../dist/runtime/process/windows-tree-inspection-diagnostics.js";
import { lifecycleFailureDiagnostic } from "./lifecycle-failure-diagnostics.js";

const root = {
  pid: 4342,
  createdAt: "2026-07-18T01:02:03.456Z",
  executablePath: "C:\\private\\node.exe",
};
const command = "private-command";
const row = (pid, parent, createdAt) => ({
  Status: "running", ProcessId: pid, ParentProcessId: parent, CreationDate: createdAt,
  ExecutablePath: root.executablePath, CommandLine: command,
});

test("a pre-root child with a pre-root parent retains closed parent-birth evidence without process details", async () => {
  const expected = { ...root, commandHash: hashProcessCommandLine(command) };
  const rootRow = row(root.pid, 9000, root.createdAt);
  const cases = [["parent_before_root", [
    row(4343, 4344, "2026-07-18T01:02:01.456Z"),
    row(4344, root.pid, "2026-07-18T01:02:02.456Z"),
  ]]];
  for (const [parentBirthRelation, descendants] of cases) {
    await assert.rejects(inspectWindowsProcessTree(expected, {
      deadlineMs: Date.now() + 140,
      runCommand: async () => ({ stdout: JSON.stringify({
        Status: "tree", RootStatus: "running", Processes: [rootRow, ...descendants],
      }) }),
    }), error => {
      const metadata = windowsTreeInspectionFailureMetadata(error);
      assert.equal(metadata.windowsTreeInspectionLastRetry, "ancestry_predates_parent_before_root");
      assert.equal(metadata.windowsTreeInspectionParentBirthRelation, parentBirthRelation);
      assert.equal(metadata.windowsTreeInspectionChildBirthRelation, "child_before_root");
      assert.equal(metadata.windowsTreeInspectionRootFingerprintMatch, true);
      assert.equal(metadata.windowsTreeInspectionAncestryDepthBucket, "one");
      const diagnostic = lifecycleFailureDiagnostic({ error: { cause: error } });
      assert.equal(diagnostic.includes("private"), false);
      assert.doesNotMatch(diagnostic, /4342|4343|4344|2026-07/);
      return true;
    });
  }
});

test("an absent root never labels descendant lifetime evidence as fingerprint-matching", async () => {
  const expected = { ...root, commandHash: hashProcessCommandLine(command) };
  await assert.rejects(inspectWindowsProcessTree(expected, {
    deadlineMs: Date.now() + 140,
    runCommand: async () => ({ stdout: JSON.stringify({
      Status: "tree",
      RootStatus: "not_running",
      Processes: [
        row(4343, 4344, "2026-07-18T01:02:01.456Z"),
        row(4344, root.pid, "2026-07-18T01:02:02.456Z"),
      ],
    }) }),
  }), error => {
    const metadata = windowsTreeInspectionFailureMetadata(error);
    assert.equal(metadata.windowsTreeInspectionLastRetry, "ancestry_predates_parent_before_root");
    assert.equal(metadata.windowsTreeInspectionParentBirthRelation, "parent_before_root");
    assert.equal(metadata.windowsTreeInspectionChildBirthRelation, "child_before_root");
    assert.equal(metadata.windowsTreeInspectionRootFingerprintMatch, false);
    assert.equal(metadata.windowsTreeInspectionAncestryDepthBucket, "one");
    const diagnostic = lifecycleFailureDiagnostic({ error: { cause: error } });
    assert.equal(diagnostic.includes("private"), false);
    assert.doesNotMatch(diagnostic, /4342|4343|4344|2026-07/);
    return true;
  });
});

test("the parent-lifetime projector rejects incomplete and arbitrary observations", () => {
  assert.deepEqual(projectWindowsTreeInspectionMetadata({
    windowsTreeInspectionPhase: "native_snapshot",
    windowsTreeInspectionAttempts: 1,
    windowsTreeInspectionRetries: 0,
    windowsTreeInspectionQueueMs: 2,
    windowsTreeInspectionNativeMs: 3,
    windowsTreeInspectionLastRetry: "ancestry_predates_parent_before_root",
    windowsTreeInspectionParentBirthRelation: "parent_before_root",
    windowsTreeInspectionChildBirthRelation: "child_before_root",
    windowsTreeInspectionRootFingerprintMatch: true,
    windowsTreeInspectionAncestryDepthBucket: "two_to_four",
    pid: 4343,
    command: "private-command",
  }), {
    windowsTreeInspectionPhase: "native_snapshot",
    windowsTreeInspectionAttempts: 1,
    windowsTreeInspectionRetries: 0,
    windowsTreeInspectionQueueMs: 2,
    windowsTreeInspectionNativeMs: 3,
    windowsTreeInspectionLastRetry: "ancestry_predates_parent_before_root",
    windowsTreeInspectionParentBirthRelation: "parent_before_root",
    windowsTreeInspectionChildBirthRelation: "child_before_root",
    windowsTreeInspectionRootFingerprintMatch: true,
    windowsTreeInspectionAncestryDepthBucket: "two_to_four",
  });
  assert.deepEqual(projectWindowsTreeInspectionMetadata({
    windowsTreeInspectionPhase: "native_snapshot",
    windowsTreeInspectionLastRetry: "malformed",
    windowsTreeInspectionParentBirthRelation: "private",
  }), {
    windowsTreeInspectionPhase: "native_snapshot",
    windowsTreeInspectionAttempts: null,
    windowsTreeInspectionRetries: null,
    windowsTreeInspectionQueueMs: null,
    windowsTreeInspectionNativeMs: null,
    windowsTreeInspectionLastRetry: "malformed",
  });
});
