import { FIXTURE_PRIVACY_RESULTS } from "./hard-crash-fixture-custody.js";

export const HISTORY_STAGES = Object.freeze(`original_privacy enrollment_observer_arm inspector_arm discovery managed_start managed_rejection managed_record_absent held_child_closed held_reader_empty adopted_spawn adopted_spawn_observe adopted_inspection adopted_running rejected_spawn rejected_spawn_observe rejected_inspection rejected_running owner_record adopted_start adopted_rejection adopted_record_absent adopted_child_live rejected_reader_excluded reader_presence observer_count initial_reader_read compatibility_reader_acquire initial_reader_nonempty descendant_command descendant_file_wait initial_descendant_excluded descendant_history_wait reader_copy_read reader_copy_defensive second_command second_file_wait second_inspection second_running second_pre_admission_excluded mixed_snapshot_wait prior_a_retained independent_b_retained second_still_running descendant_close_command descendant_absence_wait omission_wait omitted_a_retained action_stop action_finalization final_record_absent final_a_retained all_members_absent compatibility_a_retained final_b_retained final_b_absent unknown`.split(" "));
export const HISTORY_CLEANUP = Object.freeze("hook inspector stop finalization direct_child rejected_child held_child reset removal private_diagnostic".split(" "));
const own = (value, keys) => {
  if (!value || typeof value !== "object") return null;
  try {
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Reflect.ownKeys(descriptors).length !== keys.length || keys.some(key => !descriptors[key] || !Object.hasOwn(descriptors[key], "value"))) return null;
    return Object.fromEntries(keys.map(key => [key, descriptors[key].value]));
  } catch { return null; }
};
const normal = ["boot_enter", "parse_enter", "parse_ok", "compiler_enter", "compiler_ok"];
const completedResult = result => result === "passed" || FIXTURE_PRIVACY_RESULTS.slice(2, 16).includes(result);
function transport(value, result) {
  const record = own(value, ["schema", "state", "events"]);
  if (!record || record.schema !== "service-lasso.fixture-privacy-transport.v2" || !["complete", "unavailable", "malformed"].includes(record.state)) return null;
  try {
    if (!Array.isArray(record.events) || record.events.length > 6) return null;
    const descriptors = Object.getOwnPropertyDescriptors(record.events);
    if (Reflect.ownKeys(descriptors).length !== record.events.length + 1) return null;
    const events = Array.from({ length: record.events.length }, (_, index) => {
      const descriptor = descriptors[index];
      if (!descriptor || !Object.hasOwn(descriptor, "value") || typeof descriptor.value !== "string") throw null;
      return descriptor.value;
    });
    if (record.state !== "complete" || !completedResult(result)) {
      for (let index = 0; index < events.length; index++) {
        const alternate = (index === 2 && events[index] === "parse_failed") || (index === 4 && events[index] === "compiler_failed");
        if (!alternate && (index < 5 ? events[index] !== normal[index] : !/^native_enter_(acquire|information|type|redirect|security|owner|inventory|identity|descriptor|protect|readback)$/.test(events[index]))) return null;
        if (alternate && index !== events.length - 1) return null;
      }
      return { schema: record.schema, state: record.state, events };
    }
    if (result === "compiler") {
      if (events.length !== 5 || events.slice(0, 4).some((event, index) => event !== normal[index]) || events[4] !== "compiler_failed") return null;
    } else {
      if (events.length < 5 || events.slice(0, 5).some((event, index) => event !== normal[index])) return null;
      if (events.length === 5 && result !== "prepare") return null;
      if (events.length === 6 && !/^native_enter_(acquire|information|type|redirect|security|owner|inventory|identity|descriptor|protect|readback)$/.test(events[5])) return null;
      if (events.length === 6 && result === "prepare") return null;
    }
    if (result !== "passed" && !FIXTURE_PRIVACY_RESULTS.slice(2, 16).includes(result)) return null;
    return { schema: record.schema, state: record.state, events };
  } catch { return null; }
}

