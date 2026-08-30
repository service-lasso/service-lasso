import { createHash, randomUUID } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { constants } from "node:fs";
import { chmod, lstat, mkdir, open, rename, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const MAX_PRIVATE_JSON_BYTES = 64 * 1024;
const MAX_PROTECTED_TEXT_BYTES = 256 * 1024;
const WINDOWS_DPAPI_OPERATION_TIMEOUT_MS = 15_000;
const WINDOWS_DPAPI_HELPER_BYTES = 5_120;
const WINDOWS_DPAPI_HELPER_PROVENANCE_BYTES = 722;
const WINDOWS_DPAPI_HELPER_SHA256 = "74608ed9e4733e2102417c9b1b6cc4482b97c99c635e3889f3d90eabdaee3739";
const WINDOWS_DPAPI_HELPER_PROVENANCE_SHA256 = "3b78a4f86988d257347304c836205e57c5049f9b08caf93ba36c7c8c37ad329e";
let currentWindowsSid: Promise<string> | null = null;

export type PrivateJsonErrorCode =
  | "private_state_acl_failed"
  | "private_state_commit_failed"
  | "private_state_protect_failed"
  | "private_state_protect_timeout"
  | "private_state_protect_unavailable"
  | "private_state_sid_failed"
  | "private_state_system_utilities_unavailable"
  | "private_state_unprotect_failed"
  | "private_state_unprotect_timeout"
  | "private_state_unprotect_unavailable";

export class PrivateJsonError extends Error {
  constructor(public readonly code: PrivateJsonErrorCode, message: string) {
    super(message);
    this.name = "PrivateJsonError";
  }
}

function windowsSystemExecutable(...segments: string[]): string {
  const root = process.env.SystemRoot ?? process.env.WINDIR;
  if (!root || !path.win32.isAbsolute(root)) {
    throw new PrivateJsonError("private_state_system_utilities_unavailable", "Windows private-state protection is unavailable.");
  }
  return path.win32.join(path.win32.normalize(root), ...segments);
}

interface WindowsPrivateEnvelope {
  version: 1;
  protection: "windows-dpapi-current-user";
  ciphertext: string;
}

interface UnixPrivateEnvelope {
  version: 1;
  protection: "owner-only-file";
  payload: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertInsideRoot(rootPath: string, targetPath: string): void {
  const root = path.resolve(rootPath);
  const target = path.resolve(targetPath);
  const relative = path.relative(root, target);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Private state path must be a direct descendant of its trusted root.");
  }
}

async function assertNoRedirectedAncestors(rootPath: string, targetPath: string): Promise<void> {
  const root = path.resolve(rootPath);
  const parent = path.dirname(path.resolve(targetPath));
  assertInsideRoot(root, targetPath);
  const relative = path.relative(root, parent);
  let current = root;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    const info = await lstat(current);
    if (!info.isDirectory() || info.isSymbolicLink()) {
      throw new Error("Private state directory is redirected or unsupported.");
    }
  }
}

function isCanonicalBase64(value: string): boolean {
  if (value.length === 0 || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/u.test(value)) return false;
  return Buffer.from(value, "base64").toString("base64") === value;
}

async function assertWindowsDpapiHelperIntegrity(signal: AbortSignal): Promise<string> {
  const helperPath = fileURLToPath(new URL("./windows-dpapi-helper.exe", import.meta.url));
  const provenancePath = fileURLToPath(new URL("./windows-dpapi-helper.provenance.json", import.meta.url));
  const readExactRegularAsset = async (assetPath: string, expectedBytes: number): Promise<Buffer> => {
    signal.throwIfAborted();
    const beforeOpen = await lstat(assetPath);
    signal.throwIfAborted();
    if (!beforeOpen.isFile() || beforeOpen.isSymbolicLink() || beforeOpen.size !== expectedBytes) {
      throw new Error("Windows DPAPI helper asset identity was invalid.");
    }
    const handle = await open(assetPath, constants.O_RDONLY);
    let bytes: Buffer | null = null;
    try {
      signal.throwIfAborted();
      const afterOpen = await handle.stat();
      signal.throwIfAborted();
      if (!afterOpen.isFile() || afterOpen.size !== expectedBytes) {
        throw new Error("Windows DPAPI helper asset identity changed while opening.");
      }
      bytes = await handle.readFile({ signal });
      signal.throwIfAborted();
      const afterRead = await handle.stat();
      signal.throwIfAborted();
      if (!afterRead.isFile() || afterRead.size !== expectedBytes || bytes.length !== expectedBytes) {
        bytes.fill(0);
        bytes = null;
        throw new Error("Windows DPAPI helper asset length was invalid.");
      }
      return bytes;
    } catch (error) {
      bytes?.fill(0);
      throw error;
    } finally {
      await handle.close().catch(() => undefined);
    }
  };
  let helperBytes: Buffer | null = null;
  let provenanceBytes: Buffer | null = null;
  try {
    helperBytes = await readExactRegularAsset(helperPath, WINDOWS_DPAPI_HELPER_BYTES);
    provenanceBytes = await readExactRegularAsset(provenancePath, WINDOWS_DPAPI_HELPER_PROVENANCE_BYTES);
    const helperSha256 = createHash("sha256").update(helperBytes).digest("hex");
    const provenanceSha256 = createHash("sha256").update(provenanceBytes).digest("hex");
    if (
      helperSha256 !== WINDOWS_DPAPI_HELPER_SHA256 ||
      provenanceSha256 !== WINDOWS_DPAPI_HELPER_PROVENANCE_SHA256
    ) {
      throw new Error("Windows DPAPI helper integrity verification failed.");
    }
    return helperPath;
  } finally {
    helperBytes?.fill(0);
    provenanceBytes?.fill(0);
  }
}

