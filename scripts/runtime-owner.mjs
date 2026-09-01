import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";

const DIAGNOSTIC_SCHEMA = "service-lasso.runtime-owner-failure.v1";
const BASELINE_START_SCHEMA = "service-lasso.baseline-start.v1";
const WORKSPACE_LIFECYCLE_SCHEMA = "service-lasso.workspace-lifecycle.v1";
const ACTIVE_PHASES = new Set(["starting", "running"]);
const RUNTIME_INSTANCE_SCHEMA_V2 = "service-lasso.runtime-instance.v2";

export function requireRuntimeServicePort(service, portName) {
  const port = service?.lifecycle?.runtime?.ports?.[portName];
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    const serviceId = typeof service?.id === "string" ? service.id : "unknown";
    throw new Error(`Authoritative runtime port is unavailable for service ${serviceId} port ${portName}.`);
  }
  return port;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function samePath(left, right) {
  const normalize = (value) => {
    const resolved = path.resolve(value);
    return process.platform === "win32" ? resolved.toLowerCase() : resolved;
  };
  return typeof left === "string" && typeof right === "string" && normalize(left) === normalize(right);
}

function workspaceIdFor(workspaceRoot) {
  return `slw_${createHash("sha256").update(path.resolve(workspaceRoot)).digest("hex").slice(0, 16)}`;
}

function ownerCause(exit) {
  if (exit?.signal) return "signal";
  if (exit?.code === 0) return "clean_exit";
  return "nonzero_exit";
}

function summarizeInstance(record) {
  if (!record || typeof record !== "object" || Array.isArray(record)) return null;
  return {
    instanceId: typeof record.instanceId === "string" ? record.instanceId : null,
    generationId: typeof record.generationId === "string" ? record.generationId : null,
    pid: Number.isInteger(record.pid) ? record.pid : null,
    apiPort: Number.isInteger(record.apiPort) ? record.apiPort : null,
    phase: typeof record.phase === "string" ? record.phase : null,
    status: typeof record.status === "string" ? record.status : null,
  };
}

function diagnostic(code, owner, record, extra = {}) {
  return {
    schema: DIAGNOSTIC_SCHEMA,
    code,
    observedAt: new Date().toISOString(),
    owner: {
      pid: owner.pid,
      exitCode: owner.exit?.code ?? null,
      signal: owner.exit?.signal ?? null,
    },
    runtime: summarizeInstance(record),
    ...extra,
  };
}

function isProcessResourceExit(exit) {
  return exit?.code === 134 || exit?.code === 137 || exit?.code === 3221225477 || exit?.code === 3221225725;
}

export class RuntimeOwnerFailure extends Error {
  constructor(details, cleanupApiUrl = null) {
    super(JSON.stringify(details));
    this.name = "RuntimeOwnerFailure";
    this.code = details.code;
    this.diagnostic = details;
    this.cleanupApiUrl = cleanupApiUrl;
  }
}

export function observeBoundedJsonObject(stream, maxBytes = 2 * 1024 * 1024) {
  let bytes = 0;
  let buffer = "";
  let settled = false;
  const decoder = new StringDecoder("utf8");
  let resolveValue;
  let rejectValue;
  const value = new Promise((resolve, reject) => {
    resolveValue = resolve;
    rejectValue = reject;
  });

  stream.on("data", (chunk) => {
    if (settled) return;
    bytes += chunk.length;
    if (bytes > maxBytes) {
      settled = true;
      buffer = "";
      rejectValue(new Error("bounded_output_limit"));
      return;
    }
    buffer += decoder.write(chunk);
    try {
      const parsed = JSON.parse(buffer);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        settled = true;
        buffer = "";
        resolveValue(parsed);
      }
    } catch {
      // Pretty-printed JSON is incomplete until the final chunk arrives.
    }
  });

  const rejectStream = (code) => {
    if (!settled) {
      settled = true;
      buffer = "";
      rejectValue(new Error(code));
    }
  };
  const finishStream = () => {
    if (settled) return;
    buffer += decoder.end();
    try {
      const parsed = JSON.parse(buffer);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        settled = true;
        buffer = "";
        resolveValue(parsed);
        return;
      }
    } catch {}
    rejectStream("output_stream_ended");
  };
  stream.once("error", () => rejectStream("output_stream_error"));
  stream.once("end", finishStream);
  stream.once("close", finishStream);

  return { value, get bytes() { return bytes; } };
}

