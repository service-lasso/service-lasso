import path from "node:path";

/**
 * In-process runtime shutdown registry.
 *
 * HTTP shutdown, CLI signals, and the workspace lifecycle coordinator share
 * this slot so Ctrl+C and `service-lasso stop` execute the same `RunningApiServer.stop`
 * implementation. Keys are canonical workspace roots so parallel test servers
 * on different workspaces do not clobber each other.
 */
type RuntimeShutdownFn = () => Promise<void>;

const shutdownByWorkspace = new Map<string, RuntimeShutdownFn>();
const exitWaiters = new Map<string, {
  promise: Promise<void>;
  resolve: () => void;
}>();

function workspaceKey(workspaceRoot: string): string {
  return path.resolve(workspaceRoot);
}

/**
 * Registers the active runtime stop function for a workspace.
 */
export function registerRuntimeShutdown(workspaceRoot: string, stop: RuntimeShutdownFn): void {
  shutdownByWorkspace.set(workspaceKey(workspaceRoot), stop);
}

/**
 * Clears a previously registered stop function after the runtime has stopped.
 */
export function clearRuntimeShutdown(workspaceRoot: string, stop: RuntimeShutdownFn): void {
  const key = workspaceKey(workspaceRoot);
  if (shutdownByWorkspace.get(key) === stop) {
    shutdownByWorkspace.delete(key);
  }
}

/**
 * Invokes the in-process stop for a workspace when this process owns the runtime.
 *
 * @returns true when a registered stop ran
 */
export async function invokeRegisteredRuntimeShutdown(workspaceRoot: string): Promise<boolean> {
  const stop = shutdownByWorkspace.get(workspaceKey(workspaceRoot));
  if (!stop) {
    return false;
  }
  await stop();
  return true;
}

/**
 * Returns whether this process currently owns a registered runtime stop hook.
 */
export function hasRegisteredRuntimeShutdown(workspaceRoot: string): boolean {
  return shutdownByWorkspace.has(workspaceKey(workspaceRoot));
}

/**
 * Arms a waiter that resolves when the in-process runtime for `workspaceRoot` stops.
 * CLI start/serve use this to keep the process alive until shutdown.
 */
export function armRuntimeExitWait(workspaceRoot: string): Promise<void> {
  const key = workspaceKey(workspaceRoot);
  const existing = exitWaiters.get(key);
  if (existing) {
    return existing.promise;
  }
  let resolve = (): void => {};
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });
  exitWaiters.set(key, { promise, resolve });
  return promise;
}

/**
 * Resolves any CLI stay-resident waiter after the runtime has stopped.
 */
export function notifyRuntimeStopped(workspaceRoot: string): void {
  const key = workspaceKey(workspaceRoot);
  const waiter = exitWaiters.get(key);
  if (!waiter) {
    return;
  }
  exitWaiters.delete(key);
  waiter.resolve();
}
