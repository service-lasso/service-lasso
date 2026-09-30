const SUCCESS_BY_MODE = Object.freeze({
  unavailable: Object.freeze({
    ok: true,
    mode: "unavailable",
    startup: "unavailable",
    navigation: "not_applicable",
    exit: "q",
  }),
  connected: Object.freeze({
    ok: true,
    mode: "connected",
    startup: "connected",
    navigation: "help",
    exit: "q",
  }),
});

const FAILURE_STAGES = new Set([
  "setup",
  "launch",
  "startup",
  "navigation",
  "exit",
  "cleanup",
]);

function exactObject(value, expected) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const keys = Object.keys(value).sort();
  const expectedKeys = Object.keys(expected).sort();
  return (
    keys.length === expectedKeys.length &&
    keys.every((key, index) => key === expectedKeys[index]) &&
    keys.every((key) => value[key] === expected[key])
  );
}

export function parseConptyProbeResult(stdout, mode) {
  if (!(mode in SUCCESS_BY_MODE) || typeof stdout !== "string")
    throw new Error(
      "Windows ConPTY TUI probe did not complete its bounded assertions.",
    );
  let result;
  try {
    result = JSON.parse(stdout.trim());
  } catch {
    throw new Error(
      "Windows ConPTY TUI probe did not complete its bounded assertions.",
    );
  }
  if (exactObject(result, SUCCESS_BY_MODE[mode])) return result;
  if (
    result &&
    typeof result === "object" &&
    !Array.isArray(result) &&
    Object.keys(result).length === 2 &&
    result.ok === false &&
    FAILURE_STAGES.has(result.stage)
  ) {
    throw new Error(`Windows ConPTY TUI probe failed during ${result.stage}.`);
  }
  throw new Error(
    "Windows ConPTY TUI probe did not complete its bounded assertions.",
  );
}