async function runWindowsDpapiHelper(operation: "protect" | "unprotect", input: string): Promise<string> {
  const code = (suffix: "failed" | "timeout" | "unavailable"): PrivateJsonErrorCode =>
    `private_state_${operation}_${suffix}` as PrivateJsonErrorCode;
  const deadline = Date.now() + WINDOWS_DPAPI_OPERATION_TIMEOUT_MS;
  const integrityAbort = new AbortController();
  let integrityTimeout: NodeJS.Timeout;
  const integrityDeadline = new Promise<never>((_resolve, reject) => {
    integrityTimeout = setTimeout(() => {
      integrityAbort.abort();
      reject(new PrivateJsonError(code("timeout"), "Windows private-state protection timed out."));
    }, WINDOWS_DPAPI_OPERATION_TIMEOUT_MS);
    integrityTimeout.unref?.();
  });
  let helperPath: string;
  try {
    helperPath = await Promise.race([
      assertWindowsDpapiHelperIntegrity(integrityAbort.signal),
      integrityDeadline,
    ]);
  } catch (error) {
    const timedOut = integrityAbort.signal.aborted ||
      (error instanceof PrivateJsonError && error.code === code("timeout"));
    integrityAbort.abort();
    if (timedOut) {
      throw new PrivateJsonError(code("timeout"), "Windows private-state protection timed out.");
    }
    throw new PrivateJsonError(code("unavailable"), "Windows private-state protection is unavailable.");
  } finally {
    clearTimeout(integrityTimeout!);
  }
  const remainingMs = deadline - Date.now();
  if (remainingMs <= 0) {
    throw new PrivateJsonError(code("timeout"), "Windows private-state protection timed out.");
  }
  return await new Promise((resolve, reject) => {
    const child = spawn(helperPath, [operation], {
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    let outputBytes = 0;
    let settled = false;
    const remainingAfterSpawnMs = deadline - Date.now();
    if (remainingAfterSpawnMs <= 0) {
      settled = true;
      child.once("error", () => undefined);
      child.stdout.resume();
      child.stderr.resume();
      child.kill();
      reject(new PrivateJsonError(code("timeout"), "Windows private-state protection timed out."));
      return;
    }
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(new PrivateJsonError(code("timeout"), "Windows private-state protection timed out."));
    }, remainingAfterSpawnMs);
    timeout.unref?.();
    child.stdout.on("data", (chunk: Buffer) => {
      outputBytes += chunk.length;
      if (outputBytes <= MAX_PROTECTED_TEXT_BYTES) stdout.push(chunk);
    });
    child.stderr.resume();
    child.once("error", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(new PrivateJsonError(code("unavailable"), "Windows private-state protection is unavailable."));
    });
    child.once("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      const output = Buffer.concat(stdout).toString("utf8");
      if (code !== 0 || outputBytes > MAX_PROTECTED_TEXT_BYTES || !isCanonicalBase64(output)) {
        reject(new PrivateJsonError(
          operation === "protect" ? "private_state_protect_failed" : "private_state_unprotect_failed",
          "Windows private-state protection failed.",
        ));
        return;
      }
      resolve(output);
    });
    child.stdin.on("error", () => undefined);
    child.stdin.end(input);
  });
}

async function protectWindows(plaintext: Buffer): Promise<string> {
  return await runWindowsDpapiHelper("protect", plaintext.toString("base64"));
}

async function unprotectWindows(ciphertext: string): Promise<Buffer> {
  return Buffer.from(await runWindowsDpapiHelper("unprotect", ciphertext), "base64");
}

async function windowsSid(): Promise<string> {
  currentWindowsSid ??= execFileAsync(windowsSystemExecutable("System32", "whoami.exe"), ["/user", "/fo", "csv", "/nh"], {
    windowsHide: true,
    maxBuffer: 16 * 1024,
  }).then(({ stdout }) => {
    const match = stdout.match(/,"(S-\d+(?:-\d+)+)"\s*$/iu);
    if (!match) throw new PrivateJsonError("private_state_sid_failed", "Cannot resolve the current Windows user for private state.");
    return match[1];
  }).catch((error: unknown) => {
    if (error instanceof PrivateJsonError) throw error;
    throw new PrivateJsonError("private_state_sid_failed", "Cannot resolve the current Windows user for private state.");
  });
  return await currentWindowsSid;
}

