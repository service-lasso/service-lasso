import { randomUUID } from "node:crypto";
import http from "node:http";

import type {
  BrokerLaunchLookup,
  BrokerLaunchLookupDecision,
  BrokerLaunchLookupStatus,
} from "./launch-resolution.js";

const DEFAULT_TIMEOUT_MS = 5_000;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const MAX_REFS = 128;
const MAX_REQUEST_BYTES = 1024 * 1024;
const SAFE_REF_PATTERN = /^[A-Za-z0-9@._-]+(?:\/[A-Za-z0-9@._-]+)*$/u;

const BROKER_MANAGEMENT_ROUTES = new Map<string, ReadonlySet<"GET" | "POST">>([
  ["/v1/management/secrets", new Set(["GET"])],
  ["/v1/management/secrets/value-search", new Set(["GET"])],
  ["/v1/management/secrets/reveal", new Set(["POST"])],
  ["/v1/management/secrets/create/dry-run", new Set(["POST"])],
  ["/v1/management/secrets/create/apply", new Set(["POST"])],
  ["/v1/management/secrets/edit/dry-run", new Set(["POST"])],
  ["/v1/management/secrets/edit/apply", new Set(["POST"])],
  ["/v1/management/secrets/reset/dry-run", new Set(["POST"])],
  ["/v1/management/secrets/reset/apply", new Set(["POST"])],
  ["/v1/management/secrets/decommission/dry-run", new Set(["POST"])],
  ["/v1/management/secrets/decommission/apply", new Set(["POST"])],
  ["/v1/management/secrets/decommission/restore", new Set(["POST"])],
  ["/v1/management/secrets/rotation/dry-run", new Set(["POST"])],
  ["/v1/management/secrets/rotation/status", new Set(["POST"])],
  ["/v1/management/secrets/rotation/stage", new Set(["POST"])],
  ["/v1/management/secrets/rotation/activate", new Set(["POST"])],
  ["/v1/management/secrets/rotation/rollback", new Set(["POST"])],
  ["/v1/management/secrets/rotation/retire", new Set(["POST"])],
  ["/v1/management/secrets/campaigns/create", new Set(["POST"])],
  ["/v1/management/secrets/campaigns/revalidate", new Set(["POST"])],
  ["/v1/management/secrets/campaigns/apply", new Set(["POST"])],
  ["/v1/management/secrets/campaigns/status", new Set(["POST"])],
  ["/v1/management/secrets/sync/dry-run", new Set(["POST"])],
  ["/v1/management/secrets/policy/preview", new Set(["POST"])],
  ["/v1/management/secrets/policy/apply", new Set(["POST"])],
  ["/v1/management/lockouts/clear", new Set(["POST"])],
  ["/v1/providers/capabilities", new Set(["GET"])],
  ["/v1/providers/config/status", new Set(["GET"])],
  ["/v1/providers/config/validate", new Set(["POST"])],
  ["/v1/providers/config/apply", new Set(["POST"])],
  ["/v1/providers/migration/dry-run", new Set(["POST"])],
  ["/v1/providers/migration/apply", new Set(["POST"])],
  ["/v1/management/lifecycle/status", new Set(["GET"])],
  ["/v1/management/lifecycle/backups", new Set(["GET", "POST"])],
  ["/v1/management/lifecycle/backups/verify", new Set(["POST"])],
  ["/v1/management/lifecycle/restore/dry-run", new Set(["POST"])],
  ["/v1/management/lifecycle/restore/apply", new Set(["POST"])],
  ["/v1/management/lifecycle/key/rotate", new Set(["POST"])],
  ["/v1/telemetry", new Set(["GET"])],
  ["/v1/events", new Set(["GET"])],
]);

const BROKER_EVENT_QUERY_FIELDS = new Set([
  "since",
  "until",
  "serviceId",
  "providerId",
  "sourceId",
  "operation",
  "outcome",
  "severity",
  "family",
  "refPrefix",
  "refHash",
  "limit",
  "cursor",
]);

function containsUnsafeQueryCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code <= 0x1f || code === 0x7f;
  });
}

export type SecretsBrokerClientTransport =
  | { kind: "loopback-http"; url: string }
  | { kind: "unix-socket" | "windows-named-pipe"; socketPath: string };

export interface SecretsBrokerClientOptions {
  transport: SecretsBrokerClientTransport;
  apiToken: string;
  workspaceId: string;
  timeoutMs?: number;
  managementAuthMode?: "token-header" | "bearer";
}

