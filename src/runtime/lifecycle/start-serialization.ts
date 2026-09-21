import { AsyncLocalStorage } from "node:async_hooks";
import path from "node:path";

type Lease = { active: boolean };
const held = new AsyncLocalStorage<ReadonlyMap<string, Lease>>();
const pending = new Map<string, Promise<void>>();

/** One preparation/launch transaction per service root, with nested start reentry. */
export async function withServiceStartSerialization<T>(root: string, action: () => Promise<T>): Promise<T> {
  const resolved = path.resolve(root);
  const key = process.platform === "win32" ? resolved.toLowerCase() : resolved;
  if (held.getStore()?.get(key)?.active) return await action();
  const previous = pending.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>(resolve => { release = resolve; });
  const tail = previous.then(() => current);
  pending.set(key, tail);
  await previous;
  const lease = { active: true };
  const context = new Map(held.getStore());
  context.set(key, lease);
  try {
    return await held.run(context, action);
  } finally {
    lease.active = false;
    release();
    if (pending.get(key) === tail) pending.delete(key);
  }
}
