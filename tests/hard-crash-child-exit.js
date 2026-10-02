import { once } from "node:events";

export async function observeHardCrashChildExit(child, timeoutMs = 120_000) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return { kind: "exit", code: child.exitCode, signal: child.signalCode };
  }
  const controller = new AbortController();
  let timer;
  try {
    return await Promise.race([
      once(child, "exit", { signal: controller.signal }).then(([code, signal]) => ({ kind: "exit", code, signal })),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve({ kind: "timeout" }), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

// Shared formal/recovered caller boundary. Tests inject the exact caller close
// failure here; the stage is fixed rather than supplied by a raw exception.
export async function stopHardCrashDirectChild(child) {
  if (!child) return;
  const closed = child.fixtureClose;
  if (!closed) throw new Error("Fixture child close custody is missing.");
  if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
  if (!(await Promise.race([closed.then(() => true), new Promise((resolve) => setTimeout(() => resolve(false), 5_000))]))) {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    if (!(await Promise.race([closed.then(() => true), new Promise((resolve) => setTimeout(() => resolve(false), 5_000))]))) {
      throw new Error("Fixture child close remains unresolved.");
    }
  }
}

export async function settleHardCrashDirectChild(child, failures, close = stopHardCrashDirectChild) {
  try { await close(child); }
  catch (error) { failures.push({ stage: "direct_child", error }); }
}
