import { mkdtemp, mkdir, lstat, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// Test-only ownership, not a native security/custody grant. A path cannot be
// adopted into this map: every entry originates at this module's mkdtemp call.
const created = new WeakMap();
const identity = info => `${info.dev}:${info.ino}`;
const samePath = (a,b) => process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;

export async function createDisposableTestFixture(prefix) {
  if (!/^[a-zA-Z0-9_-]{1,120}$/.test(prefix)) throw new Error("Invalid disposable fixture prefix.");
  const parent = await realpath(tmpdir());
  const root = await mkdtemp(path.join(parent, prefix));
  const info = await lstat(root, { bigint: true });
  const token = Object.freeze({});
  created.set(token, { root, parent, identity: identity(info) });
  return { root, token };
}

export async function makeDisposableServicesRoot(prefix) {
  const { root: tempRoot, token: disposableFixture } = await createDisposableTestFixture(prefix);
  const servicesRoot = path.join(tempRoot, "services");
  const workspaceRoot = path.join(tempRoot, "workspace");
  await mkdir(servicesRoot); await mkdir(workspaceRoot);
  return { tempRoot, servicesRoot, workspaceRoot, disposableFixture };
}

export async function verifyDisposableTestFixture(token, root) {
  const original = created.get(token);
  if (!original || !samePath(root,original.root) || !samePath(path.dirname(root),original.parent)) throw new Error("Fixture is not owned by its disposable creator.");
  const info = await lstat(root, { bigint: true });
  if (!info.isDirectory() || info.isSymbolicLink() || identity(info) !== original.identity || !samePath(await realpath(root),root)) throw new Error("Disposable fixture identity changed.");
  if (process.platform !== "win32" && (info.uid !== BigInt(process.getuid()) || (info.mode & 0o077n) !== 0n)) throw new Error("Disposable fixture is not private and current-user-owned.");
}

export async function removeDisposableTestFixture(token, root) {
  await verifyDisposableTestFixture(token, root);
  // The same-user test owner is trusted. No conditional unlink or hostile
  // writer exclusion claim is made; strong custody uses the separate helper.
  await rm(root, { recursive: true });
  try { await lstat(root); throw new Error("Disposable fixture removal did not complete."); }
  catch (error) { if (error?.code !== "ENOENT") throw error; }
  created.delete(token);
}
