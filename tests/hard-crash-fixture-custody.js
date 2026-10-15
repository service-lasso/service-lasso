import { mkdir, lstat, mkdtemp, open, readFile, readdir, realpath, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import path from "node:path";
import { holdFixtureRoot } from "./fixture-root-custody.js";
import { verifyDisposableTestFixture, removeDisposableTestFixture } from "./disposable-test-fixture.js";
import { fixturePrivacyScript } from "./fixture-privacy-custody.js";
import { fixturePrivacyBootstrap, createFixturePrivacyDecoder } from "./fixture-privacy-transport.js";

export const FIXTURE_PRIVACY_RESULTS = Object.freeze([
  "not_attempted", "passed", "compiler", "prepare", "acquire", "information",
  "type", "redirect", "security", "owner", "inventory", "identity",
  "descriptor", "protect", "readback", "release", "spawn_unavailable",
  "timeout_unavailable", "response_unavailable", "malformed_response",
  "launch_unavailable", "bootstrap_unavailable",
]);
const nativePrivacyOperations = FIXTURE_PRIVACY_RESULTS.slice(2, 16);
const privacyByError = new WeakMap();
const privacyByBoundary = new WeakMap();
const transportByError = new WeakMap();
const transportByBoundary = new WeakMap();
const weakKey = value => value !== null && (typeof value === "object" || typeof value === "function");
export function fixturePrivacyTransportFailureObservation(error) { return weakKey(error) ? transportByError.get(error) : undefined; }
const privacyObservation = (verification = "not_attempted", protection = "not_attempted") =>
  Object.freeze({ schema: "service-lasso.fixture-privacy-observation.v1", verification, protection });

// Only a string received from our owned child is decoded. No thrown value is
// read, formatted, spread or inspected to classify this diagnostic.
export function decodeFixturePrivacyResponse(stdout) {
  if (typeof stdout !== "string") return undefined;
  // Fixed ordered bytes also reject duplicate keys and trailing output.
  const response = /^\{"schema":"service-lasso\.fixture-privacy-response\.v1","outcome":"(passed|failed)","operation":(null|"[a-z_]+")\}$/.exec(stdout);
  if (!response || response[0].length !== stdout.length) return undefined;
  if (response[1] === "passed" && response[2] === "null") return "passed";
  const operation = response[2].slice(1, -1);
  if (response[1] === "failed" && nativePrivacyOperations.includes(operation)) return operation;
  return undefined;
}
export function fixturePrivacyFailureObservation(error) {
  return (weakKey(error) ? privacyByError.get(error) : undefined) ?? privacyObservation("response_unavailable", "not_attempted");
}
export function classifyFixturePrivacyCompletion(stdout, failed, spawnFailed, timeoutReached) {
  const response = decodeFixturePrivacyResponse(stdout);
  if (timeoutReached === true) return "timeout_unavailable";
  if (response && response !== "passed") return response;
  if (failed === true) {
    if (spawnFailed === true) return "spawn_unavailable";
    if (timeoutReached === true) return "timeout_unavailable";
    return response === "passed" || stdout === "" ? "response_unavailable" : "malformed_response";
  }
  return failed === false && response === "passed" ? "passed" : "malformed_response";
}
const deliverPrivacyObservation = (observe, value, transport) => {
  try { observe(value, transport); } catch { /* Observation never changes privacy authority. */ }
};

// The timer observes the same existing timeout; it adds no retry/deadline or
// process action. Spawn is witnessed by our own child's events, not error.code.
export async function runFixturePrivacy(root, protect, observe, launch = execFile) {
  return await new Promise((resolve, reject) => {
    let spawnFailed = false;
    let timeoutReached = false;
    let timer;
    let child;
    let decoder;
    let spawned = false;
    try {
      const nonce = randomBytes(16).toString("hex");
      const role = protect ? "p" : "v";
      if (Buffer.byteLength(fixturePrivacyScript) > 65_536) throw new Error("Fixture privacy payload exceeds its source bound.");
      decoder = createFixturePrivacyDecoder(nonce, role);
      timer = setTimeout(() => { timeoutReached = true; }, 5_000);
      timer.unref();
      child = launch(path.join(process.env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
        ["-NoProfile", "-NonInteractive", "-Command", fixturePrivacyBootstrap], {
          windowsHide: true, timeout: 5_000, maxBuffer: 16 * 1024,
          env: { ...process.env, SERVICE_LASSO_FIXTURE_EVIDENCE_ROOT: root,
            SERVICE_LASSO_FIXTURE_EVIDENCE_PROTECT: protect ? "1" : "0",
            SERVICE_LASSO_FIXTURE_PRIVACY_NONCE: nonce, SERVICE_LASSO_FIXTURE_PRIVACY_ROLE: role,
            SERVICE_LASSO_FIXTURE_PRIVACY_PAYLOAD: fixturePrivacyScript },
        }, (error, stdout) => {
          clearTimeout(timer);
          let decoded;
          try { decoded = decoder.finish(decodeFixturePrivacyResponse); } catch { /* Diagnostic failure is neutral. */ }
          const result = timeoutReached ? "timeout_unavailable" : spawnFailed || !spawned ? "launch_unavailable" :
            decoded?.observation.state === "malformed" ? "malformed_response" :
            decoded?.response && decoded.response !== "passed" ? decoded.response :
            !error && decoded?.response === "passed" ? "passed" :
            decoded?.observation.events.length === 0 ? "bootstrap_unavailable" : "response_unavailable";
          try { observe(result, decoded?.observation); } catch { /* Never replace the original error. */ }
          if (weakKey(error)) {
            if (decoded) transportByError.set(error, decoded.observation);
            privacyByError.set(error, privacyObservation(protect ? "not_attempted" : result, protect ? result : "not_attempted"));
          }
          if (error) { reject(error); return; }
          if (result !== "passed") {
            const rejected = new Error("Fixture privacy response rejected.");
            privacyByError.set(rejected, privacyObservation(protect ? "not_attempted" : result, protect ? result : "not_attempted"));
            if (decoded) transportByError.set(rejected, decoded.observation);
            reject(rejected); return;
          }
          resolve();
        });
      child.once("error", () => { spawnFailed = true; });
      child.once("spawn", () => { spawned = true; });
      child.stdout?.on("data", chunk => { try { decoder.feed(chunk); } catch { decoder.invalidate(); } });
    } catch (error) {
      clearTimeout(timer);
      try { observe("launch_unavailable"); } catch { /* Preserve construction error identity. */ }
      if (weakKey(error)) privacyByError.set(error, privacyObservation(protect ? "not_attempted" : "launch_unavailable", protect ? "launch_unavailable" : "not_attempted"));
      reject(error);
    }
  });
}
async function evidencePermissions(root, protect, observe = () => {}) {
  if (process.platform === "win32") {
    await runFixturePrivacy(root, protect, observe);
  } else {
    const held = await holdFixtureRoot(root);
    try { if (protect) await held.protect(); else await held.verify(); }
    finally { await held.release(); }
    const info = await lstat(root);
    if (info.uid !== process.getuid() || (info.mode & 0o077) !== 0) throw new Error("Evidence permissions are unresolved.");
  }
}

export async function protectOriginalFixture(root, observe = () => {}, permissions = evidencePermissions) {
  if (process.platform === "win32" || permissions !== evidencePermissions) {
    // Recovered/crash callers may already hold an original whose private DACL
    // is established. Read-only validation requests no DELETE/write access.
    // An unprotected original still requires the separately held mutation path;
    // neither path resets an owner or enables a privilege.
    let verificationResult = "response_unavailable";
    let protectionResult = "not_attempted";
    let verificationTransport = null, protectionTransport = null;
    const deliver = value => deliverPrivacyObservation(observe, value,
      Object.freeze({ verification: verificationTransport, protection: protectionTransport }));
    try {
      await permissions(root, false, (result, transport) => { verificationResult = result; verificationTransport = transport ?? null; });
      deliver(privacyObservation(verificationResult, protectionResult));
      return;
    }
    catch (verification) {
      const first = privacyObservation(verificationResult, protectionResult);
      if (weakKey(verification)) privacyByError.set(verification, first);
      try {
        await permissions(root, true, (result, transport) => { protectionResult = result; protectionTransport = transport ?? null; });
        deliver(privacyObservation(verificationResult, protectionResult));
      } catch (protection) {
        const observation = privacyObservation(verificationResult, protectionResult);
        if (weakKey(protection)) privacyByError.set(protection, observation);
        const error = new AggregateError([verification, protection], "Original fixture privacy is unresolved.");
        transportByError.set(error, Object.freeze({ verification: verificationTransport, protection: protectionTransport }));
        privacyByError.set(error, observation);
        deliver(observation);
        throw error;
      }
    }
  } else await evidencePermissions(root, true);
}
export async function verifyOriginalFixturePrivacy(root, observe = () => {}, permissions = evidencePermissions) {
  await permissions(root, false, (result, transport) => deliverPrivacyObservation(observe, result, transport));
}

export const FIXTURE_INITIALIZATION_STAGES = Object.freeze([
  "initialization_diagnostic_allocate", "initialization_diagnostic_privacy",
  "initialization_original_privacy", "initialization_held_acquire",
  "initialization_original_identity", "initialization_held_verify",
]);
export const FIXTURE_ASSERTION_STAGES = Object.freeze([
  "injection_reader_presence", "injection_reader_read", "injection_reader_empty",
  "injection_owner_read", "injection_owner_identity", "injection_owner_equality",
  "injection_member_equality", "injection_managed_record", "injection_custody_retain",
]);

// Preserve closed fixture bytes outside the recursive removal root. Do not
// follow links into another owner's state. The copy is private local evidence,
// including for a successful row; no copy path is emitted in diagnostics.
export function createFixtureEvidenceBoundary(root, { beforeInitializationStep, disposableFixture } = {}) {
  let evidenceRoot;
  let verified = false;
  let sealedInventory;
  let rootCustody;
  let rootIdentity;
  let diagnosticRoot;
  let initialization;
  let initializationStage;
  let originalRemoved = false;
  let privacy = privacyObservation();
  const stateFailures = [];
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
  const verifyOriginalInventory = async () => {
    await rootCustody.verify();
    const original = await files(root);
    if (JSON.stringify(structure(original)) !== JSON.stringify(sealedInventory.structure)) throw new Error("Original fixture inventory changed before removal.");
    for (const entry of original.filter(entry => !entry.directory)) {
      const expected = sealedInventory.files.find(file => file.path === entry.name);
      const content = await bytes(root, entry);
      if (!expected || content.length !== expected.bytes || createHash("sha256").update(content).digest("hex") !== expected.sha256) throw new Error("Original fixture bytes changed before removal.");
    }
    await rootCustody.verify();
  };
  const boundary = {
    async initialize() {
      initialization ??= (async () => {
        const step = async (stage, action) => {
          initializationStage = stage;
          try {
            await beforeInitializationStep?.(stage, { diagnosticRoot, originalRoot: root });
            return await action();
          }
          catch (cause) {
            const error = new Error("Fixture initialization rejected.", { cause });
            const transport = transportByError.get(cause);
            if (transport) { transportByError.set(error, transport); transportByBoundary.set(boundary, transport); }
            error.fixtureInitializationStage = stage;
            throw error;
          }
        };
        diagnosticRoot = await step("initialization_diagnostic_allocate", () =>
          mkdtemp(path.join(path.dirname(root), `${path.basename(root)}-diagnostics-`)));
        await step("initialization_diagnostic_privacy", () => protectOriginalFixture(diagnosticRoot, value => { privacy = value; privacyByBoundary.set(boundary, value); }));
        await step("initialization_original_privacy", () => protectOriginalFixture(root, value => { privacy = value; privacyByBoundary.set(boundary, value); }));
        rootCustody = await step("initialization_held_acquire", () => holdFixtureRoot(root, diagnosticRoot));
        await step("initialization_original_identity", async () => {
          const info = await lstat(root, { bigint: true });
          rootIdentity = `${info.dev}:${info.ino}`;
        });
        await step("initialization_held_verify", () => rootCustody.verify());
        initializationStage = undefined;
      })();
      await initialization;
    },
    async preserve() {
      await this.initialize();
      await rootCustody.verify();
      if (evidenceRoot) throw new Error("Fixture evidence preservation was already attempted.");
      const manifest = await files(root);
      if (manifest.some((entry) => entry.name === inventoryName)) throw new Error("Reserved fixture inventory path already exists.");
      await evidencePermissions(root, false);
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
      await rootCustody.verify();
      sealedInventory = { rootIdentity, structure: structure(manifest), files: inventory,
        text: JSON.stringify({ rootIdentity, entries: structure(manifest), files: inventory }) };
      await writeFile(path.join(evidenceRoot, inventoryName), sealedInventory.text, { flag: "wx", mode: 0o600 });
      await verifyCopy();
      verified = true;
    },
    async remove(beforeRemoval, afterFinalValidation) {
      if (!verified || !rootCustody) throw new Error("Fixture removal lacks original held custody.");
      // The hook may inject actual filesystem faults, but cannot supply the
      // destructive operation. Recheck original held/named identities after it.
      await beforeRemoval?.();
      await verifyCopy();
      await verifyOriginalInventory();
      await rootCustody.verify();
      // A real regression can intervene at the formerly unsafe last-check to
      // delete/child-acquisition interval. Strong custody still refuses below;
      // ordinary disposable teardown independently revalidates its creator root.
      await afterFinalValidation?.();
      if (disposableFixture) {
        await verifyCopy();
        await verifyOriginalInventory();
        await rootCustody.verify();
        await verifyDisposableTestFixture(disposableFixture, root);
        // Windows directory guardians intentionally hold handles without
        // DELETE sharing. Settle them before ordinary creator-owned teardown.
        await this.release();
        await removeDisposableTestFixture(disposableFixture, root);
      } else await rootCustody.remove();
      originalRemoved = true;
    },
    async release() { if (rootCustody) { const held = rootCustody; rootCustody = undefined; await held.release(); } },
    async retainErrors(errors) {
      // Full exceptions are private retained bytes; public diagnostics below
      // project closed stage names only. Never use a substituted original name.
      if (!diagnosticRoot) throw new Error("Private diagnostic custody is unresolved.");
      await evidencePermissions(diagnosticRoot, false);
      await writeFile(path.join(diagnosticRoot, "fixture-private-errors.json"), JSON.stringify(errors), { flag: "wx", mode: 0o600 });
    },
    async state(removalAttempted) {
      let fixture;
      let originalIdentityAccepted = true;
      if (!originalRemoved && rootCustody) {
        try { await rootCustody.verify(); }
        catch (error) { originalIdentityAccepted = false; stateFailures.push({ stage: "original_identity", error }); }
      }
      try {
        const info = await lstat(root);
        const named = await lstat(root, { bigint: true });
        fixture = !originalIdentityAccepted || !info.isDirectory() || info.isSymbolicLink() || (rootIdentity && `${named.dev}:${named.ino}` !== rootIdentity) ? "unresolved" : removalAttempted ? "partial" : "retained";
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
          } catch (error) { stateFailures.push({ stage: "original_readback", error }); }
        }
      }
      catch (error) { if (error?.code === "ENOENT") fixture = originalRemoved ? "removed" : "unresolved"; else throw error; }
      if (verified) {
        try { await verifyCopy(); } catch (error) { verified = false; stateFailures.push({ stage: "copy_verification", error }); }
      }
      return { fixture, evidence: verified ? "retained" : evidenceRoot ? "unresolved" : "none" };
    },
    // Private test assertion surface, never included in the public projection.
    get evidenceRoot() { return evidenceRoot; },
    get originalRoot() { return root; },
    get removalPolicy() { return disposableFixture ? "test-owned" : "writer-exclusion"; },
    takeStateFailures() { return stateFailures.splice(0); },
    get diagnosticRoot() { return diagnosticRoot; },
    get initializationStage() { return initializationStage; },
    get privacyObservation() { return privacy; },
  };
  privacyByBoundary.set(boundary, privacy);
  return boundary;
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

export async function closeFixture({ primary, primaryStage = "action", failures = [], custody, adapter, restore, reset, remove, report, evidence, recovery = "unknown" }) {
  let result;
  let removalAttempted = false;
  let resetState = "not_attempted";
  let environment = "restored";
  const stages = ["action", "fixture_initialization", ...FIXTURE_INITIALIZATION_STAGES, "crash_spawn", "crash_exit", "interrupted_read", "recovery_inspection", "recovery_startup", "injection_assertions", ...FIXTURE_ASSERTION_STAGES, "post_compensation", "direct_child", "server_stop", "enrollment_observation", "snapshot", "stop", "finalization", "inspection", "absence", "preservation", "removal", "reset", "environment", "custody", "evidence_state", "original_identity", "original_readback", "copy_verification", "privacy", "held_release", "diagnostic", "private_diagnostic"];
  const stageName = (stage) => stages.includes(stage) ? stage : "action";
  const projection = () => Object.fromEntries(stages.map(stage => [stage,
    failures.some(entry => stageName(entry.stage) === stage) || (primary && stageName(primaryStage) === stage) ? "failed" : "clear"]));
  const privateError = (error, seen = new Set()) => {
    if (!error || typeof error !== "object") return String(error);
    if (seen.has(error)) return { kind: "circular" };
    seen.add(error);
    return { name: error.name, message: error.message, stack: error.stack,
      cause: error.cause === undefined ? undefined : privateError(error.cause, seen),
      errors: Array.isArray(error.errors) ? error.errors.map(entry => privateError(entry, seen)) : undefined };
  };
  try {
    try { await evidence.initialize(); }
    catch (error) {
      failures.push({ stage: "fixture_initialization", error });
      if (FIXTURE_INITIALIZATION_STAGES.includes(evidence.initializationStage)) {
        failures.push({ stage: evidence.initializationStage, error });
      }
    }
    result = await custody.settle(adapter);
    failures.push(...result.failures);
    // A failed action retains even successfully settled evidence.
    if (!primary && failures.length === 0 && result.absent) {
      try { await evidence.preserve(); }
      catch (error) { failures.push({ stage: "preservation", error }); }
      if (failures.length === 0) {
        removalAttempted = true;
        try { await evidence.remove(remove); }
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
  failures.push(...evidence.takeStateFailures());
  if (state.fixture !== "removed" && state.fixture !== "unresolved") {
    try { await verifyOriginalFixturePrivacy(evidence.originalRoot); }
    catch (error) { failures.push({ stage: "privacy", error }); }
  }
  try { await evidence.release(); }
  catch (error) { failures.push({ stage: "held_release", error }); }
  if (removalAttempted && state.evidence !== "retained") failures.push({ stage: "evidence_state", error: new Error("Preserved fixture evidence is unresolved.") });
  try { report({ kind: "hard-crash-fixture-custody", recovery,
    removalPolicy: evidence.removalPolicy ?? "writer-exclusion",
    stop: failures.some((entry) => entry.stage === "stop") ? "failed" : "settled",
    finalization: failures.some((entry) => entry.stage === "finalization") ? "failed" : "settled",
    absence: result?.absent ? "proven" : "unresolved", reset: resetState, environment, ...state,
    stages: projection(), privacyObservation: privacyByBoundary.get(evidence) ?? privacyObservation(),
    privacyTransportObservation: transportByBoundary.get(evidence) }); }
  catch (error) { failures.push({ stage: "diagnostic", error }); }
  if (primary || failures.length) {
    try { await evidence.retainErrors([
      ...(primary ? [{ stage: stageName(primaryStage), error: privateError(primary) }] : []),
      ...failures.map(entry => ({ stage: stageName(entry.stage), error: privateError(entry.error) })),
    ]); } catch (error) { failures.push({ stage: "private_diagnostic", error }); }
    // TAP prints this closed message even when it does not render nested errors.
    const aggregate = new AggregateError([...(primary ? [primary] : []), ...failures.map(entry => entry.error)],
      `Hard-crash fixture failed: ${JSON.stringify(projection())}`);
    aggregate.fixtureStages = projection();
    aggregate.fixturePrivacyObservation = privacyByBoundary.get(evidence) ?? privacyObservation();
    aggregate.fixturePrivacyTransportObservation = transportByBoundary.get(evidence);
    throw aggregate;
  }
}
