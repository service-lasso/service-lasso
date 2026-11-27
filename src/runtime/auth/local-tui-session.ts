import { randomBytes, createHash } from "node:crypto";
import { createServer, createConnection, type Server } from "node:net";
import { chmod, lstat, mkdir, realpath, rm } from "node:fs/promises";
import type { IncomingMessage } from "node:http";
import { LOCAL_ADMIN_TOKEN_HEADER, LOCAL_OPERATOR_SESSION_TTL_MS } from "./local-auth-constants.js";
import { isLoopbackAddress } from "./request-policy.js";

export interface LocalTuiBinding {
  workspaceRoot: string;
  servicesRoot: string;
  generationId: string;
  origin: string;
}
interface Session { binding: LocalTuiBinding; expires: number }
const sessions = new Map<string, Session>();
const wireLimit = 2048;
const denied = () => new Error("Local TUI session unavailable. Complete secure setup and acknowledge credentials, or select explicit authentication.");
function key(binding: LocalTuiBinding): string { return JSON.stringify(binding); }
function paths(binding: LocalTuiBinding): { directory: string; socket: string } {
  const digest = createHash("sha256").update(key(binding)).digest("hex").slice(0, 32);
  const directory = `/tmp/service-lasso-tui-${process.getuid!()}-${digest}`;
  return { directory, socket: `${directory}/session.sock` };
}
async function checkTempRoot(): Promise<void> {
  const parent = await lstat("/tmp");
  if (!parent.isDirectory() || parent.uid !== 0 || !(parent.mode & 0o1000)
      || await realpath("/tmp") !== "/tmp") throw denied();
}
async function checkPaths(binding: LocalTuiBinding): Promise<void> {
  await checkTempRoot();
  const { directory, socket } = paths(binding);
  const parent = await lstat(directory);
  const leaf = await lstat(socket);
  if (!parent.isDirectory() || parent.uid !== process.getuid!() || (parent.mode & 0o777) !== 0o700
      || !leaf.isSocket() || leaf.uid !== process.getuid!() || (leaf.mode & 0o777) !== 0o600
      || await realpath(directory) !== directory || await realpath(socket) !== socket) throw denied();
}

/** Not an HTTP login: OS socket permissions admit only Core's own Linux uid. */
export async function startLocalTuiSessionServer(
  binding: LocalTuiBinding,
  ready: () => Promise<boolean>,
): Promise<{ close(): Promise<void> } | null> {
  if (process.platform !== "linux" || !process.getuid) return null;
  const { directory, socket } = paths(binding);
  await checkTempRoot();
  // Exclusive creation refuses stale or impersonated endpoints, including symlinks.
  await mkdir(directory, { mode: 0o700 });
  let server: Server | null = null;
  const active = new Set<import("node:net").Socket>();
  let closed = false;
  const close = async () => {
    closed = true;
    for (const [token, session] of sessions) if (key(session.binding) === key(binding)) sessions.delete(token);
    for (const client of active) client.destroy();
    if (server?.listening) await new Promise<void>(resolve => server!.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  };
  try {
    server = createServer(client => {
      if (active.size >= 16) { client.destroy(); return; }
      active.add(client);
      const deadline = setTimeout(() => client.destroy(), 2000);
      deadline.unref();
      client.once("close", () => { clearTimeout(deadline); active.delete(client); });
      client.on("error", () => client.destroy());
      client.setTimeout(2000, () => client.destroy());
      let bytes = Buffer.alloc(0); let handled = false;
      client.on("data", chunk => {
        if (handled) { client.destroy(); return; }
        bytes = Buffer.concat([bytes, Buffer.from(chunk)]);
        if (bytes.length > wireLimit) { client.destroy(); return; }
        if (!bytes.includes(10)) return;
        handled = true;
        void (async () => {
          if (bytes.toString("utf8") !== `${key(binding)}\n` || !await ready() || closed || client.destroyed) {
            client.end('{"error":"unavailable"}\n'); return;
          }
          for (const [token, session] of sessions) if (session.expires <= Date.now()) sessions.delete(token);
          if (sessions.size >= 64) { client.end('{"error":"unavailable"}\n'); return; }
          const token = randomBytes(32).toString("base64url");
          sessions.set(token, { binding, expires: Date.now() + LOCAL_OPERATOR_SESSION_TTL_MS });
          client.end(`${JSON.stringify({ token })}\n`);
        })().catch(() => client.destroy());
      });
    });
    await new Promise<void>((resolve, reject) => { server!.once("error", reject); server!.listen(socket, resolve); });
    await chmod(socket, 0o600);
    await checkPaths(binding);
    return { close };
  } catch (error) { await close(); throw error; }
}

export function verifyLocalTuiSession(
  binding: Omit<LocalTuiBinding, "origin">,
  token: string,
  request: IncomingMessage,
): boolean {
  const session = sessions.get(token);
  if (!session || session.expires <= Date.now()) { sessions.delete(token); return false; }
  // A loopback reverse proxy must never turn this into a remote credential.
  if (!isLoopbackAddress(request.socket.remoteAddress)
      || Object.keys(request.headers).some(name => name === "forwarded" || name.startsWith("x-forwarded-")
        || (name.startsWith("x-service-lasso-") && name !== LOCAL_ADMIN_TOKEN_HEADER))) return false;
  return session.binding.workspaceRoot === binding.workspaceRoot
    && session.binding.servicesRoot === binding.servicesRoot && session.binding.generationId === binding.generationId;
}

export async function requestLocalTuiSession(binding: LocalTuiBinding): Promise<string> {
  if (process.platform !== "linux" || !process.getuid) throw denied();
  await checkPaths(binding).catch(() => { throw denied(); });
  return await new Promise<string>((resolve, reject) => {
    const client = createConnection(paths(binding).socket);
    let bytes = Buffer.alloc(0); let settled = false;
    const fail = () => { if (!settled) { settled = true; reject(denied()); } client.destroy(); };
    const deadline = setTimeout(fail, 2000);
    deadline.unref();
    client.once("close", () => clearTimeout(deadline));
    client.setTimeout(2000, fail);
    client.once("error", fail);
    client.once("connect", () => client.write(`${key(binding)}\n`));
    client.on("data", chunk => {
      bytes = Buffer.concat([bytes, Buffer.from(chunk)]);
      if (bytes.length > wireLimit) return fail();
      if (!bytes.includes(10)) return;
      try {
        const parsed = JSON.parse(bytes.toString("utf8"));
        if (typeof parsed.token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(parsed.token)) return fail();
        settled = true; resolve(parsed.token); client.destroy();
      } catch { fail(); }
    });
    client.once("close", () => { if (!settled) fail(); });
  });
}
