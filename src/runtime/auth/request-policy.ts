import type { IncomingMessage } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { builtInAccessGroupTemplates } from "../../platform/security-model.js";
import {
  LOCAL_ADMIN_TOKEN_HEADER,
  ORIGINAL_CLIENT_ADDRESS_HEADER,
  SERVICEADMIN_INTERNAL_PROXY_HEADER,
  SERVICEADMIN_PROXY_HEADER,
  SERVICEADMIN_PROXY_VALUE,
  TRAEFIK_ACTOR_HEADER,
  TRAEFIK_ROLES_HEADER,
  TRAEFIK_USER_HEADER,
  TRAEFIK_WORKSPACE_HEADER,
  TRUSTED_INGRESS_HEADER,
  TRUSTED_INGRESS_VALUE,
  USER_ID_HEADER,
  WORKSPACE_ID_HEADER,
  ZITADEL_GROUPS_HEADER,
  ZITADEL_ROLES_HEADER,
  ZITADEL_USER_ID_HEADER,
} from "./local-auth-constants.js";

/** Trusted-ingress identity that is absent, complete, or fail-closed. */
type TrustedIngressIdentity =
  | { status: "absent" }
  | { status: "ok"; actor: RuntimeAuthPolicyStatus["actor"] }
  | { status: "invalid"; reason: "trusted_ingress_identity_missing" | "trusted_ingress_identity_mismatch" };

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
    roles: string[];
    permissions: string[];
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
const SAFE_ROLE_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;

function normalizeRoleClaims(...values: Array<string | string[] | undefined>): string[] {
  const roles = values
    .flatMap((value) => Array.isArray(value) ? value : value ? [value] : [])
    .flatMap((value) => value.split(","))
    .map((value) => value.trim().toLowerCase())
    .filter((value) => SAFE_ROLE_PATTERN.test(value));
  return [...new Set(roles)].slice(0, 20);
}

function permissionsForRoles(roles: string[]): string[] {
  return [...new Set(roles.flatMap((role) =>
    builtInAccessGroupTemplates.find((template) => template.id === role)?.permissions ?? [],
  ))];
}

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

function isTrustedLoopbackIngress(request: IncomingMessage): boolean {
  return (
    isLoopbackAddress(getImmediatePeerAddress(request)) &&
    normalizeHeaderValue(firstHeader(request.headers[TRUSTED_INGRESS_HEADER])) === TRUSTED_INGRESS_VALUE
  );
}

function isServiceAdminLoopbackProxy(request: IncomingMessage): boolean {
  return (
    isLoopbackAddress(getImmediatePeerAddress(request)) &&
    normalizeHeaderValue(firstHeader(request.headers[SERVICEADMIN_PROXY_HEADER])) === SERVICEADMIN_PROXY_VALUE
  );
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
  if ((isTrustedLoopbackIngress(request) || isServiceAdminLoopbackProxy(request)) && forwarded) {
    return forwarded;
  }
  if (trustProxyHeaders && forwarded) {
    return forwarded;
  }
  return peer;
}

function isTrustedServiceAdminProxy(request: IncomingMessage): boolean {
  return (
    isLoopbackAddress(request.socket.remoteAddress) &&
    normalizeHeaderValue(firstHeader(request.headers[SERVICEADMIN_INTERNAL_PROXY_HEADER])) ===
      SERVICEADMIN_PROXY_VALUE
  );
}

/**
 * Unique non-empty identity claims. Empty when none were presented.
 */
