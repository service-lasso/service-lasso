import type { IncomingMessage } from "node:http";
import { timingSafeEqual } from "node:crypto";
import {
  LOCAL_ADMIN_TOKEN_HEADER,
  ORIGINAL_CLIENT_ADDRESS_HEADER,
} from "./local-auth-constants.js";

export type RuntimeAuthActorKind = "local-root" | "zitadel" | "local-token";
export type RuntimeAuthMode = RuntimeAuthActorKind | "blocked";

export interface RuntimeIdentityProvider {
  id: string;
  label: string;
  kind: "zitadel";
  startUrl: string | null;
}

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
    localOperatorConfigured: boolean;
    forceSso: boolean;
    firstRunPending: boolean;
    credentialsAcknowledged: boolean;
    identityProviders: RuntimeIdentityProvider[];
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
  forceSso?: boolean;
  localTokenConfigured?: boolean;
  localOperatorConfigured?: boolean;
  firstRunPending?: boolean;
  credentialsAcknowledged?: boolean;
  identityProviders?: readonly RuntimeIdentityProvider[];
  /**
   * Extra local-secret verifier (issued session or hashed vault token).
   * Must not log the provided secret.
   */
  verifyLocalSecret?: (provided: string) => boolean;
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

/**
 * True when the address is a loopback host or IPv4/IPv6 localhost.
 * Bind addresses such as `0.0.0.0` are not loopback origins.
 */
export function isLoopbackAddress(address: string | undefined | null): boolean {
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

function getImmediatePeerAddress(request: IncomingMessage): string | null {
  return request.socket.remoteAddress ?? null;
}

function getForwardedClientAddress(request: IncomingMessage): string | null {
  const forwardedFor = normalizeHeaderValue(firstHeader(request.headers["x-forwarded-for"]));
  if (forwardedFor) {
    return forwardedFor.split(",")[0]?.trim() || null;
  }
  return normalizeHeaderValue(firstHeader(request.headers[ORIGINAL_CLIENT_ADDRESS_HEADER])) ?? null;
}

/**
 * Effective client for auth: honor forwarded client only from a loopback peer
 * (same-machine Admin proxy). Non-loopback peers cannot spoof loopback via
 * forwarded headers unless `SERVICE_LASSO_TRUST_PROXY_HEADERS` is set.
 */
export function getEffectiveClientAddress(
  request: IncomingMessage,
  trustProxyHeaders: boolean,
): string | null {
  const peer = getImmediatePeerAddress(request);
  const forwarded = getForwardedClientAddress(request);
  if (isLoopbackAddress(peer) && forwarded) {
    return forwarded;
  }
  if (trustProxyHeaders && forwarded) {
    return forwarded;
  }
  return peer;
}

function presentedLocalSecret(request: IncomingMessage): string | undefined {
  return (
    normalizeHeaderValue(firstHeader(request.headers[LOCAL_ADMIN_TOKEN_HEADER])) ??
    extractBearerToken(firstHeader(request.headers.authorization))
  );
}

function resolveLocalTokenActor(
  request: IncomingMessage,
  expectedToken: string | undefined,
  verifyLocalSecret: ((provided: string) => boolean) | undefined,
): RuntimeAuthPolicyStatus["actor"] | null {
  const provided = presentedLocalSecret(request);
  if (!provided) return null;

  const expected = normalizeHeaderValue(expectedToken);
  const envMatches = Boolean(expected && timingSafeStringEqual(expected, provided));
  const extraMatches = verifyLocalSecret ? verifyLocalSecret(provided) : false;
  if (!envMatches && !extraMatches) {
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

function identityProvidersFromEnv(
  env: NodeJS.ProcessEnv,
  zitadelEnabled: boolean,
  extras: readonly RuntimeIdentityProvider[] | undefined,
): RuntimeIdentityProvider[] {
  if (extras && extras.length > 0) {
    return [...extras];
  }
  if (!zitadelEnabled) {
    return [];
  }
  const startUrl = normalizeHeaderValue(env.SERVICE_LASSO_SSO_START_URL) ?? null;
  return [
    {
      id: "zitadel",
      label: "ZITADEL",
      kind: "zitadel",
      startUrl,
    },
  ];
}

export function resolveRuntimeRequestAuth(
  request: IncomingMessage,
  options: RuntimeAuthPolicyOptions,
): RuntimeAuthPolicyStatus {
  const env = options.env ?? process.env;
  const trustProxyHeaders = truthy(env.SERVICE_LASSO_TRUST_PROXY_HEADERS);
  const zitadelEnabled = truthy(env.SERVICE_LASSO_ZITADEL_ENABLED);
  const envToken = normalizeHeaderValue(env.SERVICE_LASSO_LOCAL_ADMIN_TOKEN);
  const localTokenConfigured = Boolean(envToken) || options.localTokenConfigured === true;
  const localOperatorConfigured = options.localOperatorConfigured === true;
  const firstRunPending = options.firstRunPending === true;
  const credentialsAcknowledged = options.credentialsAcknowledged !== false;
  const forceSso = options.forceSso === true;
  const clientAddress = getEffectiveClientAddress(request, trustProxyHeaders);
  const local = isLoopbackAddress(clientAddress);
  const remoteAuthRequired = !local;
  const tokenActor = resolveLocalTokenActor(request, envToken, options.verifyLocalSecret);
  const zitadelActor = resolveZitadelActor(request, zitadelEnabled);

  /**
   * Loopback always allows local-token, ZITADEL, or implicit local-root.
   * FORCE_SSO may require ZITADEL only for remote clients.
   */
  let actor: RuntimeAuthPolicyStatus["actor"];
  if (local) {
    actor = tokenActor ?? zitadelActor ?? {
      authenticated: true,
      kind: "local-root" as const,
      actorId: "local-root",
    };
  } else if (forceSso) {
    actor = zitadelActor ?? { authenticated: false, kind: null, actorId: null };
  } else {
    actor = zitadelActor ?? tokenActor ?? { authenticated: false, kind: null, actorId: null };
  }

  const blockers: string[] = [];
  if (remoteAuthRequired && !actor.authenticated) {
    blockers.push(forceSso ? "force_sso_required" : "remote_auth_required");
  }
  if (remoteAuthRequired && forceSso && !zitadelEnabled) {
    blockers.push("force_sso_without_provider");
  }
  if (remoteAuthRequired && !forceSso && !zitadelEnabled && !localTokenConfigured && !localOperatorConfigured) {
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
      localOperatorConfigured,
      forceSso,
      firstRunPending: local && firstRunPending,
      credentialsAcknowledged: local ? credentialsAcknowledged : true,
      identityProviders: identityProvidersFromEnv(env, zitadelEnabled, options.identityProviders),
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
