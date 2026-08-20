import type { IncomingMessage, ServerResponse } from "node:http";
import type { DiscoveredService } from "../../contracts/service.js";
import { ApiError } from "../../server/errors.js";
import { readSecretsBrokerOperatorConfig, resolveSecretsBrokerPort } from "./operator-config.js";

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
]);

async function readRequestBody(request: IncomingMessage): Promise<Buffer | undefined> {
  const method = (request.method ?? "GET").toUpperCase();
  if (method === "GET" || method === "HEAD") {
    return undefined;
  }

  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
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

function appendProxyResponseHeaders(
  response: ServerResponse,
  upstreamHeaders: Headers,
): void {
  upstreamHeaders.forEach((value, key) => {
    if (HOP_BY_HOP_HEADERS.has(key.toLowerCase())) {
      return;
    }
    response.setHeader(key, value);
  });
}

/**
 * Forward a Service Admin broker-management request to the local `@secretsbroker` daemon.
 */
export async function proxySecretsBrokerRequest(
  request: IncomingMessage,
  response: ServerResponse,
  service: DiscoveredService,
  proxyPath: string,
  search: string,
): Promise<void> {
  const port = resolveSecretsBrokerPort(service);
  if (port === null) {
    throw new ApiError("broker_unavailable", 503, "Secrets Broker port is unavailable.");
  }

  const normalizedPath = proxyPath.startsWith("/") ? proxyPath : `/${proxyPath}`;
  const targetUrl = `http://127.0.0.1:${port}${normalizedPath}${search}`;
  const upstreamHeaders = new Headers();

  for (const [key, value] of Object.entries(request.headers)) {
    if (value === undefined) {
      continue;
    }

    const lowerKey = key.toLowerCase();
    if (HOP_BY_HOP_HEADERS.has(lowerKey)) {
      continue;
    }
    if (lowerKey === "authorization") {
      continue;
    }

    if (Array.isArray(value)) {
      for (const entry of value) {
        upstreamHeaders.append(key, entry);
      }
      continue;
    }

    upstreamHeaders.set(key, value);
  }

  const operatorConfig = await readSecretsBrokerOperatorConfig(service.serviceRoot);
  if (operatorConfig?.apiToken && !upstreamHeaders.has("authorization")) {
    upstreamHeaders.set("Authorization", `Bearer ${operatorConfig.apiToken}`);
  }

  const method = request.method ?? "GET";
  const body = await readRequestBody(request);
  const upstream = await fetch(targetUrl, {
    method,
    headers: upstreamHeaders,
    body: body && body.length > 0 ? body : undefined,
  });

  response.statusCode = upstream.status;
  appendProxyResponseHeaders(response, upstream.headers);
  response.end(Buffer.from(await upstream.arrayBuffer()));
}