export function ownerExitFailure(owner, record = null) {
  return new RuntimeOwnerFailure(
    diagnostic("owning_runtime_exited", owner, record, {
      causeClass: isProcessResourceExit(owner.exit) ? "resource_exhaustion" : ownerCause(owner.exit),
    }),
  );
}

function validatedApiUrl(record) {
  if (typeof record.apiUrl !== "string") return null;
  try {
    const parsed = new URL(record.apiUrl);
    const port = Number(parsed.port || (parsed.protocol === "http:" ? 80 : 0));
    if (
      parsed.protocol !== "http:" ||
      parsed.hostname !== "127.0.0.1" ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash ||
      (parsed.pathname !== "" && parsed.pathname !== "/") ||
      port !== record.apiPort
    ) {
      return null;
    }
    return `http://127.0.0.1:${port}`;
  } catch {
    return null;
  }
}

function validateRecord(record, { owner, servicesRoot, workspaceRoot }) {
  if (
    !record ||
    typeof record !== "object" ||
    Array.isArray(record) ||
    record.pid !== owner.pid ||
    !samePath(record.servicesRoot, servicesRoot) ||
    !samePath(record.workspaceRoot, workspaceRoot) ||
    record.status !== "active" ||
    !ACTIVE_PHASES.has(record.phase) ||
    typeof record.instanceId !== "string" ||
    !record.instanceId ||
    typeof record.generationId !== "string" ||
    !record.generationId
  ) {
    return null;
  }
  const apiUrl = validatedApiUrl(record);
  return apiUrl ? { apiUrl, record } : null;
}