export interface SecretsBrokerWritebackRequest {
  serviceId: string;
  identityExpiresAt: string;
  identityLease: unknown;
  namespace: string;
  ref: string;
  operation: "create" | "update" | "rotate" | "delete";
  allowedNamespaces: string[];
  allowedOperations: string[];
  value: string;
}

export interface SecretsBrokerWritebackResult {
  ok: boolean;
  outcome: string;
  ref: string;
}

interface BrokerResolveResult {
  ref?: unknown;
  outcome?: unknown;
  value?: unknown;
}

interface BrokerResolveResponse {
  requestId?: unknown;
  results?: unknown;
}

export interface SecretsBrokerProbeResult {
  ready: boolean;
  state: string | null;
}

export interface SecretsBrokerManagementRequest {
  method: "GET" | "POST";
  path: string;
  body?: unknown;
}

export interface SecretsBrokerManagementResponse {
  statusCode: number;
  body: unknown;
}

export class SecretsBrokerManagementError extends Error {
  readonly code:
    | "invalid_request"
    | "broker_unavailable"
    | "response_too_large"
    | "invalid_response";

  constructor(code: SecretsBrokerManagementError["code"], message: string) {
    super(message);
    this.name = "SecretsBrokerManagementError";
    this.code = code;
  }
}

function normalizeTimeout(value: number | undefined): number {
  if (value === undefined) return DEFAULT_TIMEOUT_MS;
  if (!Number.isInteger(value) || value < 100 || value > 30_000) {
    throw new Error("Secrets Broker timeout must be between 100 and 30000 milliseconds.");
  }
  return value;
}

function validateToken(value: string): string {
  const token = value.trim();
  if (token.length < 16 || token.length > 4096) {
    throw new Error("Secrets Broker API token is missing or invalid.");
  }
  return token;
}

function validateWorkspaceId(value: string): string {
  const workspaceId = value.trim();
  if (!/^[A-Za-z0-9._-]{1,128}$/u.test(workspaceId)) {
    throw new Error("Secrets Broker workspace id is invalid.");
  }
  return workspaceId;
}

function validateTransport(transport: SecretsBrokerClientTransport): SecretsBrokerClientTransport {
  if (transport.kind === "loopback-http") {
    const url = new URL(transport.url);
    const hostname = url.hostname.replace(/^\[|\]$/gu, "").toLowerCase();
    if (url.protocol !== "http:" || !["127.0.0.1", "::1", "localhost"].includes(hostname) || url.username || url.password || url.search || url.hash) {
      throw new Error("Secrets Broker HTTP transport must be an uncredentialed loopback HTTP origin.");
    }
    return { kind: transport.kind, url: url.origin };
  }

  const socketPath = transport.socketPath.trim();
  if (socketPath.length === 0 || socketPath.length > 2048 || socketPath.includes("\0")) {
    throw new Error("Secrets Broker socket path is invalid.");
  }
  if (transport.kind === "windows-named-pipe" && !socketPath.toLowerCase().startsWith("\\\\.\\pipe\\")) {
    throw new Error("Secrets Broker named pipe must use the Windows pipe namespace.");
  }
  return { kind: transport.kind, socketPath };
}

function validateManagementTarget(method: "GET" | "POST", value: string): string {
  let target: URL;
  try {
    target = new URL(value, "http://secretsbroker.local");
  } catch {
    throw new SecretsBrokerManagementError("invalid_request", "Secrets Broker management path is invalid.");
  }
  if (target.origin !== "http://secretsbroker.local" || target.hash || !BROKER_MANAGEMENT_ROUTES.get(target.pathname)?.has(method)) {
    throw new SecretsBrokerManagementError("invalid_request", "Secrets Broker management route is not allowlisted.");
  }
  const allowedQuery = target.pathname === "/v1/management/secrets"
    ? new Set(["search"])
    : target.pathname === "/v1/management/secrets/value-search"
      ? new Set(["query"])
      : target.pathname === "/v1/events"
        ? BROKER_EVENT_QUERY_FIELDS
      : new Set<string>();
  const seenQuery = new Set<string>();
  for (const [name, queryValue] of target.searchParams.entries()) {
    const numeric = name === "limit" || name === "cursor";
    if (
      !allowedQuery.has(name) ||
      seenQuery.has(name) ||
      queryValue.length > 256 ||
      containsUnsafeQueryCharacter(queryValue) ||
      (numeric && !/^\d{1,10}$/u.test(queryValue))
    ) {
      throw new SecretsBrokerManagementError("invalid_request", "Secrets Broker management query is invalid.");
    }
    seenQuery.add(name);
  }
  return `${target.pathname}${target.search}`;
}

