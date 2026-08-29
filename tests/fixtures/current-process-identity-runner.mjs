import { resolveCurrentProcessIdentity } from "../../dist/runtime/process/identity.js";

const mode = process.argv[2];
if (mode === "concurrent-cache") {
  const identities = await Promise.all([
    resolveCurrentProcessIdentity({ deadlineMs: Date.now() + 60_000 }),
    resolveCurrentProcessIdentity({ deadlineMs: Date.now() + 60_000 }),
    resolveCurrentProcessIdentity({ deadlineMs: Date.now() + 60_000 }),
  ]);
  if (!identities.every((identity) => identity === identities[0])) {
    throw new Error("Concurrent current-process identity calls did not share the verified cache entry.");
  }
  process.stdout.write('{"result":"shared-verified-identity"}\n');
} else if (mode === "failed-prime-retry") {
  let failureCode = null;
  try {
    await resolveCurrentProcessIdentity({ deadlineMs: Date.now() - 1 });
  } catch (error) {
    failureCode = error?.code ?? null;
  }
  if (failureCode !== "PROCESS_CONTROL_DEADLINE_EXCEEDED") {
    throw new Error("Expired current-process identity prime did not fail with the governed deadline code.");
  }
  await resolveCurrentProcessIdentity({ deadlineMs: Date.now() + 60_000 });
  process.stdout.write('{"result":"failed-prime-retried"}\n');
} else {
  throw new Error("Unknown current-process identity fixture mode.");
}
