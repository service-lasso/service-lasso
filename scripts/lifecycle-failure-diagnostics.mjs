const phases = new Set([
  "dependency_resolution", "port_selection", "artifact_acquisition", "env_merge",
  "process_spawn", "health_check", "terminal_outcome",
]);
const launchPhases = new Set([
  "prelaunch_verification", "launch_state_creation", "wrapper_spawn",
  "ownership_enrollment", "ownership_recording", "initial_tree_inspection",
  "launch_file_binding", "binding_revalidation", "target_acknowledgement",
  "post_release_hook", "stabilization_delay", "stabilized_tree_inspection",
  "launch_state_cleanup", "launcher_initialization", "launcher_native_asset_validation",
  "launcher_payload_validation", "launcher_gate_observation", "launcher_file_open",
  "launcher_file_hash", "launcher_file_final_path", "launcher_binding_publication",
  "launcher_job_creation", "launcher_target_creation", "launcher_job_assignment",
  "launcher_target_resume", "launcher_target_thread_close", "launcher_acknowledgement_write",
]);
const eventStatuses = new Set(["completed", "blocked", "failed", "skipped"]);
const attemptStatuses = new Set(["running", "succeeded", "failed", "blocked"]);
const allowed = (values, value) => values.has(value) ? value : null;

// Deliberately closed: never serialize errors, messages, handles, or raw state.
export function lifecycleFailureDiagnostic(input = {}) {
  try {
    let { httpStatus, state, error } = input ?? {};
    const current = state?.runtime?.startTrace?.current;
    const failurePhases = [];
    let deadlineExceeded = false;
    const pending = [{ error, depth: 0 }];
    const seen = new Set();
    for (let index = 0; index < pending.length && index < 16; index += 1) {
      const entry = pending[index];
      const currentError = entry.error;
      if (!currentError || typeof currentError !== "object" || seen.has(currentError)) continue;
      seen.add(currentError);
      const phase = allowed(launchPhases, currentError.failurePhase);
      if (phase) failurePhases.push(phase);
      deadlineExceeded ||= currentError.code === "PROCESS_CONTROL_DEADLINE_EXCEEDED";
      if (entry.depth < 3) {
        const children = [currentError.cause];
        if (Array.isArray(currentError.errors)) children.push(...currentError.errors.slice(0, 16));
        for (const child of children) {
          if (pending.length >= 16) break;
          if (child && typeof child === "object") pending.push({ error: child, depth: entry.depth + 1 });
        }
      }
    }
    return JSON.stringify({
      kind: "lifecycle-failure",
      httpStatus: Number.isInteger(httpStatus) && httpStatus >= 100 && httpStatus <= 599 ? httpStatus : null,
      attemptStatus: allowed(attemptStatuses, current?.status),
      events: Array.isArray(current?.events) ? current.events.slice(-16).map(event => ({
        phase: allowed(phases, event?.phase),
        status: allowed(eventStatuses, event?.status),
        failurePhase: allowed(launchPhases, event?.metadata?.processStartFailurePhase),
      })) : [],
      failurePhases,
      deadlineExceeded,
    });
  } catch {
    return '{"kind":"lifecycle-failure","diagnostic":"metadata_unavailable"}';
  }
}
