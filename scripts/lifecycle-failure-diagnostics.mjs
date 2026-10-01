import { projectWindowsTreeInspectionMetadata } from "../dist/runtime/process/windows-tree-inspection-diagnostics.js";

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
const restartStages = new Set(["precheck", "stop_request", "finalization_settled", "finalization_failed", "replacement_spawn", "readiness", "response"]);
const restartRelations = new Set(["unavailable", "prior_generation_running", "replacement_spawned"]);
// API response bodies are not diagnostic input. This closed projection only
// distinguishes the lifecycle conflicts that can explain a post-action 409.
const lifecycleApiErrorCodes = new Set([
  "invalid_lifecycle_state",
  "runtime_generation_active",
  "runtime_generation_owner_unknown",
  "startup_transaction_recovery_required",
]);
const allowed = (values, value) => values.has(value) ? value : null;
const launcherPayloadFailureBoundaries = new Set([
  "launch_evidence", "canonical_encoding", "strict_utf8", "json_or_schema", "semantic_payload", "unknown",
]);

// Deliberately closed: never serialize errors, messages, handles, or raw state.
export function lifecycleFailureDiagnostic(input = {}) {
  try {
    let { httpStatus, state, error, apiErrorCode, action } = input ?? {};
    const restartCandidate = action === "restart" ? state?.runtime?.restartTrace?.current : null;
    const restart = restartCandidate &&
      (restartCandidate.status === "failed" || restartCandidate.status === "blocked") &&
      Array.isArray(restartCandidate.events) &&
      restartCandidate.events.some((event) => event?.stage === "response" && (event?.status === "failed" || event?.status === "blocked"))
      ? restartCandidate
      : null;
    const current = action === "restart" ? restart : (restart ?? state?.runtime?.startTrace?.current);
    const failurePhases = [];
    let launcherPayloadFailureBoundary = null;
    const windowsTreeInspections = [];
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
      if (phase === "launcher_payload_validation") {
        launcherPayloadFailureBoundary = allowed(
          launcherPayloadFailureBoundaries,
          currentError.launcherPayloadFailureBoundary,
        ) ?? "unknown";
      }
      deadlineExceeded ||= currentError.code === "PROCESS_CONTROL_DEADLINE_EXCEEDED";
      const inspection = projectWindowsTreeInspectionMetadata(currentError.windowsTreeInspection);
      if (inspection.windowsTreeInspectionPhase) windowsTreeInspections.push(inspection);
      if (entry.depth < 3) {
        const children = [currentError.cause];
        if (Array.isArray(currentError.errors)) children.push(...currentError.errors.slice(0, 16));
        for (const child of children) {
          if (pending.length >= 16) break;
          if (child && typeof child === "object") pending.push({ error: child, depth: entry.depth + 1 });
        }
      }
    }
    if (Array.isArray(current?.events)) {
      for (const event of current.events.slice(-16)) {
        if (windowsTreeInspections.length >= 16) break;
        const inspection = projectWindowsTreeInspectionMetadata(event?.metadata);
        if (inspection.windowsTreeInspectionPhase) windowsTreeInspections.push(inspection);
      }
    }
    const apiFailure = allowed(lifecycleApiErrorCodes, apiErrorCode);
    return JSON.stringify({
      kind: "lifecycle-failure",
      httpStatus: Number.isInteger(httpStatus) && httpStatus >= 100 && httpStatus <= 599 ? httpStatus : null,
      attemptStatus: allowed(attemptStatuses, current?.status),
      ...(restart ? { attemptAction: "restart" } : {}),
      events: restart && Array.isArray(restart.events) ? restart.events.slice(-7).map(event => ({
        stage: allowed(restartStages, event?.stage),
        status: allowed(eventStatuses, event?.status),
        oldNewProcessRelation: allowed(restartRelations, event?.oldNewProcessRelation) ?? "unavailable",
      })) : Array.isArray(current?.events) ? current.events.slice(-16).map(event => ({
        phase: allowed(phases, event?.phase),
        status: allowed(eventStatuses, event?.status),
        failurePhase: allowed(launchPhases, event?.metadata?.processStartFailurePhase),
      })) : [],
      failurePhases,
      ...(launcherPayloadFailureBoundary ? { launcherPayloadFailureBoundary } : {}),
      deadlineExceeded,
      ...(apiFailure ? { apiErrorCode: apiFailure } : {}),
      ...(windowsTreeInspections.length ? { windowsTreeInspections } : {}),
    });
  } catch {
    return '{"kind":"lifecycle-failure","diagnostic":"metadata_unavailable"}';
  }
}
