import { STARTUP_TRANSACTION_PHASES } from "../dist/runtime/startup/transaction.js";
import { lifecycleFailureDiagnostic } from "./lifecycle-failure-diagnostics.js";

const phases = new Set(STARTUP_TRANSACTION_PHASES);

export function startupCrashFailureDiagnostic(lastPhase, error, state) {
  return {
    kind: "startup-crash-failure",
    lastCompletedPhase: phases.has(lastPhase) ? lastPhase : null,
    lifecycle: JSON.parse(lifecycleFailureDiagnostic({ error, state })),
  };
}
