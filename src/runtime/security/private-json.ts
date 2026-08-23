import { randomUUID } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { constants } from "node:fs";
import { chmod, lstat, mkdir, open, rename, rm } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const MAX_PRIVATE_JSON_BYTES = 64 * 1024;
const MAX_PROTECTED_TEXT_BYTES = 256 * 1024;
let currentWindowsSid: Promise<string> | null = null;

function windowsSystemExecutable(...segments: string[]): string {
  const root = process.env.SystemRoot ?? process.env.WINDIR;
  if (!root || !path.win32.isAbsolute(root)) {
    throw new Error("Windows system utilities are unavailable.");
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

async function runPowerShellProtection(script: string, input: string): Promise<string> {
  return await new Promise((resolve, reject) => {
    const child = spawn(windowsSystemExecutable("System32", "WindowsPowerShell", "v1.0", "powershell.exe"), ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script], {
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    let outputBytes = 0;
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(new Error("Windows private-state protection timed out."));
    }, 15_000);
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
      reject(new Error("Windows private-state protection is unavailable."));
    });
    child.once("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (code !== 0 || outputBytes > MAX_PROTECTED_TEXT_BYTES) {
        reject(new Error("Windows private-state protection failed."));
        return;
      }
      resolve(Buffer.concat(stdout).toString("utf8").trim());
    });
    child.stdin.on("error", () => undefined);
    child.stdin.end(input);
  });
}

async function protectWindows(plaintext: Buffer): Promise<string> {
  const script = [
    "Add-Type -AssemblyName System.Security",
    "$raw = [Convert]::FromBase64String([Console]::In.ReadToEnd().Trim())",
    "$protected = [Security.Cryptography.ProtectedData]::Protect($raw, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)",
    "[Console]::Out.Write([Convert]::ToBase64String($protected))",
  ].join("; ");
  return await runPowerShellProtection(script, plaintext.toString("base64"));
}

async function unprotectWindows(ciphertext: string): Promise<Buffer> {
  const script = [
    "Add-Type -AssemblyName System.Security",
    "$raw = [Convert]::FromBase64String([Console]::In.ReadToEnd().Trim())",
    "$plain = [Security.Cryptography.ProtectedData]::Unprotect($raw, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)",
    "[Console]::Out.Write([Convert]::ToBase64String($plain))",
  ].join("; ");
  return Buffer.from(await runPowerShellProtection(script, ciphertext), "base64");
}

async function windowsSid(): Promise<string> {
  currentWindowsSid ??= execFileAsync(windowsSystemExecutable("System32", "whoami.exe"), ["/user", "/fo", "csv", "/nh"], {
    windowsHide: true,
    maxBuffer: 16 * 1024,
  }).then(({ stdout }) => {
    const match = stdout.match(/,"(S-\d+(?:-\d+)+)"\s*$/iu);
    if (!match) throw new Error("Cannot resolve the current Windows user for private state.");
    return match[1];
  });
  return await currentWindowsSid;
}

async function enforcePrivatePermissions(filePath: string): Promise<void> {
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