async function readRuntimeInstance(workspaceRoot) {
  const filePath = path.join(workspaceRoot, ".service-lasso", "runtime-instance.json");
  try {
    const parsed = JSON.parse(await readFile(filePath, "utf8"));
    if (parsed?.schemaVersion !== RUNTIME_INSTANCE_SCHEMA_V2) {
      return parsed;
    }
    if (
      parsed.version !== 2 ||
      parsed.workspaceId !== workspaceIdFor(workspaceRoot) ||
      !samePath(parsed.canonicalWorkspaceRoot, workspaceRoot) ||
      !parsed.instance ||
      typeof parsed.instance !== "object" ||
      Array.isArray(parsed.instance)
    ) {
      throw new Error("Runtime instance envelope does not match this workspace.");
    }
    return parsed.instance;
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function fetchHealth(apiUrl, timeoutMs) {
  const response = await fetch(`${apiUrl}/api/health`, { signal: AbortSignal.timeout(timeoutMs) });
  const body = await response.json().catch(() => null);
  return response.ok && body?.status === "ok" && body?.api?.status === "up" ? body : null;
}

export async function discoverOwningRuntime({
  owner,
  servicesRoot,
  workspaceRoot,
  publishTimeoutMs = 60_000,
  healthTimeoutMs = 15_000,
  pollIntervalMs = 100,
}) {
  const publishDeadline = Date.now() + publishTimeoutMs;
  let validated = null;

  while (Date.now() < publishDeadline && !validated) {
    if (owner.exit) throw ownerExitFailure(owner);
    let record;
    try {
      record = await readRuntimeInstance(workspaceRoot);
    } catch {
      throw new RuntimeOwnerFailure(diagnostic("runtime_instance_unreadable", owner, null, { causeClass: "invalid_state" }));
    }
    if (record) {
      validated = validateRecord(record, { owner, servicesRoot, workspaceRoot });
      if (!validated) {
        throw new RuntimeOwnerFailure(diagnostic("runtime_instance_wrong_owner", owner, record, { causeClass: "ownership_mismatch" }));
      }
      break;
    }
    await Promise.race([owner.closed, sleep(pollIntervalMs)]);
  }

  if (owner.exit) throw ownerExitFailure(owner, validated?.record);
  if (!validated) {
    throw new RuntimeOwnerFailure(diagnostic("runtime_instance_not_published", owner, null, { causeClass: "publish_timeout" }));
  }

  const healthDeadline = Date.now() + healthTimeoutMs;
  while (Date.now() < healthDeadline) {
    if (owner.exit) throw ownerExitFailure(owner, validated.record);
    try {
      const health = await Promise.race([
        fetchHealth(validated.apiUrl, Math.min(1_000, Math.max(1, healthDeadline - Date.now()))),
        owner.closed.then(() => null),
      ]);
      if (owner.exit) throw ownerExitFailure(owner, validated.record);
      if (health) {
        return {
          apiUrl: validated.apiUrl,
          instanceId: validated.record.instanceId,
          generationId: validated.record.generationId,
          ownerPid: validated.record.pid,
          health,
          record: validated.record,
        };
      }
    } catch (error) {
      if (error instanceof RuntimeOwnerFailure) throw error;
    }
    await Promise.race([owner.closed, sleep(pollIntervalMs)]);
  }

  if (owner.exit) throw ownerExitFailure(owner, validated.record);
  throw new RuntimeOwnerFailure(
    diagnostic("owning_api_unreachable", owner, validated.record, { causeClass: "health_timeout" }),
    validated.apiUrl,
  );
}

export async function waitForBaselineCompletion({
  owner,
  runtime,
  output,
  servicesRoot,
  workspaceRoot,
  timeoutMs = 10 * 60_000,
}) {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ kind: "timeout" }), timeoutMs);
    timer.unref?.();
  });
  const outcome = await Promise.race([
    output.value.then(
      (payload) => ({ kind: "payload", payload }),
      (error) => ({ kind: "output_error", error }),
    ),
    owner.closed.then(() => ({ kind: "owner_exit" })),
    timeout,
  ]);
  clearTimeout(timer);

  if (outcome.kind === "owner_exit" || owner.exit) {
    throw ownerExitFailure(owner, runtime.record);
  }
  if (outcome.kind === "timeout") {
    throw new RuntimeOwnerFailure(
      diagnostic("baseline_completion_timeout", owner, runtime.record, {
        causeClass: "completion_timeout",
        outputBytes: output.bytes,
      }),
      runtime.apiUrl,
    );
  }
  if (outcome.kind === "output_error") {
    const causeClass = outcome.error?.message === "bounded_output_limit"
      ? "output_limit"
      : outcome.error?.message === "output_stream_ended"
        ? "output_stream_ended"
        : "output_stream_error";
    throw new RuntimeOwnerFailure(
      diagnostic("baseline_output_invalid", owner, runtime.record, {
        causeClass,
        outputBytes: output.bytes,
      }),
      runtime.apiUrl,
    );
  }

  const payload = outcome.payload;
  const schemaOk = payload.schema === BASELINE_START_SCHEMA
    || (payload.schema === WORKSPACE_LIFECYCLE_SCHEMA && (payload.outcome === "started" || payload.outcome === "restarted"));
  const valid =
    schemaOk &&
    (payload.status === "completed" || payload.ok === true) &&
    payload.ownerPid === owner.pid &&
    payload.instanceId === runtime.instanceId &&
    payload.generationId === runtime.generationId &&
    payload.apiUrl === runtime.apiUrl &&
    samePath(payload.servicesRoot, servicesRoot) &&
    samePath(payload.workspaceRoot, workspaceRoot) &&
    Array.isArray(payload.requestedServiceIds) &&
    payload.requestedServiceIds.every((entry) => typeof entry === "string") &&
    Array.isArray(payload.serviceOrder) &&
    payload.serviceOrder.every((entry) => typeof entry === "string") &&
    Array.isArray(payload.services) &&
    payload.services.every((entry) =>
      entry && typeof entry === "object" && typeof entry.serviceId === "string" &&
      (entry.status === "completed" || entry.status === "skipped")
    );
  if (!valid) {
    throw new RuntimeOwnerFailure(
      diagnostic("baseline_output_invalid", owner, runtime.record, {
        causeClass: "contract_mismatch",
        outputBytes: output.bytes,
      }),
      runtime.apiUrl,
    );
  }

  return payload;
}