export async function requestSecretsBrokerManagement(
  options: SecretsBrokerClientOptions,
  input: SecretsBrokerManagementRequest,
): Promise<SecretsBrokerManagementResponse> {
  const transport = validateTransport(options.transport);
  const token = validateToken(options.apiToken);
  const timeoutMs = normalizeTimeout(options.timeoutMs);
  const requestPath = validateManagementTarget(input.method, input.path);
  const managementAuthMode = options.managementAuthMode ?? "token-header";
  const body = input.method === "POST" ? JSON.stringify(input.body ?? {}) : undefined;
  if (body !== undefined && Buffer.byteLength(body) > MAX_REQUEST_BYTES) {
    throw new SecretsBrokerManagementError("invalid_request", "Secrets Broker management request is too large.");
  }

  return await new Promise((resolve, reject) => {
    const url = transport.kind === "loopback-http" ? new URL(requestPath, transport.url) : null;
    const connection = transport.kind === "loopback-http"
      ? { protocol: url!.protocol, hostname: url!.hostname, port: url!.port, path: `${url!.pathname}${url!.search}` }
      : { socketPath: transport.socketPath, path: requestPath };
    const request = http.request({
      method: input.method,
      ...connection,
      headers: {
        accept: "application/json",
        ...(managementAuthMode === "bearer"
          ? { authorization: `Bearer ${token}` }
          : { "x-secretsbroker-token": token }),
        ...(body === undefined
          ? {}
          : {
              "content-type": "application/json",
              "content-length": Buffer.byteLength(body),
            }),
      },
    }, (response) => {
      const chunks: Buffer[] = [];
      let bytes = 0;
      response.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes <= MAX_RESPONSE_BYTES) chunks.push(chunk);
      });
      response.on("end", () => {
        if (bytes > MAX_RESPONSE_BYTES) {
          reject(new SecretsBrokerManagementError("response_too_large", "Secrets Broker management response exceeded the limit."));
          return;
        }
        if (!(response.headers["content-type"] ?? "").toLowerCase().includes("application/json")) {
          reject(new SecretsBrokerManagementError("invalid_response", "Secrets Broker management response was not JSON."));
          return;
        }
        try {
          resolve({
            statusCode: response.statusCode ?? 502,
            body: JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown,
          });
        } catch {
          reject(new SecretsBrokerManagementError("invalid_response", "Secrets Broker management response was invalid JSON."));
        }
      });
      response.on("error", () => reject(
        new SecretsBrokerManagementError("broker_unavailable", "Secrets Broker management response failed."),
      ));
    });
    request.setTimeout(timeoutMs, () => request.destroy());
    request.on("error", () => reject(
      new SecretsBrokerManagementError("broker_unavailable", "Secrets Broker management transport is unavailable."),
    ));
    request.end(body);
  });
}

function mapOutcome(value: unknown): BrokerLaunchLookupStatus {
  switch (value) {
    case "ready":
      return "resolved";
    case "missing_ref":
    case "missing":
      return "missing";
    case "locked":
      return "locked";
    case "source_auth_required":
    case "auth_required":
      return "auth-required";
    case "policy_denied":
      return "policy-denied";
    case "source_unavailable":
    case "unavailable":
      return "source-unavailable";
    default:
      return "degraded";
  }
}

function degraded(refs: string[]): BrokerLaunchLookupDecision[] {
  return refs.map((ref) => ({ ref, status: "degraded" }));
}

function canonicalBrokerRefs(
  service: Parameters<BrokerLaunchLookup>[0]["service"],
  refs: string[],
): { outbound: string[]; originalByOutbound: Map<string, string> } | null {
  const namespaceByRef = new Map(
    (service.manifest.broker?.imports ?? []).map((entry) => [entry.ref, entry.namespace]),
  );
  const outbound: string[] = [];
  const originalByOutbound = new Map<string, string>();
  for (const ref of refs) {
    const namespace = namespaceByRef.get(ref)?.replace(/\/+$/u, "");
    const canonical = namespace ? `${namespace}/${ref.replace(/^\/+|\/+$/gu, "")}` : ref;
    if (!SAFE_REF_PATTERN.test(canonical) || originalByOutbound.has(canonical)) return null;
    outbound.push(canonical);
    originalByOutbound.set(canonical, ref);
  }
  return { outbound, originalByOutbound };
}