function uniqueIdentityClaims(...values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

/**
 * Traefik User/Actor plus canonical/Admin-normalized user ids from a trusted
 * ingress request. Multiple distinct values are a mismatch.
 */
function presentedIngressUserIds(request: IncomingMessage): string[] {
  return uniqueIdentityClaims(
    normalizeHeaderValue(firstHeader(request.headers[TRAEFIK_USER_HEADER])),
    normalizeHeaderValue(firstHeader(request.headers[TRAEFIK_ACTOR_HEADER])),
    normalizeHeaderValue(firstHeader(request.headers[ZITADEL_USER_ID_HEADER])),
    normalizeHeaderValue(firstHeader(request.headers[USER_ID_HEADER])),
  );
}

/**
 * Traefik workspace plus the canonical workspace id. Distinct values mismatch.
 */
function presentedIngressWorkspaceIds(request: IncomingMessage): string[] {
  return uniqueIdentityClaims(
    normalizeHeaderValue(firstHeader(request.headers[TRAEFIK_WORKSPACE_HEADER])),
    normalizeHeaderValue(firstHeader(request.headers[WORKSPACE_ID_HEADER])),
  );
}

/**
 * Resolve Traefik / canonical identity only from exact loopback trusted ingress.
 * Missing or conflicting claims fail closed instead of falling through to local-root.
 */
function resolveTrustedIngressIdentity(
  request: IncomingMessage,
  zitadelEnabled: boolean,
): TrustedIngressIdentity {
  if (!zitadelEnabled || !isTrustedLoopbackIngress(request)) {
    return { status: "absent" };
  }

  const userIds = presentedIngressUserIds(request);
  const workspaceIds = presentedIngressWorkspaceIds(request);
  const traefikRoles = normalizeRoleClaims(request.headers[TRAEFIK_ROLES_HEADER]);
  const canonicalRoles = normalizeRoleClaims(
    request.headers[ZITADEL_ROLES_HEADER],
    request.headers[ZITADEL_GROUPS_HEADER],
  );
  const rolesDisagree =
    traefikRoles.length > 0 &&
    canonicalRoles.length > 0 &&
    (traefikRoles.length !== canonicalRoles.length ||
      traefikRoles.some((role) => !canonicalRoles.includes(role)));

  if (userIds.length > 1 || workspaceIds.length > 1 || rolesDisagree) {
    return { status: "invalid", reason: "trusted_ingress_identity_mismatch" };
  }
  const [userId] = userIds;
  if (userId === undefined) {
    return { status: "invalid", reason: "trusted_ingress_identity_missing" };
  }

  const roles = traefikRoles.length > 0 ? traefikRoles : canonicalRoles;
  return {
    status: "ok",
    actor: {
      authenticated: true,
      kind: "zitadel",
      actorId: userId,
      roles,
      permissions: permissionsForRoles(roles),
    },
  };
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
    roles: ["owner"],
    permissions: ["*"],
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
  const trustedServiceAdminProxy = isTrustedServiceAdminProxy(request);
  const immediatePeerIsLoopback = isLoopbackAddress(request.socket.remoteAddress);
  const trustProxyHeaders = immediatePeerIsLoopback &&
    (truthy(env.SERVICE_LASSO_TRUST_PROXY_HEADERS) || trustedServiceAdminProxy);
  const zitadelEnabled = truthy(env.SERVICE_LASSO_ZITADEL_ENABLED) || trustedServiceAdminProxy;
  const envToken = normalizeHeaderValue(env.SERVICE_LASSO_LOCAL_ADMIN_TOKEN);
  const localTokenConfigured = Boolean(envToken) || options.localTokenConfigured === true;
  const localOperatorConfigured = options.localOperatorConfigured === true;
  const firstRunPending = options.firstRunPending === true;
  const credentialsAcknowledged = options.credentialsAcknowledged !== false;
  const forceSso = options.forceSso === true;
  const clientAddress = getEffectiveClientAddress(request, trustProxyHeaders);
  const local = isLoopbackAddress(clientAddress);
  const tokenActor = resolveLocalTokenActor(request, envToken, options.verifyLocalSecret);
  const ingressIdentity = resolveTrustedIngressIdentity(
    request,
    zitadelEnabled && trustedServiceAdminProxy,
  );
  const zitadelActor = ingressIdentity.status === "ok" ? ingressIdentity.actor : null;
  const unauthenticatedActor: RuntimeAuthPolicyStatus["actor"] = {
    authenticated: false,
    kind: null,
    actorId: null,
    roles: [],
    permissions: [],
  };
  /**
   * Claimed trusted ingress with missing or mismatched Traefik identity is
   * never local-root. Loopback without that claim still allows local-token,
   * ZITADEL, or implicit local-root. FORCE_SSO applies only to remote clients.
   */
  const remoteAuthRequired = !local || ingressIdentity.status === "invalid";
  let actor: RuntimeAuthPolicyStatus["actor"];
  if (ingressIdentity.status === "invalid") {
    actor = unauthenticatedActor;
  } else if (local) {
    actor = tokenActor ?? zitadelActor ?? {
      authenticated: true,
      kind: "local-root" as const,
      actorId: "local-root",
      roles: ["owner"],
      permissions: ["*"],
    };
  } else if (forceSso) {
    actor = zitadelActor ?? unauthenticatedActor;
  } else {
    actor = zitadelActor ?? tokenActor ?? unauthenticatedActor;
  }

  const blockers: string[] = [];
  if (ingressIdentity.status === "invalid") {
    blockers.push(ingressIdentity.reason);
  } else if (remoteAuthRequired && !actor.authenticated) {
    blockers.push(forceSso ? "force_sso_required" : "remote_auth_required");
  }
  if (ingressIdentity.status !== "invalid" && remoteAuthRequired && forceSso && !zitadelEnabled) {
    blockers.push("force_sso_without_provider");
  }
  if (
    ingressIdentity.status !== "invalid" &&
    remoteAuthRequired &&
    !forceSso &&
    !zitadelEnabled &&
    !localTokenConfigured &&
    !localOperatorConfigured
  ) {
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
  if (
    auth.blockers.includes("trusted_ingress_identity_missing") ||
    auth.blockers.includes("trusted_ingress_identity_mismatch")
  ) {
    throw new Error(auth.blockers[0] ?? "trusted_ingress_identity_invalid");
  }
  if (!auth.policy.remoteAuthRequired || auth.actor.authenticated) {
    return;
  }

  throw new Error(auth.blockers[0] ?? "remote_auth_required");
}
