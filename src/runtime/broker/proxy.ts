import type { IncomingMessage, ServerResponse } from "node:http";
import type { DiscoveredService } from "../../contracts/service.js";
import { ApiError } from "../../server/errors.js";
import {
  requestSecretsBrokerManagement,
  type SecretsBrokerManagementRequest,
  type SecretsBrokerManagementResponse,
} from "./client.js";
import {
  requestSecretsBrokerHttp,
  SECRETSBROKER_IPC_MAX_BYTES,
  type SecretsBrokerHttpRequester,
} from "./ipc-transport.js";
import { readSecretsBrokerOperatorConfig, resolveSecretsBrokerPort, resolveSecretsBrokerTransport } from "./operator-config.js";

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailers",
  "transfer-encoding",
  "upgrade",
  "host",
  "content-length",
]);

/**
 * Read a bounded request body. Oversized payloads fail closed without logging contents.
 */
async function readRequestBody(request: IncomingMessage): Promise<Buffer | undefined> {
  const method = (request.method ?? "GET").toUpperCase();
  if (method === "GET" || method === "HEAD") {
    return undefined;
  }

  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.byteLength;
    if (total > SECRETSBROKER_IPC_MAX_BYTES) {
      throw new ApiError("payload_too_large", 413, "Secrets Broker request exceeds the size limit.");
    }
    chunks.push(buffer);
  }

  return Buffer.concat(chunks);
}

const ADMIN_SECRETS_LIST_SUFFIXES = new Set(["secrets", "secrets/management"]);

/**
 * Map Service Admin operator routes onto Secrets Broker `/v1` paths.
 *
 * Admin 478 calls Core-owned convenience URLs such as
 * `/api/services/@secretsbroker/secrets/reveal`. The daemon serves
 * `/v1/management/secrets/reveal`. Unknown suffixes return null so Core can 404.
 *
 * @param suffix Path after `/api/services/@secretsbroker/`
 */
export function resolveSecretsBrokerAdminAliasPath(suffix: string): string | null {
  const normalized = suffix.replace(/^\/+/u, "").replace(/\/+$/u, "");
  if (!normalized) {
    return null;
  }

  if (ADMIN_SECRETS_LIST_SUFFIXES.has(normalized)) {
    return "/v1/management/secrets";
  }

  if (normalized.startsWith("secrets/")) {
    return `/v1/management/${normalized}`;
  }

  if (normalized.startsWith("providers/")) {
    return `/v1/${normalized}`;
  }

  if (normalized === "lifecycle/backups/create") {
    return "/v1/management/lifecycle/backups";
  }

  if (normalized.startsWith("lifecycle/")) {
    return `/v1/management/${normalized}`;
  }

  if (normalized === "operations/telemetry") {
    return "/v1/telemetry";
  }

  if (normalized === "operations/events") {
    return "/v1/events";
  }

  return null;
}

/**
 * Use the bounded management client with legacy operator credentials when a
 * workspace has not yet migrated to Core-owned protected IPC credentials.
 * Returns null unless both the loopback port and persisted operator token are
 * available; callers must prefer the protected runtime context when present.
 */
export async function requestLegacySecretsBrokerManagement(
  service: DiscoveredService,
  input: SecretsBrokerManagementRequest,
): Promise<SecretsBrokerManagementResponse | null> {
  const port = resolveSecretsBrokerPort(service);
  const operatorConfig = await readSecretsBrokerOperatorConfig(service.serviceRoot);
  if (port === null || !operatorConfig) {
    return null;
  }

  return await requestSecretsBrokerManagement({
    transport: { kind: "loopback-http", url: `http://127.0.0.1:${port}` },
    apiToken: operatorConfig.apiToken,
    workspaceId: "legacy-operator",
    timeoutMs: 30_000,
    managementAuthMode: "bearer",
  }, input);
}

/**
 * Copy Broker response headers onto the Core response, dropping hop-by-hop fields.
 */
function appendProxyResponseHeaders(
  response: ServerResponse,
  upstreamHeaders: IncomingMessage["headers"],
  bodyLength: number,
): void {
  for (const [key, value] of Object.entries(upstreamHeaders)) {
    if (value === undefined) {
      continue;
    }
    if (HOP_BY_HOP_HEADERS.has(key.toLowerCase())) {
      continue;
    }
    response.setHeader(key, value);
  }
  response.setHeader("content-length", String(bodyLength));
}

/**
 * Collect inbound headers for the Broker request. Authorization is replaced by
 * the workspace operator token so the browser never supplies the Broker secret.
 */
function collectUpstreamHeaders(request: IncomingMessage): Record<string, string> {
  const upstreamHeaders: Record<string, string> = {};
  for (const [key, value] of Object.entries(request.headers)) {
    if (value === undefined) {
      continue;
    }

    const lowerKey = key.toLowerCase();
    if (HOP_BY_HOP_HEADERS.has(lowerKey) || lowerKey === "authorization") {
      continue;
    }

    upstreamHeaders[key] = Array.isArray(value) ? value.join(", ") : value;
  }
  return upstreamHeaders;
}

/**
 * Forward a Service Admin broker-management request to the local `@secretsbroker` daemon
 * over named-pipe, Unix-socket, or loopback HTTP. This extends the shipped HTTP alias
 * proxy; it is not a second production Broker client.
 */
export async function proxySecretsBrokerRequest(
  request: IncomingMessage,
  response: ServerResponse,
  service: DiscoveredService,
  proxyPath: string,
  search: string,
  protectedRequester?: SecretsBrokerHttpRequester,
): Promise<void> {
  const operatorConfig = protectedRequester
    ? null
    : await readSecretsBrokerOperatorConfig(service.serviceRoot);
  const target = protectedRequester
    ? null
    : resolveSecretsBrokerTransport(service, process.env, operatorConfig);
  if (!protectedRequester && target === null) {
    throw new ApiError("broker_unavailable", 503, "Secrets Broker transport is unavailable.");
  }

  const normalizedPath = proxyPath.startsWith("/") ? proxyPath : `/${proxyPath}`;
  const upstreamHeaders = collectUpstreamHeaders(request);
  if (operatorConfig?.apiToken && !Object.keys(upstreamHeaders).some((key) => key.toLowerCase() === "authorization")) {
    upstreamHeaders.Authorization = `Bearer ${operatorConfig.apiToken}`;
  }

  const method = request.method ?? "GET";
  const body = await readRequestBody(request);
  const upstreamRequest = {
    method,
    pathWithQuery: `${normalizedPath}${search}`,
    headers: upstreamHeaders,
    body,
  };
  const upstream = protectedRequester
    ? await protectedRequester(upstreamRequest)
    : await requestSecretsBrokerHttp(target!, upstreamRequest);

  response.statusCode = upstream.status;
  appendProxyResponseHeaders(response, upstream.headers, upstream.body.byteLength);
  response.end(upstream.body);
}
