/**
 * Loopback canonical-demo first-run completion.
 *
 * Baseline bootstrap honors setup mode and starts only `@serviceadmin` (plus
 * provider install/config). Canonical recycle must finish vault bootstrap and
 * confirmed startAll before verification, without logging secret values and
 * without converting a later verifier pass into a recycle pass.
 *
 * SPEC-002 AC-4N.2 / AC-4N.1 / AC-4BI. Isolation fail-closed AC-4CE is unchanged.
 */

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);
const RETRYABLE_BOOTSTRAP_ERRORS = new Set([
  // Startup stages can expose this bounded, public error while the freshly
  // prepared Broker finishes its first local IPC handoff. Retrying stays
  // within the canonical first-run deadline and never broadens auth scope.
  "internal_error",
  "secrets_broker_not_prepared",
  "secrets_broker_unavailable",
  "secrets_broker_start_failed",
  "secrets_broker_not_ready",
  "secrets_broker_registry_load_failed",
]);
const SECRET_PATTERN = /token|secret|password|recovery|cookie|credential|authorization|api[_-]?key|master-?key|signing|private.?key/i;

/**
 * @typedef {object} CanonicalFirstRunResult
 * @property {boolean} ok
 * @property {"skipped" | "completed" | "blocked"} outcome
 * @property {string} classification
 * @property {boolean | null} setupMode
 * @property {string | null} setupState
 * @property {number | null} bootstrapStatus
 * @property {number | null} startAllStatus
 * @property {string[]} blockers
 */

/**
 * Normalizes a runtime base URL without query material.
 *
 * @param {string} runtimeUrl Runtime API URL.
 * @returns {string}
 */
function normalizeRuntimeUrl(runtimeUrl) {
  const parsed = new URL(runtimeUrl);
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString().replace(/\/$/u, "");
}

/**
 * Returns true when the runtime URL hostname is loopback.
 *
 * @param {string} runtimeUrl Runtime API URL.
 * @returns {boolean}
 */
export function isLoopbackRuntimeUrl(runtimeUrl) {
  try {
    const hostname = new URL(runtimeUrl).hostname.replace(/^\[|\]$/g, "");
    return LOOPBACK_HOSTS.has(hostname);
  } catch {
    return false;
  }
}

/**
 * Delay helper for bounded polls.
 *
 * @param {number} ms Milliseconds to wait.
 * @returns {Promise<void>}
 */
function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Builds a secret-free first-run result.
 *
 * @param {Partial<CanonicalFirstRunResult>} input Result fields.
 * @returns {CanonicalFirstRunResult}
 */
function buildResult(input) {
  return {
    ok: input.ok === true,
    outcome: input.outcome ?? "blocked",
    classification: input.classification ?? "first_run_blocked",
    setupMode: typeof input.setupMode === "boolean" ? input.setupMode : null,
    setupState: typeof input.setupState === "string" ? input.setupState : null,
    bootstrapStatus: Number.isInteger(input.bootstrapStatus) ? input.bootstrapStatus : null,
    startAllStatus: Number.isInteger(input.startAllStatus) ? input.startAllStatus : null,
    blockers: Array.isArray(input.blockers) ? [...input.blockers] : [],
  };
}

/**
 * Reads a JSON HTTP response and never returns secret-bearing fields to callers
 * that log evidence. Raw bodies stay local to this function.
 *
 * @param {Response} response Fetch response.
 * @returns {Promise<{ status: number, error: string | null, setupMode: boolean | null, setupState: string | null, bootstrapOk: boolean | null, startAllOk: boolean | null }>}
 */
