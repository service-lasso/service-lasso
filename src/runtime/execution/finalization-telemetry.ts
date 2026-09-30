export const FINALIZATION_TELEMETRY_PHASES = [
  "root_handle_exit",
  "snapshot",
  "member_count",
  "termination",
  "registry_reconcile",
] as const;

export type FinalizationTelemetryPhase = typeof FINALIZATION_TELEMETRY_PHASES[number];
export type FinalizationTelemetryStatus = "complete" | "failed" | "not_applicable";
export type FinalizationTelemetryReason = "observed" | "deadline_exceeded" | "failed" | "not_required";

export interface FinalizationTelemetryEntry {
  phase: FinalizationTelemetryPhase;
  status: FinalizationTelemetryStatus;
  reason: FinalizationTelemetryReason;
  count?: number;
}

const MAX_FINALIZATION_MEMBER_COUNT = 1_000;
const phases = new Set<string>(FINALIZATION_TELEMETRY_PHASES);
const statuses = new Set<string>(["complete", "failed", "not_applicable"]);
const reasons = new Set<string>(["observed", "deadline_exceeded", "failed", "not_required"]);

export function closedFinalizationTelemetry(
  entries: readonly FinalizationTelemetryEntry[],
): readonly FinalizationTelemetryEntry[] {
  if (entries.length > FINALIZATION_TELEMETRY_PHASES.length) {
    throw new Error("Invalid closed finalization telemetry.");
  }
  const observed = new Set<string>();
  for (const entry of entries) {
    const keys = Object.keys(entry);
    if (
      !phases.has(entry.phase) ||
      !statuses.has(entry.status) ||
      !reasons.has(entry.reason) ||
      observed.has(entry.phase) ||
      keys.some((key) => key !== "phase" && key !== "status" && key !== "reason" && key !== "count") ||
      (entry.phase !== "member_count" && "count" in entry) ||
      (entry.phase === "member_count" && (
        !Number.isInteger(entry.count) ||
        entry.count === undefined ||
        entry.count < 0 ||
        entry.count > MAX_FINALIZATION_MEMBER_COUNT
      ))
    ) {
      throw new Error("Invalid closed finalization telemetry.");
    }
    observed.add(entry.phase);
  }
  return entries.map((entry) => ({ ...entry }));
}
