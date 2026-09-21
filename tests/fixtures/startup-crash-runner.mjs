import { startApiServer } from "../../dist/server/index.js";
import { stopManagedProcess } from "../../dist/runtime/execution/supervisor.js";
import { getLifecycleState } from "../../dist/runtime/lifecycle/store.js";
import { startupCrashFailureDiagnostic } from "../startup-crash-diagnostics.js";

const [servicesRoot, workspaceRoot, phase, serviceToStop, injectedFailurePhase] = process.argv.slice(2);
if (!servicesRoot || !workspaceRoot || !phase) {
  throw new Error("Expected servicesRoot, workspaceRoot, and startup phase.");
}

let lastPhase = null;
try {
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
          process.exit(86);
        }
      },
    },
  });

  throw new Error(`Startup did not crash after phase ${phase}.`);
} catch (error) {
  const diagnostic = startupCrashFailureDiagnostic(lastPhase, error, getLifecycleState("matrix-service"));
  if (process.connected) {
    await Promise.race([
      new Promise((resolve) => process.send(diagnostic, () => resolve())),
      new Promise((resolve) => setTimeout(resolve, 500)),
    ]).catch(() => undefined);
  }
  // Preserve failure without Node printing an unredacted exception to stderr.
  process.exit(1);
}