async function readPublicJson(response) {
  const status = response.status;
  let body = null;
  try {
    body = await response.json();
  } catch {
    return {
      status,
      error: "non_json_response",
      setupMode: null,
      setupState: null,
      bootstrapOk: null,
      startAllOk: null,
    };
  }

  const setup = body && typeof body === "object" ? body.setup : null;
  const bootstrap = body && typeof body === "object" ? body.bootstrap : null;
  const error = body && typeof body === "object" && typeof body.error === "string" && !SECRET_PATTERN.test(body.error)
    ? body.error
    : null;

  return {
    status,
    error,
    setupMode: setup && typeof setup === "object" ? setup.setupMode === true : null,
    setupState: setup && typeof setup === "object" && typeof setup.state === "string" ? setup.state : null,
    bootstrapOk: bootstrap && typeof bootstrap === "object" ? bootstrap.ok === true : null,
    startAllOk: body && typeof body === "object" ? body.ok === true && body.action === "startAll" : null,
  };
}

/**
 * GET /api/setup/status until the API answers or the deadline expires.
 *
 * @param {string} runtimeUrl Runtime API URL.
 * @param {{ fetchImpl: typeof fetch, deadline: number, intervalMs: number }} options Poll options.
 * @returns {Promise<{ status: number, error: string | null, setupMode: boolean | null, setupState: string | null, bootstrapOk: boolean | null, startAllOk: boolean | null } | null>}
 */
