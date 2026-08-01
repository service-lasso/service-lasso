import type { IncomingMessage } from "node:http";
import { timingSafeEqual } from "node:crypto";

export type RuntimeAuthActorKind = "local-root" | "zitadel" | "local-token";
export type RuntimeAuthMode = RuntimeAuthActorKind | "blocked";

export interface RuntimeAuthPolicyStatus {
  contractVersion: "service-lasso.auth-status.v1";
  request: {
    clientAddress: string | null;
    local: boolean;
  };
  policy: {
    bindHost: string;
    remoteAuthRequired: boolean;
    trustProxyHeaders: boolean;
    zitadelEnabled: boolean;
    localTokenConfigured: boolean;
  };
  actor: {
    authenticated: boolean;
    kind: RuntimeAuthActorKind | null;
    actorId: string | null;
  };
  mode: RuntimeAuthMode;
  blockers: string[];
}

export interface RuntimeAuthPolicyOptions {
  bindHost: string;
  env?: NodeJS.ProcessEnv;
}

const AUTH_STATUS_CONTRACT_VERSION = "service-lasso.auth-status.v1";

function truthy(value: string | undefined): boolean {
  return value === "1" || value?.toLowerCase() === "true";
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

function normalizeHeaderValue(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function timingSafeStringEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function extractBearerToken(value: string | undefined): string | undefined {
  const header = normalizeHeaderValue(value);
  if (!header) return undefined;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim();
}

function isLoopbackAddress(address: string | undefined | null): boolean {
  if (!address) return false;
  const normalized = address.toLowerCase().replace(/^\[|\]$/g, "");
  return (
    normalized === "localhost" ||
    normalized === "::1" ||
    normalized === "0:0:0:0:0:0:0:1" ||
    normalized.startsWith("127.") ||
    normalized.startsWith("::ffff:127.")
  );
}

function getClientAddress(request: IncomingMessage, trustProxyHeaders: boolean): string | null {
  if (trustProxyHeaders) {
    const forwardedFor = normalizeHeaderValue(firstHeader(request.headers["x-forwarded-for"]));
    if (forwardedFor) {
      return forwardedFor.split(",")[0]?.trim() || null;
    }
    const forwardedAddress = normalizeHeaderValue(firstHeader(request.headers["x-service-lasso-client-address"]));
    if (forwardedAddress) {
      return forwardedAddress;
    }
  }

  return request.socket.remoteAddress ?? null;
}

function resolveLocalTokenActor(
  request: IncomingMessage,
  expectedToken: string | undefined,
): RuntimeAuthPolicyStatus["actor"] | null {
  const expected = normalizeHeaderValue(expectedToken);
  if (!expected) return null;

  const provided =
    normalizeHeaderValue(firstHeader(request.headers["x-service-lasso-admin-token"])) ??
    extractBearerToken(firstHeader(request.headers.authorization));
  if (!provided || !timingSafeStringEqual(expected, provided)) {
    return null;
  }

  return {
    authenticated: true,
    kind: "local-token",
    actorId: "local-admin-token",
  };
}

function resolveZitadelActor(
  request: IncomingMessage,
  zitadelEnabled: boolean,
): RuntimeAuthPolicyStatus["actor"] | null {
  if (!zitadelEnabled) return null;

  const userId =
    normalizeHeaderValue(firstHeader(request.headers["x-service-lasso-zitadel-user-id"])) ??
    normalizeHeaderValue(firstHeader(request.headers["x-service-lasso-user-id"]));
  if (!userId) return null;

  return {
    authenticated: true,
    kind: "zitadel",
    actorId: userId,
  };
}

export function resolveRuntimeRequestAuth(
  request: IncomingMessage,
  options: RuntimeAuthPolicyOptions,
): RuntimeAuthPolicyStatus {
  const env = options.env ?? process.env;
  const trustProxyHeaders = truthy(env.SERVICE_LASSO_TRUST_PROXY_HEADERS);
  const zitadelEnabled = truthy(env.SERVICE_LASSO_ZITADEL_ENABLED);
  const localTokenConfigured = Boolean(normalizeHeaderValue(env.SERVICE_LASSO_LOCAL_ADMIN_TOKEN));
  const clientAddress = getClientAddress(request, trustProxyHeaders);
  const local = isLoopbackAddress(clientAddress);
  const remoteAuthRequired = !local;
  const actor =
    local
      ? { authenticated: true, kind: "local-root" as const, actorId: "local-root" }
      : resolveZitadelActor(request, zitadelEnabled) ??
        resolveLocalTokenActor(request, env.SERVICE_LASSO_LOCAL_ADMIN_TOKEN) ??
        { authenticated: false, kind: null, actorId: null };
  const blockers: string[] = [];

  if (remoteAuthRequired && !actor.authenticated) {
    blockers.push("remote_auth_required");
  }
  if (remoteAuthRequired && !zitadelEnabled && !localTokenConfigured) {
    blockers.push("remote_auth_policy_not_configured");
  }

  return {
    contractVersion: AUTH_STATUS_CONTRACT_VERSION,
    request: {
      clientAddress,
      local,
    },
    policy: {
      bindHost: options.bindHost,
      remoteAuthRequired,
      trustProxyHeaders,
      zitadelEnabled,
      localTokenConfigured,
    },
    actor,
    mode: actor.kind ?? "blocked",
    blockers,
  };
}

export function assertRuntimeRequestAuthorized(auth: RuntimeAuthPolicyStatus): void {
  if (!auth.policy.remoteAuthRequired || auth.actor.authenticated) {
    return;
  }

  throw new Error(auth.blockers[0] ?? "remote_auth_required");
}
