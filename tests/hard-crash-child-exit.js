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