async function waitForSetupStatus(runtimeUrl, options) {
  let lastError = "setup_status_unavailable";
  while (Date.now() <= options.deadline) {
    try {
      const response = await options.fetchImpl(`${runtimeUrl}/api/setup/status`, {
        method: "GET",
        signal: AbortSignal.timeout(10_000),
      });
      const parsed = await readPublicJson(response);
      if (parsed.status === 200 && typeof parsed.setupMode === "boolean") {
        return parsed;
      }
      lastError = parsed.error ?? `setup_status_http_${parsed.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : "setup_status_fetch_failed";
    }
    await delay(options.intervalMs);
  }
  return {
    status: 0,
    error: lastError,
    setupMode: null,
    setupState: null,
    bootstrapOk: null,
    startAllOk: null,
  };
}

/**
 * Completes loopback first-run vault bootstrap and confirmed startAll when
 * setup mode is blocking autostart. Non-loopback setup mode fails closed.
 * Callers must treat a blocked result as the recycle outcome; a later verifier
 * pass must not convert that failure into a recycle pass.
 *
 * @param {object} options Recycle options.
 * @param {string} options.runtimeUrl Runtime API URL.
 * @param {number} [options.timeoutMs] Overall bound for status, bootstrap, and startAll.
 * @param {number} [options.pollIntervalMs] Poll interval while the API or Broker is not ready.
 * @param {object} [deps] Test seams.
 * @param {typeof fetch} [deps.fetch] Injected fetch.
 * @returns {Promise<CanonicalFirstRunResult>}
 */
export async function completeCanonicalDemoFirstRun(options, deps = {}) {
  if (typeof options?.runtimeUrl !== "string" || !options.runtimeUrl.trim()) {
    return buildResult({
      ok: false,
      outcome: "blocked",
      classification: "first_run_runtime_url_missing",
      blockers: ["first_run_runtime_url_missing"],
    });
  }

  let runtimeUrl;
  try {
    runtimeUrl = normalizeRuntimeUrl(options.runtimeUrl);
  } catch {
    return buildResult({
      ok: false,
      outcome: "blocked",
      classification: "first_run_runtime_url_invalid",
      blockers: ["first_run_runtime_url_invalid"],
    });
  }

  const fetchImpl = deps.fetch ?? globalThis.fetch;
  const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
    ? options.timeoutMs
    : 5 * 60 * 1000;
  const intervalMs = Number.isFinite(options.pollIntervalMs) && options.pollIntervalMs > 0
    ? options.pollIntervalMs
    : 500;
  const deadline = Date.now() + timeoutMs;
  const loopback = isLoopbackRuntimeUrl(runtimeUrl);
  const status = await waitForSetupStatus(runtimeUrl, { fetchImpl, deadline, intervalMs });

  if (!status || typeof status.setupMode !== "boolean") {
    return buildResult({
      ok: false,
      outcome: "blocked",
      classification: "first_run_setup_status_unavailable",
      blockers: [status?.error ?? "first_run_setup_status_unavailable"],
    });
  }

  if (status.setupMode !== true) {
    return buildResult({
      ok: true,
      outcome: "skipped",
      classification: "setup_not_required",
      setupMode: false,
      setupState: status.setupState,
    });
  }

  if (!loopback) {
    return buildResult({
      ok: false,
      outcome: "blocked",
      classification: "first_run_bootstrap_not_loopback",
      setupMode: true,
      setupState: status.setupState,
      blockers: ["first_run_bootstrap_not_loopback"],
    });
  }

  let bootstrap = null;
  while (Date.now() <= deadline) {
    try {
      const response = await fetchImpl(`${runtimeUrl}/api/setup/bootstrap`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
        signal: AbortSignal.timeout(60_000),
      });
      bootstrap = await readPublicJson(response);
      if (bootstrap.status === 201 && bootstrap.bootstrapOk === true && bootstrap.setupMode === false) {
        break;
      }
      if (bootstrap.status === 403 || (bootstrap.error && !RETRYABLE_BOOTSTRAP_ERRORS.has(bootstrap.error))) {
        return buildResult({
          ok: false,
          outcome: "blocked",
          classification: bootstrap.error ?? `first_run_bootstrap_http_${bootstrap.status}`,
          setupMode: bootstrap.setupMode ?? true,
          setupState: bootstrap.setupState ?? status.setupState,
          bootstrapStatus: bootstrap.status,
          blockers: [bootstrap.error ?? `first_run_bootstrap_http_${bootstrap.status}`],
        });
      }
    } catch (error) {
      bootstrap = {
        status: 0,
        error: error instanceof Error ? error.message : "bootstrap_fetch_failed",
        setupMode: true,
        setupState: status.setupState,
        bootstrapOk: false,
        startAllOk: null,
      };
    }
    await delay(intervalMs);
  }

  if (bootstrap?.status !== 201 || bootstrap.bootstrapOk !== true || bootstrap.setupMode !== false) {
    return buildResult({
      ok: false,
      outcome: "blocked",
      classification: bootstrap?.error ?? "first_run_bootstrap_timeout",
      setupMode: bootstrap?.setupMode ?? true,
      setupState: bootstrap?.setupState ?? status.setupState,
      bootstrapStatus: bootstrap?.status ?? null,
      blockers: [bootstrap?.error ?? "first_run_bootstrap_timeout"],
    });
  }

  let startAll = null;
  while (Date.now() <= deadline) {
    try {
      const response = await fetchImpl(`${runtimeUrl}/api/runtime/actions/startAll`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirm: true }),
        signal: AbortSignal.timeout(120_000),
      });
      startAll = await readPublicJson(response);
      if (startAll.status === 200 && startAll.startAllOk === true) {
        return buildResult({
          ok: true,
          outcome: "completed",
          classification: "first_run_completed",
          setupMode: false,
          setupState: bootstrap.setupState ?? "not_required",
          bootstrapStatus: 201,
          startAllStatus: 200,
        });
      }
      if (startAll.status === 401 || startAll.status === 403) {
        return buildResult({
          ok: false,
          outcome: "blocked",
          classification: startAll.error ?? `first_run_start_all_http_${startAll.status}`,
          setupMode: false,
          setupState: bootstrap.setupState,
          bootstrapStatus: 201,
          startAllStatus: startAll.status,
          blockers: [startAll.error ?? `first_run_start_all_http_${startAll.status}`],
        });
      }
    } catch (error) {
      startAll = {
        status: 0,
        error: error instanceof Error ? error.message : "start_all_fetch_failed",
        setupMode: false,
        setupState: bootstrap.setupState,
        bootstrapOk: true,
        startAllOk: false,
      };
    }
    await delay(intervalMs);
  }

  return buildResult({
    ok: false,
    outcome: "blocked",
    classification: startAll?.error ?? "first_run_start_all_timeout",
    setupMode: false,
    setupState: bootstrap.setupState,
    bootstrapStatus: 201,
    startAllStatus: startAll?.status ?? null,
    blockers: [startAll?.error ?? "first_run_start_all_timeout"],
  });
}
