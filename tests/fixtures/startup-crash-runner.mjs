import { startApiServer } from "../../dist/server/index.js";
import { stopManagedProcess, setManagedProcessEnrollmentHookForTests } from "../../dist/runtime/execution/supervisor.js";
import { writeFile, mkdtemp } from "node:fs/promises";
import path from "node:path";
import { getLifecycleState } from "../../dist/runtime/lifecycle/store.js";
import { startupCrashFailureDiagnostic } from "../startup-crash-diagnostics.js";
import { protectOriginalFixture, verifyOriginalFixturePrivacy } from "../hard-crash-fixture-custody.js";

const [servicesRoot, workspaceRoot, phase, serviceToStop, injectedFailurePhase] = process.argv.slice(2);
if (!servicesRoot || !workspaceRoot || !phase) {
  throw new Error("Expected servicesRoot, workspaceRoot, and startup phase.");
}

let lastPhase = null;
const custodyReaders = [];
let custodyObservationFailed = false;
let failureStage = "original_privacy";
setManagedProcessEnrollmentHookForTests(null, (serviceId, read) => {
  if (serviceId === "matrix-service") custodyReaders.push(read);
}, () => { custodyObservationFailed = true; });
try {
  // Matrix parents establish this first; other existing callers use the same
  // original-private boundary here before any startup/fingerprint write.
  await protectOriginalFixture(path.dirname(workspaceRoot));
  await verifyOriginalFixturePrivacy(path.dirname(workspaceRoot));
  failureStage = "startup";
  await startApiServer({
    port: 0,
    servicesRoot,
    workspaceRoot,
    autostart: true,
    startupTransactionTestHooks: {
      afterPhase: async ({ phase: current }) => {
        lastPhase = current;
        if (current === injectedFailurePhase) throw new Error("PRIVATE-CRASH-SENTINEL");
        if (current === phase) {
          if (serviceToStop) await stopManagedProcess(serviceToStop);
          if (custodyObservationFailed) throw new Error("Fixture enrollment observation failed.");
          // Private local evidence only; never send fingerprints over diagnostic IPC.
          failureStage = "sidecar_privacy";
          await verifyOriginalFixturePrivacy(path.dirname(workspaceRoot));
          failureStage = "sidecar_write";
          await writeFile(path.join(workspaceRoot, ".service-lasso", "hard-crash-fixture-custody.json"),
            JSON.stringify(custodyReaders.flatMap((read) => read())), { mode: 0o600, flag: "wx" });
          await verifyOriginalFixturePrivacy(path.dirname(workspaceRoot));
          process.exit(86);
        }
      },
    },
  });

  throw new Error(`Startup did not crash after phase ${phase}.`);
} catch (error) {
  const diagnostic = startupCrashFailureDiagnostic(lastPhase, error, getLifecycleState("matrix-service"));
  diagnostic.fixtureFailureStage = failureStage;
  const privateError = (value, seen = new Set()) => {
    if (!value || typeof value !== "object") return String(value);
    if (seen.has(value)) return { kind: "circular" };
    seen.add(value);
    return { name: value.name, message: value.message, stack: value.stack,
      cause: value.cause === undefined ? undefined : privateError(value.cause, seen),
      errors: Array.isArray(value.errors) ? value.errors.map(entry => privateError(entry, seen)) : undefined };
  };
  try {
    const privateRoot = await mkdtemp(path.join(path.dirname(workspaceRoot), ".hard-crash-private-error-"));
    await protectOriginalFixture(privateRoot);
    await writeFile(path.join(privateRoot, "error.json"), JSON.stringify({ stage: failureStage, error: privateError(error) }), { flag: "wx", mode: 0o600 });
    await verifyOriginalFixturePrivacy(privateRoot);
    diagnostic.privateError = "retained";
  } catch {
    diagnostic.privateError = "unresolved";
  }
  if (process.connected) {
    await Promise.race([
      new Promise((resolve) => process.send(diagnostic, () => resolve())),
      new Promise((resolve) => setTimeout(resolve, 500)),
    ]).catch(() => undefined);
  }
  // Preserve failure without Node printing an unredacted exception to stderr.
  process.exit(1);
}