function parseResponse(
  raw: Buffer,
  statusCode: number,
  requestId: string,
  refs: string[],
): BrokerLaunchLookupDecision[] {
  if (statusCode !== 200) {
    return degraded(refs);
  }

  let payload: BrokerResolveResponse;
  try {
    payload = JSON.parse(raw.toString("utf8")) as BrokerResolveResponse;
  } catch {
    return degraded(refs);
  }
  if (payload.requestId !== requestId || !Array.isArray(payload.results)) {
    return degraded(refs);
  }

  const expected = new Set(refs);
  const seen = new Set<string>();
  const decisions: BrokerLaunchLookupDecision[] = [];
  for (const item of payload.results as BrokerResolveResult[]) {
    if (!item || typeof item !== "object" || typeof item.ref !== "string" || !expected.has(item.ref) || seen.has(item.ref)) {
      return degraded(refs);
    }
    seen.add(item.ref);
    const status = mapOutcome(item.outcome);
    if (status === "resolved") {
      if (typeof item.value !== "string") return degraded(refs);
      decisions.push({ ref: item.ref, status, value: item.value });
    } else {
      decisions.push({ ref: item.ref, status });
    }
  }
  if (seen.size !== expected.size) return degraded(refs);
  return decisions;
}

async function postResolve(
  transport: SecretsBrokerClientTransport,
  token: string,
  timeoutMs: number,
  body: string,
  requestId: string,
  refs: string[],
): Promise<BrokerLaunchLookupDecision[]> {
  return await new Promise((resolve) => {
    const url = transport.kind === "loopback-http" ? new URL("/v1/resolve", transport.url) : null;
    const connection = transport.kind === "loopback-http"
      ? { protocol: url!.protocol, hostname: url!.hostname, port: url!.port, path: url!.pathname }
      : { socketPath: transport.socketPath, path: "/v1/resolve" };
    const request = http.request(
      {
        method: "POST",
        ...connection,
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(body),
          "x-secretsbroker-token": token,
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        let bytes = 0;
        response.on("data", (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes <= MAX_RESPONSE_BYTES) chunks.push(chunk);
        });
        response.on("end", () => {
          if (bytes > MAX_RESPONSE_BYTES) {
            resolve(degraded(refs));
            return;
          }
          resolve(parseResponse(Buffer.concat(chunks), response.statusCode ?? 0, requestId, refs));
        });
        response.on("error", () => resolve(degraded(refs)));
      },
    );
    request.setTimeout(timeoutMs, () => request.destroy());
    request.on("error", () => resolve(degraded(refs)));
    request.end(body);
  });
}

export function createSecretsBrokerLaunchLookup(options: SecretsBrokerClientOptions): BrokerLaunchLookup {
  const transport = validateTransport(options.transport);
  const token = validateToken(options.apiToken);
  const workspaceId = validateWorkspaceId(options.workspaceId);
  const timeoutMs = normalizeTimeout(options.timeoutMs);

  return async ({ service, refs, identityLease }) => {
    const requestedRefs = [...new Set(refs.map((ref) => ref.trim()))];
    if (requestedRefs.length === 0) return [];
    if (requestedRefs.length > MAX_REFS || requestedRefs.some((ref) => !SAFE_REF_PATTERN.test(ref))) {
      return degraded(requestedRefs);
    }
    if (!identityLease || typeof identityLease !== "object" || Array.isArray(identityLease)) {
      return degraded(requestedRefs);
    }
    const canonical = canonicalBrokerRefs(service, requestedRefs);
    if (!canonical) return degraded(requestedRefs);

    const requestId = randomUUID();
    const body = JSON.stringify({
      requestId,
      workspaceId,
      serviceId: service.manifest.id,
      identityLease,
      purpose: "service_startup",
      refs: canonical.outbound,
    });
    const decisions = await postResolve(
      transport,
      token,
      timeoutMs,
      body,
      requestId,
      canonical.outbound,
    );
    return decisions.map((decision) => ({
      ...decision,
      ref: canonical.originalByOutbound.get(decision.ref) ?? decision.ref,
    }));
  };
}