async function enforcePrivatePermissions(filePath: string): Promise<void> {
  try {
    await chmod(filePath, 0o600);
    if (process.platform !== "win32") return;
    const sid = await windowsSid();
    await execFileAsync(windowsSystemExecutable("System32", "icacls.exe"), [
      filePath,
      "/inheritance:r",
      "/grant:r",
      `*${sid}:(F)`,
      "*S-1-5-18:(F)",
    ], { windowsHide: true, maxBuffer: 64 * 1024 });
  } catch (error) {
    if (error instanceof PrivateJsonError) throw error;
    throw new PrivateJsonError("private_state_acl_failed", "Private state permissions could not be enforced.");
  }
}

async function serializePrivateJson(value: unknown): Promise<Buffer> {
  const plaintext = Buffer.from(JSON.stringify(value), "utf8");
  if (plaintext.length === 0 || plaintext.length > MAX_PRIVATE_JSON_BYTES) {
    plaintext.fill(0);
    throw new Error("Private state payload is invalid or oversized.");
  }
  if (process.platform !== "win32") {
    const envelope: UnixPrivateEnvelope = { version: 1, protection: "owner-only-file", payload: value };
    plaintext.fill(0);
    return Buffer.from(`${JSON.stringify(envelope)}\n`, "utf8");
  }
  try {
    const envelope: WindowsPrivateEnvelope = {
      version: 1,
      protection: "windows-dpapi-current-user",
      ciphertext: await protectWindows(plaintext),
    };
    return Buffer.from(`${JSON.stringify(envelope)}\n`, "utf8");
  } finally {
    plaintext.fill(0);
  }
}

export async function writePrivateJson(rootPath: string, targetPath: string, value: unknown): Promise<void> {
  assertInsideRoot(rootPath, targetPath);
  const parent = path.dirname(path.resolve(targetPath));
  await mkdir(parent, { recursive: true, mode: 0o700 });
  await assertNoRedirectedAncestors(rootPath, targetPath);
  const bytes = await serializePrivateJson(value);
  const tempPath = `${targetPath}.${process.pid}.${randomUUID()}.tmp`;
  let handle;
  try {
    handle = await open(tempPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await enforcePrivatePermissions(tempPath);
    await rename(tempPath, targetPath);
    await enforcePrivatePermissions(targetPath);
  } catch (error) {
    if (error instanceof PrivateJsonError) throw error;
    throw new PrivateJsonError("private_state_commit_failed", "Private state could not be committed.");
  } finally {
    bytes.fill(0);
    await handle?.close().catch(() => undefined);
    await rm(tempPath, { force: true }).catch(() => undefined);
  }
}

export async function readPrivateJson(rootPath: string, targetPath: string): Promise<unknown | null> {
  assertInsideRoot(rootPath, targetPath);
  let info;
  try {
    info = await lstat(targetPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new Error("Private state is unavailable.");
  }
  if (!info.isFile() || info.isSymbolicLink() || info.size <= 0 || info.size > MAX_PROTECTED_TEXT_BYTES) {
    throw new Error("Private state file is redirected, invalid, or oversized.");
  }
  await assertNoRedirectedAncestors(rootPath, targetPath);
  const handle = await open(targetPath, constants.O_RDONLY);
  let bytes: Buffer;
  try {
    const afterOpen = await handle.stat();
    if (!afterOpen.isFile() || afterOpen.size !== info.size || afterOpen.size > MAX_PROTECTED_TEXT_BYTES) {
      throw new Error("Private state identity changed while opening.");
    }
    bytes = await handle.readFile();
  } finally {
    await handle.close();
  }
  try {
    const envelope = JSON.parse(bytes.toString("utf8")) as unknown;
    if (!isRecord(envelope) || envelope.version !== 1) throw new Error("Private state envelope is invalid.");
    if (process.platform === "win32") {
      if (envelope.protection !== "windows-dpapi-current-user" || typeof envelope.ciphertext !== "string" || envelope.ciphertext.length > MAX_PROTECTED_TEXT_BYTES) {
        throw new Error("Windows private state is not DPAPI protected.");
      }
      const plaintext = await unprotectWindows(envelope.ciphertext);
      try {
        if (plaintext.length === 0 || plaintext.length > MAX_PRIVATE_JSON_BYTES) throw new Error("Private state payload is invalid.");
        return JSON.parse(plaintext.toString("utf8")) as unknown;
      } finally {
        plaintext.fill(0);
      }
    }
    if (envelope.protection !== "owner-only-file" || !("payload" in envelope)) {
      throw new Error("Owner-only private state envelope is invalid.");
    }
    return envelope.payload;
  } finally {
    bytes.fill(0);
  }
}

export async function resolveCurrentWindowsSid(): Promise<string | null> {
  return process.platform === "win32" ? await windowsSid() : null;
}
