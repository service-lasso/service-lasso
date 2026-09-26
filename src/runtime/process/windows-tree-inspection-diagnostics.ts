const nativeFailureReasons: Record<number, string> = {
  10: "snapshot_create", 11: "snapshot_enumerate", 12: "snapshot_close", 30: "changed_ancestry",
};
for (const [subject, offset] of [["root", 0], ["descendant", 100]] as const) {
  for (const [stage, code] of [["open", 20], ["identity", 21], ["time", 22], ["image", 23], ["parent", 24],
    ["command_size", 25], ["command_query", 26], ["command_bounds", 27], ["command_empty", 28],
    ["handle_close", 29], ["open_denied", 31]] as const) {
    nativeFailureReasons[offset + code] = `${subject}_${stage}`;
  }
}
export function windowsNativeInspectionFailure(exitCode: number | null): string | null {
  return Number.isInteger(exitCode) && Object.hasOwn(nativeFailureReasons, exitCode as number)
    ? nativeFailureReasons[exitCode as number] : null;
}
const phases = new Set(["queue_wait", "native_snapshot", "retry_delay"]);
const retryReasons = new Set([
  "helper_failed", "malformed", "incomplete", "invalid_ancestry", "inconsistent_root",
  ...Object.values(nativeFailureReasons),
]);

export type WindowsTreeInspectionMetadata = Record<string, string | number | null>;

const boundedInteger = (value: unknown, maximum: number): number | null =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= maximum ? value : null;

// This is a closed projection, never a serialization of an exception or helper result.
export function projectWindowsTreeInspectionMetadata(value: unknown): WindowsTreeInspectionMetadata {
  try {
    if (!value || typeof value !== "object") return {};
    const metadata = value as Record<string, unknown>;
    const phase = metadata.windowsTreeInspectionPhase;
    if (typeof phase !== "string" || !phases.has(phase)) return {};
    const reason = metadata.windowsTreeInspectionLastRetry;
    return {
      windowsTreeInspectionPhase: phase,
      windowsTreeInspectionAttempts: boundedInteger(metadata.windowsTreeInspectionAttempts, 1000),
      windowsTreeInspectionRetries: boundedInteger(metadata.windowsTreeInspectionRetries, 1000),
      windowsTreeInspectionQueueMs: boundedInteger(metadata.windowsTreeInspectionQueueMs, 600000),
      windowsTreeInspectionNativeMs: boundedInteger(metadata.windowsTreeInspectionNativeMs, 600000),
      windowsTreeInspectionLastRetry: typeof reason === "string" && retryReasons.has(reason) ? reason : null,
    };
  } catch {
    return {};
  }
}

export function windowsTreeInspectionFailureMetadata(error: unknown): WindowsTreeInspectionMetadata {
  try {
    const pending = [{ error, depth: 0 }];
    const seen = new Set<object>();
    for (let index = 0; index < pending.length && index < 16; index += 1) {
      const entry = pending[index];
      if (!entry.error || typeof entry.error !== "object" || seen.has(entry.error)) continue;
      seen.add(entry.error);
      const current = entry.error as { windowsTreeInspection?: unknown; cause?: unknown; errors?: unknown };
      const metadata = projectWindowsTreeInspectionMetadata(current.windowsTreeInspection);
      if (metadata.windowsTreeInspectionPhase) return metadata;
      if (entry.depth >= 3) continue;
      const children = [current.cause];
      if (Array.isArray(current.errors)) children.push(...current.errors.slice(0, 16));
      for (const child of children) {
        if (pending.length >= 16) break;
        if (child && typeof child === "object") pending.push({ error: child, depth: entry.depth + 1 });
      }
    }
  } catch {
    // Diagnostic property access must never replace the original failure.
  }
  return {};
}
