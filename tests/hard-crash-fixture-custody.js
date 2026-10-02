import { chmod, mkdir, lstat, mkdtemp, open, readFile, readdir, realpath, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";

const execFileAsync = promisify(execFile);
const privateAclScript = `
$ErrorActionPreference = 'Stop'
$p = $env:SERVICE_LASSO_FIXTURE_EVIDENCE_ROOT
$sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
if ($env:SERVICE_LASSO_FIXTURE_EVIDENCE_PROTECT -eq '1') {
  $acl = New-Object System.Security.AccessControl.DirectorySecurity
  $acl.SetOwner($sid)
  $acl.SetAccessRuleProtection($true, $false)
  foreach ($identity in @($sid, [System.Security.Principal.SecurityIdentifier]::new('S-1-5-18'))) {
    $rule = [System.Security.AccessControl.FileSystemAccessRule]::new($identity, 'FullControl', 'ContainerInherit, ObjectInherit', 'None', 'Allow')
    $acl.AddAccessRule($rule)
  }
  Set-Acl -LiteralPath $p -AclObject $acl
}
$entries = @((Get-Item -LiteralPath $p -Force)) + @(Get-ChildItem -LiteralPath $p -Recurse -Force)
foreach ($entry in $entries) {
  if (($entry.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Unsupported evidence entry' }
  $acl = Get-Acl -LiteralPath $entry.FullName
  if ($acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value -ne $sid.Value) { throw 'Unknown evidence owner' }
  if ($env:SERVICE_LASSO_FIXTURE_EVIDENCE_OWNER_ONLY -eq '1') { continue }
  if ($entry.FullName -eq $p -and -not $acl.AreAccessRulesProtected) { throw 'Unprotected evidence root' }
  $rules = @($acl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]))
  if ($rules.Count -eq 0) { throw 'Missing evidence permissions' }
  foreach ($rule in $rules) {
    if ($rule.IdentityReference.Value -notin @($sid.Value, 'S-1-5-18') -or $rule.AccessControlType -ne 'Allow' -or $rule.FileSystemRights -ne 'FullControl') { throw 'Unprotected evidence permissions' }
  }
}
`;

async function evidencePermissions(root, protect, ownerOnly = false) {
  if (process.platform === "win32") {
    await execFileAsync(path.join(process.env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
      ["-NoProfile", "-NonInteractive", "-Command", privateAclScript], {
        windowsHide: true, timeout: 5_000, maxBuffer: 16 * 1024,
        env: { ...process.env, SERVICE_LASSO_FIXTURE_EVIDENCE_ROOT: root,
          SERVICE_LASSO_FIXTURE_EVIDENCE_PROTECT: protect ? "1" : "0",
          SERVICE_LASSO_FIXTURE_EVIDENCE_OWNER_ONLY: ownerOnly ? "1" : "0" },
        // The original closed fixture must be owned; only the independent copy
        // gets a protected ACL. No original ownership/permissions are mutated.
      });
  } else {
    if (protect) await chmod(root, 0o700);
    const info = await lstat(root);
    if (info.uid !== process.getuid() || (!ownerOnly && (info.mode & 0o077) !== 0)) throw new Error("Evidence permissions are unresolved.");
  }
}

// Preserve closed fixture bytes outside the recursive removal root. Do not
// follow links into another owner's state. The copy is private local evidence,
// including for a successful row; no copy path is emitted in diagnostics.
export function createFixtureEvidenceBoundary(root) {
  let evidenceRoot;
  let verified = false;
  let sealedInventory;
  const inventoryName = "fixture-evidence-inventory.json";
  const identity = (info) => [info.dev, info.ino, info.size, info.mtimeMs, info.ctimeMs].join(":");
  const files = async (directory, relative = "") => {
    const info = await lstat(path.join(directory, relative));
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Fixture evidence root is redirected.");
    if (process.platform !== "win32" && info.uid !== process.getuid()) throw new Error("Fixture directory ownership is unresolved.");
    const resolved = await realpath(path.join(directory, relative));
    const expected = path.resolve(directory, relative);
    if (process.platform === "win32" ? resolved.toLowerCase() !== expected.toLowerCase() : resolved !== expected) throw new Error("Fixture evidence ancestry is redirected.");
    const entries = await readdir(path.join(directory, relative), { withFileTypes: true });
    const result = [];
    for (const entry of entries) {
      const name = path.join(relative, entry.name);
      const info = await lstat(path.join(directory, name));
      if (process.platform !== "win32" && info.uid !== process.getuid()) throw new Error("Fixture file ownership is unresolved.");
      if (info.isSymbolicLink() || (!info.isDirectory() && !info.isFile())) {
        throw new Error("Fixture evidence contains an unsupported entry.");
      }
      result.push({ name, directory: info.isDirectory(), identity: identity(info) });
      if (info.isDirectory()) result.push(...await files(directory, name));
    }
    return result.sort((a, b) => a.name.localeCompare(b.name));
  };
  const structure = (entries) => entries.map(({ name, directory }) => ({ name, directory }));
  const bytes = async (directory, entry) => {
    const filePath = path.join(directory, entry.name);
    const before = await lstat(filePath);
    if (!before.isFile() || before.isSymbolicLink() || identity(before) !== entry.identity) throw new Error("Fixture evidence identity changed.");
    const handle = await open(filePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      if (identity(await handle.stat()) !== entry.identity) throw new Error("Fixture evidence identity changed.");
      const content = await handle.readFile();
      if (identity(await handle.stat()) !== entry.identity || identity(await lstat(filePath)) !== entry.identity) throw new Error("Fixture evidence changed while reading.");
      return content;
    } finally { await handle.close(); }
  };
  const verifyCopy = async () => {
    if (!sealedInventory) throw new Error("Fixture evidence is not sealed.");
    await evidencePermissions(evidenceRoot, false);
    const copy = await files(evidenceRoot);
    if (process.platform !== "win32") {
      for (const entry of copy) {
        if (((await lstat(path.join(evidenceRoot, entry.name))).mode & 0o077) !== 0) throw new Error("Fixture evidence permissions changed.");
      }
    }
    if (JSON.stringify(structure(copy).filter((entry) => entry.name !== inventoryName)) !== JSON.stringify(sealedInventory.structure)) throw new Error("Fixture evidence inventory changed.");
    if (await readFile(path.join(evidenceRoot, inventoryName), "utf8") !== sealedInventory.text) throw new Error("Fixture evidence manifest changed.");
    for (const entry of copy.filter((entry) => !entry.directory && entry.name !== inventoryName)) {
      const content = await bytes(evidenceRoot, entry);
      const expected = sealedInventory.files.find((file) => file.path === entry.name);
      if (content.length !== expected.bytes || createHash("sha256").update(content).digest("hex") !== expected.sha256) throw new Error("Fixture evidence bytes changed.");
    }
  };
  return {
    async preserve() {
      if (evidenceRoot) throw new Error("Fixture evidence preservation was already attempted.");
      const manifest = await files(root);
      if (manifest.some((entry) => entry.name === inventoryName)) throw new Error("Reserved fixture inventory path already exists.");
      await evidencePermissions(root, false, true);
      evidenceRoot = await mkdtemp(path.join(path.dirname(root), `${path.basename(root)}-evidence-`));
      await evidencePermissions(evidenceRoot, true);
      const inventory = [];
      for (const entry of manifest) {
        if (entry.directory) {
          await mkdir(path.join(evidenceRoot, entry.name), { mode: 0o700 });
        } else {
          const original = await bytes(root, entry);
          await writeFile(path.join(evidenceRoot, entry.name), original, { flag: "wx", mode: 0o600 });
          inventory.push({ path: entry.name, bytes: original.length,
            sha256: createHash("sha256").update(original).digest("hex") });
        }
      }
      if (JSON.stringify(manifest) !== JSON.stringify(await files(root))) throw new Error("Fixture evidence inventory changed during preservation.");
      for (const entry of manifest.filter((entry) => !entry.directory)) {
        const content = await bytes(root, entry);
        if (createHash("sha256").update(content).digest("hex") !== inventory.find((file) => file.path === entry.name).sha256) throw new Error("Fixture evidence changed during preservation.");
      }
      if (JSON.stringify(manifest) !== JSON.stringify(await files(root))) throw new Error("Fixture evidence changed before sealing.");
      sealedInventory = { structure: structure(manifest), files: inventory,
        text: JSON.stringify({ entries: structure(manifest), files: inventory }) };
      await writeFile(path.join(evidenceRoot, inventoryName), sealedInventory.text, { flag: "wx", mode: 0o600 });
      await verifyCopy();
      verified = true;
    },
    async state(removalAttempted) {
      let fixture;
      try {
        const info = await lstat(root);
        fixture = !info.isDirectory() || info.isSymbolicLink() ? "unresolved" : removalAttempted ? "partial" : "retained";
        if (removalAttempted && fixture === "partial" && sealedInventory) {
          try {
            const original = await files(root);
            let complete = JSON.stringify(structure(original)) === JSON.stringify(sealedInventory.structure);
            for (const entry of original.filter((entry) => !entry.directory)) {
              const expected = sealedInventory.files.find((file) => file.path === entry.name);
              const content = await bytes(root, entry);
              if (!expected || content.length !== expected.bytes || createHash("sha256").update(content).digest("hex") !== expected.sha256) complete = false;
            }
            if (complete) fixture = "retained";
          } catch { /* A remaining root without complete readback is partial. */ }
        }
      }
      catch (error) { if (error?.code === "ENOENT") fixture = "removed"; else throw error; }
      if (verified) {
        try { await verifyCopy(); } catch { verified = false; }
      }
      return { fixture, evidence: verified ? "retained" : evidenceRoot ? "unresolved" : "none" };
    },
    // Private test assertion surface, never included in the public projection.
    get evidenceRoot() { return evidenceRoot; },
  };
}

// Private evidence stays local. Only the closed summary is public.
export function createFixtureCleanupAdapter(fixture, operations) {
  return {
    snapshot: async () => {
      const read = await operations.readRegistry(fixture.workspaceRoot);
      if (!read?.registry || !["current", "legacy"].includes(read.classification)) {
        throw new Error("Fixture ownership persistence is unresolved.");
      }
      const registry = read.registry;
      // Require the interrupted custody input again during teardown. Even a
      // primary failure before the action's read must not fabricate absence.
      const interrupted = await operations.readInterrupted(fixture.workspaceRoot);
      if (!Array.isArray(interrupted)) throw new Error("Interrupted fixture custody is missing.");
      const members = [...interrupted, ...fixture.custodyReaders.flatMap((read) => read())];
      for (const owner of registry.entries.filter((entry) => entry.ownerType === "service")) {
        if (!owner.identity) {
          if (owner.lifecycleState !== "stopped") throw new Error("Fixture ownership is incomplete.");
          continue;
        }
        members.push(owner.identity);
        const state = await operations.classify(owner);
        if (state === "owned") members.push(...await operations.capture({
          rootPid: owner.pid, rootIdentity: owner.identity, processGroup: owner.processGroup,
        }, { deadlineMs: Date.now() + 5_000 }));
        else if (state !== "not_running") throw new Error("Fixture ownership is unresolved.");
      }
      return members;
    },
    stop: () => operations.stop("matrix-service"),
    finalize: () => operations.finalize("matrix-service", Date.now() + 5_000),
    inspect: async (member) => (await operations.inspect(member.pid, { deadlineMs: Date.now() + 5_000 })).status,
  };
}

export function createFixtureCustody() {
  const members = new Map();
  let incomplete = false;
  return {
    retain(snapshot) {
      if (!Array.isArray(snapshot)) { incomplete = true; throw new Error("Invalid fixture custody snapshot."); }
      for (const member of snapshot) {
        if (!member || !Number.isSafeInteger(member.pid) || member.pid <= 0 ||
          typeof member.createdAt !== "string" || !member.createdAt ||
          typeof member.executablePath !== "string" || !member.executablePath ||
          typeof member.commandHash !== "string" || !/^[a-f0-9]{64}$/i.test(member.commandHash) ||
          Object.keys(member).sort().join(",") !== "commandHash,createdAt,executablePath,pid") {
          incomplete = true;
          throw new Error("Invalid fixture custody member.");
        }
        members.set(JSON.stringify(member), { ...member });
      }
    },
    async settle(adapter) {
      const failures = [];
      const attempt = async (stage, action) => {
        try { return await action(); }
        catch (error) { failures.push({ stage, error }); return undefined; }
      };
      await attempt("snapshot", async () => this.retain(await adapter.snapshot()));
      await attempt("stop", adapter.stop);
      await attempt("finalization", adapter.finalize);
      await attempt("snapshot", async () => this.retain(await adapter.snapshot()));
      let absent = !incomplete && !failures.some((entry) => entry.stage === "snapshot");
      for (const member of members.values()) {
        const status = await attempt("inspection", () => adapter.inspect(member));
        if (status !== "not_running") absent = false;
      }
      if (!absent) failures.push({ stage: "absence", error: new Error("Fixture member custody remains unresolved.") });
      return { failures, absent, memberCount: members.size };
    },
  };
}

export async function closeFixture({ primary, failures = [], custody, adapter, restore, reset, remove, report, evidence, recovery = "unknown" }) {
  let result;
  let removalAttempted = false;
  let resetState = "not_attempted";
  let environment = "restored";
  try {
    result = await custody.settle(adapter);
    failures.push(...result.failures);
    // A failed action retains even successfully settled evidence.
    if (!primary && failures.length === 0 && result.absent) {
      try { await evidence.preserve(); }
      catch (error) { failures.push({ stage: "preservation", error }); }
      if (failures.length === 0) {
        removalAttempted = true;
        try { await remove(); }
        catch (error) { failures.push({ stage: "removal", error }); }
        if (failures.length === 0) {
          try { await reset(); resetState = "reset"; }
          catch (error) { resetState = "failed"; failures.push({ stage: "reset", error }); }
        }
      }
    }
  } catch (error) { failures.push({ stage: "custody", error }); }
  finally {
    try { await restore(); } catch (error) { environment = "failed"; failures.push({ stage: "environment", error }); }
  }
  let state = { fixture: "unresolved", evidence: "unresolved" };
  try { state = await evidence.state(removalAttempted); }
  catch (error) { failures.push({ stage: "evidence_state", error }); }
  if (removalAttempted && state.evidence !== "retained") failures.push({ stage: "evidence_state", error: new Error("Preserved fixture evidence is unresolved.") });
  try { report({ kind: "hard-crash-fixture-custody", recovery,
    stop: failures.some((entry) => entry.stage === "stop") ? "failed" : "settled",
    finalization: failures.some((entry) => entry.stage === "finalization") ? "failed" : "settled",
    absence: result?.absent ? "proven" : "unresolved", reset: resetState, environment, ...state }); }
  catch (error) { failures.push({ stage: "diagnostic", error }); }
  if (primary || failures.length) throw new AggregateError([
    ...(primary ? [primary] : []), ...failures.map((entry) => entry.error),
  ], "Hard-crash fixture action or terminal custody failed.");
}