// Invocation-local only. Raw values never enter projection validation/formatting.
export function createHistoryObservation() {
  let marker = "unknown", failed = false, loss = false;
  let originalAttempted = false, diagnosticAttempted = false;
  let original = null, originalVerificationTransport = null, originalProtectionTransport = null;
  let diagnosticVerification = "not_attempted", diagnosticTransport = null;
  let local = { state: "not_attempted", stage: "not_attempted" };
  let independent = { state: "unavailable" };
  const cleanup = HISTORY_CLEANUP.map(stage => ({ stage, state: "not_attempted" }));
  const originals = { primary: undefined, caught: false, cleanup: [], native: [] };
  let count = 0;
  const tick = () => { if (++count > 256) loss = true; };
  return {
    mark(stage) { tick(); marker = HISTORY_STAGES.includes(stage) ? stage : "unknown"; if (marker === "unknown") loss = true; },
    lose() { loss = true; },
    caught(value) { failed = true; originals.caught = true; originals.primary = value; },
    native(value) { if (originals.native.length < 32) originals.native.push(value); else loss = true; },
    originalBegin() { originalAttempted = true; },
    originalEnd(caught) {
      if (!original) { loss = true; return; }
      const returned = original.protection === "not_attempted" ? original.verification === "passed" : original.protection === "passed";
      if (returned === caught) loss = true;
    },
    original(value, transports) {
      tick();
      if (original !== null) { loss = true; return; }
      const observation = own(value, ["schema", "verification", "protection"]);
      const pair = own(transports, ["verification", "protection"]);
      if (!observation || !pair || observation.schema !== "service-lasso.fixture-privacy-observation.v1" ||
          !FIXTURE_PRIVACY_RESULTS.includes(observation.verification) || !FIXTURE_PRIVACY_RESULTS.includes(observation.protection) || observation.verification === "not_attempted") { loss = true; return; }
      originalVerificationTransport = transport(pair.verification, observation.verification);
      originalProtectionTransport = observation.protection === "not_attempted" && pair.protection === null ? null : transport(pair.protection, observation.protection);
      if (!completedResult(observation.verification) || originalVerificationTransport?.state !== "complete" ||
          (observation.protection !== "not_attempted" && (!completedResult(observation.protection) || originalProtectionTransport?.state !== "complete")) ||
          (observation.verification === "passed" && observation.protection !== "not_attempted") ||
          (observation.protection === "not_attempted" && pair.protection !== null)) loss = true;
      original = observation;
    },
    diagnostic(result, value) {
      tick();
      if (diagnosticVerification !== "not_attempted") { loss = true; return; }
      diagnosticVerification = FIXTURE_PRIVACY_RESULTS.includes(result) && result !== "not_attempted" ? result : "response_unavailable";
      diagnosticTransport = transport(value, diagnosticVerification);
      if (!completedResult(diagnosticVerification) || diagnosticTransport?.state !== "complete") loss = true;
    },
    localBegin(stage) {
      if (!["privacy_verification", "serialization", "write"].includes(stage)) { local = { state: "unavailable", stage: "unknown" }; loss = true; return; }
      if (stage === "serialization" && diagnosticVerification !== "passed") loss = true;
      diagnosticAttempted = true; local = { state: "unavailable", stage };
    },
    localFailed() {
      local = { state: "failed", stage: local.stage };
      if (local.stage === "unknown" || local.stage === "not_attempted" || (local.stage === "privacy_verification" && diagnosticVerification === "passed")) loss = true;
    },
    localWritten() { local = { state: "written", stage: "complete" }; },
    cleanupBegin(stage) {
      tick(); const slot = cleanup.find(entry => entry.stage === stage);
      if (!slot || slot.state !== "not_attempted") { loss = true; return; }
      slot.state = "unavailable";
    },
    cleanupEnd(stage, caught, value) {
      const slot = cleanup.find(entry => entry.stage === stage);
      if (!slot || slot.state !== "unavailable") loss = true;
      else slot.state = caught ? "failed" : "passed";
      if (caught) originals.cleanup.push({ stage, error: value });
    },
    async capture(adapter) {
      // This explicit input is supplied only by an independently admitted owner.
      // No native stream, custodian, raw-byte serializer or readback is invented.
      if (!adapter) { independent = { state: "unavailable" }; return; }
      independent = { state: "incomplete" };
      try {
        const value = own(await adapter(originals), ["state"]);
        independent = { state: value && ["captured", "incomplete", "unavailable"].includes(value.state) ? value.state : "unavailable" };
      } catch { independent = { state: "incomplete" }; }
    },
    originals() { return originals; },
    project() {
      if (!failed && !cleanup.some(entry => entry.state === "failed" || entry.state === "unavailable") && !loss) return null;
      const complete = !loss && (!failed || marker !== "unknown") && (!originalAttempted || original !== null) &&
        !cleanup.some(entry => entry.state === "unavailable") && (!diagnosticAttempted ||
          (diagnosticTransport !== null && ["written", "failed"].includes(local.state) && !["unknown", "not_attempted"].includes(local.stage)));
      return { schema: "service-lasso.fixture-history-failure.v1", complete,
        primaryStage: failed ? marker : loss ? "unknown" : null,
        cleanup: cleanup.map(entry => ({ ...entry })),
        privacy: { originalProtection: original ? { ...original } : { schema: "service-lasso.fixture-privacy-observation.v1", verification: "response_unavailable", protection: "not_attempted" },
          originalVerificationTransport: copyTransport(originalVerificationTransport), originalProtectionTransport: copyTransport(originalProtectionTransport),
          diagnosticVerification, diagnosticTransport: copyTransport(diagnosticTransport) },
        privateCapture: { local: { ...local }, independent: { ...independent } } };
    },
  };
}
const copyTransport = record => record ? { schema: record.schema, state: record.state, events: [...record.events] } : null;