export async function probeSecretsBroker(options: SecretsBrokerClientOptions): Promise<SecretsBrokerProbeResult> {
  const transport = validateTransport(options.transport);
  const token = validateToken(options.apiToken);
  const timeoutMs = normalizeTimeout(options.timeoutMs);
  return await new Promise((resolve) => {
    const url = transport.kind === "loopback-http" ? new URL("/ready", transport.url) : null;
    const connection = transport.kind === "loopback-http"
      ? { protocol: url!.protocol, hostname: url!.hostname, port: url!.port, path: url!.pathname }
      : { socketPath: transport.socketPath, path: "/ready" };
    const request = http.request({
      method: "GET",
      ...connection,
      headers: { "x-secretsbroker-token": token },
    }, (response) => {
      const chunks: Buffer[] = [];
      let bytes = 0;
      response.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes <= MAX_RESPONSE_BYTES) chunks.push(chunk);
      });
      response.on("end", () => {
        if (bytes > MAX_RESPONSE_BYTES || response.statusCode !== 200) {
          resolve({ ready: false, state: null });
          return;
        }
        try {
          const payload = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
          resolve({
            ready: payload.ready === true && payload.serviceId === "@secretsbroker",
            state: typeof payload.state === "string" ? payload.state : null,
          });
        } catch {
          resolve({ ready: false, state: null });
        }
      });
      response.on("error", () => resolve({ ready: false, state: null }));
    });
    request.setTimeout(timeoutMs, () => request.destroy());
    request.on("error", () => resolve({ ready: false, state: null }));
    request.end();
  });
}

export function createSecretsBrokerWriteback(options: SecretsBrokerClientOptions) {
  const transport = validateTransport(options.transport);
  const token = validateToken(options.apiToken);
  const timeoutMs = normalizeTimeout(options.timeoutMs);
  return async (input: SecretsBrokerWritebackRequest): Promise<SecretsBrokerWritebackResult> => {
    const requestId = randomUUID();
    const fullRef = `${input.namespace.replace(/\/+$/u, "")}/${input.ref.replace(/^\/+|\/+$/gu, "")}`;
    if (!SAFE_REF_PATTERN.test(fullRef) || !input.identityLease || typeof input.identityLease !== "object") {
      return { ok: false, outcome: "invalid_request", ref: fullRef };
    }
    const body = JSON.stringify({
      requestId,
      identity: { serviceId: input.serviceId, expiresAt: input.identityExpiresAt },
      identityLease: input.identityLease,
      policy: {
        allowedNamespaces: input.allowedNamespaces,
        allowedOperations: input.allowedOperations,
      },
      operation: input.operation,
      namespace: input.namespace,
      ref: input.ref,
      value: input.value,
      metadata: { sourceId: `generated:${input.serviceId}` },
    });
    return await new Promise((resolve) => {
      const url = transport.kind === "loopback-http" ? new URL("/v1/writeback", transport.url) : null;
      const connection = transport.kind === "loopback-http"
        ? { protocol: url!.protocol, hostname: url!.hostname, port: url!.port, path: url!.pathname }
        : { socketPath: transport.socketPath, path: "/v1/writeback" };
      const request = http.request({
        method: "POST",
        ...connection,
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(body),
          "x-secretsbroker-token": token,
        },
      }, (response) => {
        const chunks: Buffer[] = [];
        let bytes = 0;
        response.on("data", (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes <= MAX_RESPONSE_BYTES) chunks.push(chunk);
        });
        response.on("end", () => {
          if (response.statusCode !== 200 || bytes > MAX_RESPONSE_BYTES) {
            resolve({ ok: false, outcome: "degraded", ref: fullRef });
            return;
          }
          try {
            const payload = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
            const valid = payload.requestId === requestId && payload.serviceId === "@secretsbroker" &&
              payload.ownerServiceId === input.serviceId && payload.ref === fullRef && payload.outcome === "ready";
            resolve({ ok: valid, outcome: valid ? "ready" : "degraded", ref: fullRef });
          } catch {
            resolve({ ok: false, outcome: "degraded", ref: fullRef });
          }
        });
        response.on("error", () => resolve({ ok: false, outcome: "degraded", ref: fullRef }));
      });
      request.setTimeout(timeoutMs, () => request.destroy());
      request.on("error", () => resolve({ ok: false, outcome: "degraded", ref: fullRef }));
      request.end(body);
    });
  };
}
