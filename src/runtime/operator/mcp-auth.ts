import type { IncomingMessage } from "node:http";
import { isIP } from "node:net";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type { OAuthProtectedResourceMetadata } from "@modelcontextprotocol/sdk/shared/auth.js";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import type { RuntimeAuthPolicyStatus } from "../auth/request-policy.js";

export const MCP_PROTECTED_RESOURCE_METADATA_PATH = "/.well-known/oauth-protected-resource";
export const MCP_MAX_REQUEST_BODY_BYTES = 1_048_576;
export const MCP_READ_SCOPE = "service-lasso:read";
export const MCP_LOGS_READ_SCOPE = "service-lasso:logs:read";
export const MCP_AUDIT_READ_SCOPE = "service-lasso:audit:read";
export const MCP_LIFECYCLE_WRITE_SCOPE = "service-lasso:lifecycle:write";
export const MCP_CONFIG_WRITE_SCOPE = "service-lasso:config:write";
export const MCP_UPDATE_WRITE_SCOPE = "service-lasso:update:write";
export const MCP_RUNTIME_ADMIN_SCOPE = "service-lasso:runtime:admin";

const MCP_SUPPORTED_SCOPES = [
  MCP_READ_SCOPE,
  MCP_LOGS_READ_SCOPE,
  MCP_AUDIT_READ_SCOPE,
  MCP_LIFECYCLE_WRITE_SCOPE,
  MCP_CONFIG_WRITE_SCOPE,
  MCP_UPDATE_WRITE_SCOPE,
  MCP_RUNTIME_ADMIN_SCOPE,
] as const;
const MCP_CURRENT_READ_ONLY_TOOLS = new Set([
  "service_lasso_runtime_status",
  "service_lasso_list_services",
  "service_lasso_get_service",
  "service_lasso_get_health",
  "service_lasso_list_routes",
  "service_lasso_dependency_status",
  "service_lasso_logs_summary",
  "service_lasso_audit_search",
  "service_lasso_update_status",
  "service_lasso_config_drift",
  "service_lasso_recovery_status",
  "service_lasso_operation_status",
  "service_lasso_diagnostics_summary",
  "service_lasso_secret_metadata",
]);
const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,199}$/;
const SAFE_SCOPE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9:._/-]{0,127}$/;
const ASYMMETRIC_JWT_ALGORITHMS = ["RS256", "RS384", "RS512", "ES256", "ES384", "ES512", "EdDSA"];
const remoteJwksByUrl = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
const DEFAULT_MCP_RATE_LIMIT_WINDOW_MS = 60_000;
const DEFAULT_MCP_RATE_LIMIT_PER_ACTOR = 120;
const DEFAULT_MCP_RATE_LIMIT_PER_CLIENT = 240;
const MAX_MCP_RATE_LIMIT_BUCKETS = 10_000;

export type McpOperatingMode = "disabled" | "read-only" | "guarded";
export type McpPermissionProfile = "observer" | "operator" | "maintainer" | "administrator";

export interface McpRateLimitConfiguration {
  windowMs: number;
  perActor: number;
  perClient: number;
}

interface McpRateLimitBucket {
  count: number;
  windowStartedAt: number;
}

export interface McpHttpIdentityOptions {
  env?: NodeJS.ProcessEnv;
}

export interface McpStdioCredentialOptions {
  env?: NodeJS.ProcessEnv;
}

export interface McpOAuthConfiguration {
  enabled: boolean;
  issuer: string | null;
  jwksUri: string | null;
  resource: string | null;
  audience: string | null;
  allowedOrigins: readonly string[];
}

export interface McpTrustedActor {
  kind: "local-root" | "local-token" | "oauth";
  actorId: string;
  clientId: string;
  scopes: readonly string[];
  permissionProfile: McpPermissionProfile;
}

export interface McpHttpAuthorization {
  authInfo: AuthInfo;
  actor: McpTrustedActor;
  oauth: McpOAuthConfiguration;
}

export class McpHttpPolicyError extends Error {
  constructor(
    public readonly code: string,
    public readonly statusCode: number,
    public readonly wwwAuthenticate?: string,
    public readonly retryAfterSeconds?: number,
  ) {
    super(code);
    this.name = "McpHttpPolicyError";
  }
}

function boundedPositiveInteger(
  value: string | undefined,
  fallback: number,
  name: string,
  maximum: number,
): number {
  const candidate = normalized(value);
  if (!candidate) return fallback;
  if (!/^[0-9]+$/.test(candidate)) throw new McpHttpPolicyError(`invalid_${name}`, 503);
  const parsed = Number(candidate);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new McpHttpPolicyError(`invalid_${name}`, 503);
  }
  return parsed;
}

export function resolveMcpOperatingMode(options: McpHttpIdentityOptions = {}): McpOperatingMode {
  const value = normalized((options.env ?? process.env).SERVICE_LASSO_MCP_MODE)?.toLowerCase() ?? "read-only";
  if (value === "disabled" || value === "read-only" || value === "guarded") return value;
  throw new McpHttpPolicyError("invalid_mcp_mode", 503);
}

export function assertMcpTransportEnabled(options: McpHttpIdentityOptions = {}): McpOperatingMode {
  const mode = resolveMcpOperatingMode(options);
  if (mode === "disabled") throw new McpHttpPolicyError("mcp_disabled", 404);
  return mode;
}

export function resolveMcpPermissionProfile(scopes: readonly string[]): McpPermissionProfile {
  const granted = new Set(scopes);
  if (
    granted.has(MCP_READ_SCOPE) &&
    granted.has(MCP_LIFECYCLE_WRITE_SCOPE) &&
    granted.has(MCP_CONFIG_WRITE_SCOPE) &&
    granted.has(MCP_UPDATE_WRITE_SCOPE) &&
    granted.has(MCP_RUNTIME_ADMIN_SCOPE)
  ) return "administrator";
  if (
    granted.has(MCP_READ_SCOPE) &&
    granted.has(MCP_LIFECYCLE_WRITE_SCOPE) &&
    granted.has(MCP_CONFIG_WRITE_SCOPE) &&
    granted.has(MCP_UPDATE_WRITE_SCOPE)
  ) return "maintainer";
  if (granted.has(MCP_READ_SCOPE) && granted.has(MCP_LIFECYCLE_WRITE_SCOPE)) return "operator";
  return "observer";
}

export function resolveMcpRateLimitConfiguration(
  options: McpHttpIdentityOptions = {},
): McpRateLimitConfiguration {
  const env = options.env ?? process.env;
  return {
    windowMs: boundedPositiveInteger(
      env.SERVICE_LASSO_MCP_RATE_LIMIT_WINDOW_MS,
      DEFAULT_MCP_RATE_LIMIT_WINDOW_MS,
      "mcp_rate_limit_window_ms",
      3_600_000,
    ),
    perActor: boundedPositiveInteger(
      env.SERVICE_LASSO_MCP_RATE_LIMIT_PER_ACTOR,
      DEFAULT_MCP_RATE_LIMIT_PER_ACTOR,
      "mcp_rate_limit_per_actor",
      100_000,
    ),
    perClient: boundedPositiveInteger(
      env.SERVICE_LASSO_MCP_RATE_LIMIT_PER_CLIENT,
      DEFAULT_MCP_RATE_LIMIT_PER_CLIENT,
      "mcp_rate_limit_per_client",
      100_000,
    ),
  };
}

export class McpRateLimiter {
  private readonly buckets = new Map<string, McpRateLimitBucket>();

  constructor(private readonly now: () => number = Date.now) {}

  consume(authorization: McpHttpAuthorization, config: McpRateLimitConfiguration): void {
    const now = this.now();
    const actorKey = `actor:${authorization.actor.actorId}`;
    const clientKey = `client:${authorization.actor.clientId}`;
    const actorBucket = this.currentBucket(actorKey, now, config.windowMs);
    const clientBucket = this.currentBucket(clientKey, now, config.windowMs);
    let missingBucketCount = Number(!this.buckets.has(actorKey)) + Number(!this.buckets.has(clientKey));
    if (this.buckets.size + missingBucketCount > MAX_MCP_RATE_LIMIT_BUCKETS) {
      for (const [key, bucket] of this.buckets) {
        if (now - bucket.windowStartedAt >= config.windowMs) this.buckets.delete(key);
      }
      missingBucketCount = Number(!this.buckets.has(actorKey)) + Number(!this.buckets.has(clientKey));
      if (this.buckets.size + missingBucketCount > MAX_MCP_RATE_LIMIT_BUCKETS) {
        throw new McpHttpPolicyError("mcp_rate_limiter_capacity", 503);
      }
    }

    const blockedBucket = actorBucket.count >= config.perActor
      ? actorBucket
      : clientBucket.count >= config.perClient
        ? clientBucket
        : null;
    if (blockedBucket) {
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((blockedBucket.windowStartedAt + config.windowMs - now) / 1_000),
      );
      throw new McpHttpPolicyError("mcp_rate_limited", 429, undefined, retryAfterSeconds);
    }

    actorBucket.count += 1;
    clientBucket.count += 1;
    this.remember(actorKey, actorBucket);
    this.remember(clientKey, clientBucket);
  }

  private currentBucket(key: string, now: number, windowMs: number): McpRateLimitBucket {
    const existing = this.buckets.get(key);
    if (!existing || now - existing.windowStartedAt >= windowMs) {
      return { count: 0, windowStartedAt: now };
    }
    return existing;
  }

  private remember(key: string, bucket: McpRateLimitBucket): void {
    this.buckets.set(key, bucket);
  }
}

export function createMcpRateLimiter(now?: () => number): McpRateLimiter {
  return new McpRateLimiter(now);
}

export function assertMcpRateLimit(
  limiter: McpRateLimiter,
  authorization: McpHttpAuthorization,
  options: McpHttpIdentityOptions = {},
): void {
  limiter.consume(authorization, resolveMcpRateLimitConfiguration(options));
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function normalized(value: string | undefined): string | null {
  const result = value?.trim();
  return result ? result : null;
}

function isLoopbackHostname(hostname: string): boolean {
  const value = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (value === "localhost" || value === "::1" || value === "0:0:0:0:0:0:0:1") return true;
  return isIP(value) === 4 && Number(value.split(".")[0]) === 127;
}

function parseSecureUrl(value: string, name: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new McpHttpPolicyError(`invalid_${name}`, 503);
  }
  if (
    parsed.hash ||
    parsed.username ||
    parsed.password ||
    (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && isLoopbackHostname(parsed.hostname)))
  ) {
    throw new McpHttpPolicyError(`invalid_${name}`, 503);
  }
  return parsed;
}

function parseAllowedOrigins(value: string | undefined, resource: URL | null): string[] {
  const origins = new Set<string>();
  if (resource) origins.add(resource.origin);
  for (const entry of value?.split(",") ?? []) {
    const candidate = entry.trim();
    if (!candidate) continue;
    const parsed = parseSecureUrl(candidate, "mcp_allowed_origin");
    if (parsed.origin !== candidate.replace(/\/$/, "")) {
      throw new McpHttpPolicyError("invalid_mcp_allowed_origin", 503);
    }
    origins.add(parsed.origin);
  }
  return [...origins];
}

export function resolveMcpOAuthConfiguration(options: McpHttpIdentityOptions = {}): McpOAuthConfiguration {
  const env = options.env ?? process.env;
  const issuerValue = normalized(env.SERVICE_LASSO_MCP_OAUTH_ISSUER);
  const jwksValue = normalized(env.SERVICE_LASSO_MCP_OAUTH_JWKS_URI);
  const resourceValue = normalized(env.SERVICE_LASSO_MCP_RESOURCE_URI);
  const audienceValue = normalized(env.SERVICE_LASSO_MCP_OAUTH_AUDIENCE);
  const configured = [issuerValue, jwksValue, resourceValue, audienceValue].some(Boolean);

  if (!configured) {
    return {
      enabled: false,
      issuer: null,
      jwksUri: null,
      resource: null,
      audience: null,
      allowedOrigins: parseAllowedOrigins(env.SERVICE_LASSO_MCP_ALLOWED_ORIGINS, null),
    };
  }
  if (!issuerValue || !jwksValue || !resourceValue || !audienceValue) {
    throw new McpHttpPolicyError("mcp_oauth_misconfigured", 503);
  }

  const issuer = parseSecureUrl(issuerValue, "mcp_oauth_issuer");
  const jwksUri = parseSecureUrl(jwksValue, "mcp_oauth_jwks_uri");
  const resource = parseSecureUrl(resourceValue, "mcp_resource_uri");
  if (resource.search || !resource.pathname.endsWith("/api/mcp")) {
    throw new McpHttpPolicyError("invalid_mcp_resource_uri", 503);
  }

  return {
    enabled: true,
    issuer: issuerValue,
    jwksUri: jwksUri.toString(),
    resource: resource.toString(),
    audience: audienceValue,
    allowedOrigins: parseAllowedOrigins(env.SERVICE_LASSO_MCP_ALLOWED_ORIGINS, resource),
  };
}

function resourceMetadataUrl(config: McpOAuthConfiguration): string | undefined {
  if (!config.enabled || !config.resource) return undefined;
  return new URL(MCP_PROTECTED_RESOURCE_METADATA_PATH, config.resource).toString();
}

function bearerChallenge(config: McpOAuthConfiguration, error?: string, scopes: readonly string[] = []): string {
  const parts: string[] = [];
  const metadataUrl = resourceMetadataUrl(config);
  if (metadataUrl) parts.push(`resource_metadata="${metadataUrl}"`);
  if (error) parts.push(`error="${error}"`);
  if (scopes.length > 0) parts.push(`scope="${scopes.join(" ")}"`);
  return parts.length > 0 ? `Bearer ${parts.join(", ")}` : "Bearer";
}

export function createMcpProtectedResourceMetadata(
  options: McpHttpIdentityOptions = {},
): OAuthProtectedResourceMetadata {
  assertMcpTransportEnabled(options);
  const config = resolveMcpOAuthConfiguration(options);
  if (!config.enabled || !config.issuer || !config.resource) {
    throw new McpHttpPolicyError("mcp_oauth_not_configured", 404);
  }
  return {
    resource: config.resource,
    authorization_servers: [config.issuer],
    scopes_supported: [...MCP_SUPPORTED_SCOPES],
    bearer_methods_supported: ["header"],
    resource_name: "Service Lasso Operator MCP",
    resource_documentation: new URL("/docs/reference/operator-mcp", config.resource).toString(),
  };
}

export function assertMcpOriginAllowed(
  request: IncomingMessage,
  options: McpHttpIdentityOptions = {},
): McpOAuthConfiguration {
  const config = resolveMcpOAuthConfiguration(options);
  const originValue = normalized(firstHeader(request.headers.origin));
  if (!originValue) return config;

  let origin: string;
  try {
    const parsed = new URL(originValue);
    origin = parsed.origin;
    if (origin !== originValue.replace(/\/$/, "")) throw new Error("origin_path_not_allowed");
  } catch {
    throw new McpHttpPolicyError("mcp_origin_not_allowed", 403);
  }
  if (!config.allowedOrigins.includes(origin)) {
    throw new McpHttpPolicyError("mcp_origin_not_allowed", 403);
  }
  return config;
}

export function assertMcpJsonContentType(request: IncomingMessage): void {
  const contentType = normalized(firstHeader(request.headers["content-type"]));
  if (contentType?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") {
    throw new McpHttpPolicyError("mcp_unsupported_content_type", 415);
  }
}

function extractBearerToken(request: IncomingMessage): string {
  const authorization = normalized(firstHeader(request.headers.authorization));
  const match = authorization?.match(/^Bearer\s+([^\s]+)$/i);
  if (!match?.[1] || match[1].length > 16_384) {
    throw new McpHttpPolicyError("mcp_unauthorized", 401);
  }
  return match[1];
}

function normalizeScopes(payload: JWTPayload): string[] {
  const claim = payload.scope ?? payload.scp;
  const values = Array.isArray(claim)
    ? claim
    : typeof claim === "string"
      ? claim.split(/\s+/)
      : [];
  return [...new Set(values.filter((entry): entry is string => typeof entry === "string" && SAFE_SCOPE_PATTERN.test(entry)))].slice(0, 50);
}

function safeClaimId(value: unknown): string | null {
  return typeof value === "string" && SAFE_ID_PATTERN.test(value) ? value : null;
}

/**
 * Stdio has no HTTP header channel. Its local credential is therefore an
 * opt-in process capability: the host must provide a non-empty secret through
 * its protected environment, together with bounded actor and client ids. The
 * secret intentionally never becomes protocol, Audit, or response data.
 */
export function resolveMcpStdioAuthorization(
  options: McpStdioCredentialOptions = {},
): McpHttpAuthorization {
  const env = options.env ?? process.env;
  const credential = normalized(env.SERVICE_LASSO_MCP_STDIO_CREDENTIAL);
  const actorId = safeClaimId(env.SERVICE_LASSO_MCP_STDIO_ACTOR);
  const clientId = safeClaimId(env.SERVICE_LASSO_MCP_STDIO_CLIENT_ID);
  if (!credential || credential.length > 16_384 || !actorId || !clientId) {
    throw new McpHttpPolicyError("mcp_stdio_credentials_not_configured", 503);
  }
  const configuredScopes = normalized(env.SERVICE_LASSO_MCP_STDIO_SCOPES);
  const scopes = configuredScopes
    ? [...new Set(configuredScopes.split(/[\s,]+/u).filter(Boolean))]
    : [MCP_READ_SCOPE, MCP_LOGS_READ_SCOPE];
  if (
    !scopes.includes(MCP_READ_SCOPE) ||
    scopes.some((scope) => !(MCP_SUPPORTED_SCOPES as readonly string[]).includes(scope))
  ) {
    throw new McpHttpPolicyError("mcp_stdio_scopes_invalid", 503);
  }
  const actor: McpTrustedActor = {
    kind: "local-token",
    actorId,
    clientId,
    scopes,
    permissionProfile: resolveMcpPermissionProfile(scopes),
  };
  return {
    actor,
    oauth: {
      enabled: false,
      issuer: null,
      jwksUri: null,
      resource: null,
      audience: null,
      allowedOrigins: [],
    },
    authInfo: {
      token: "",
      clientId,
      scopes,
      extra: {
        actor: {
          kind: actor.kind,
          actorId,
          clientId,
          permissionProfile: actor.permissionProfile,
        },
      },
    },
  };
}

function remoteJwks(url: string): ReturnType<typeof createRemoteJWKSet> {
  const existing = remoteJwksByUrl.get(url);
  if (existing) return existing;
  const created = createRemoteJWKSet(new URL(url), {
    timeoutDuration: 5_000,
    cooldownDuration: 30_000,
  });
  remoteJwksByUrl.set(url, created);
  return created;
}

async function verifyMcpBearerToken(
  request: IncomingMessage,
  config: McpOAuthConfiguration,
): Promise<McpHttpAuthorization> {
  if (!config.issuer || !config.jwksUri || !config.resource || !config.audience) {
    throw new McpHttpPolicyError("mcp_oauth_misconfigured", 503);
  }
  try {
    const token = extractBearerToken(request);
    const { payload } = await jwtVerify(token, remoteJwks(config.jwksUri), {
      issuer: config.issuer,
      audience: config.audience,
      algorithms: ASYMMETRIC_JWT_ALGORITHMS,
      clockTolerance: 5,
    });
    const actorId = safeClaimId(payload.sub);
    const clientId = safeClaimId(payload.client_id) ?? safeClaimId(payload.azp);
    if (!actorId || !clientId || typeof payload.exp !== "number") {
      throw new Error("invalid_claims");
    }
    const scopes = normalizeScopes(payload);
    const actor: McpTrustedActor = {
      kind: "oauth",
      actorId,
      clientId,
      scopes,
      permissionProfile: resolveMcpPermissionProfile(scopes),
    };
    return {
      actor,
      oauth: config,
      authInfo: {
        token,
        clientId,
        scopes,
        expiresAt: payload.exp,
        resource: new URL(config.resource),
        extra: {
          actor: {
            kind: actor.kind,
            actorId: actor.actorId,
            clientId: actor.clientId,
            permissionProfile: actor.permissionProfile,
          },
        },
      },
    };
  } catch {
    throw new McpHttpPolicyError(
      "mcp_unauthorized",
      401,
      bearerChallenge(config, "invalid_token", [MCP_READ_SCOPE]),
    );
  }
}

function localMcpAuthorization(
  auth: RuntimeAuthPolicyStatus,
  config: McpOAuthConfiguration,
): McpHttpAuthorization {
  if (!auth.request.local || !auth.actor.authenticated || !auth.actor.actorId || auth.actor.kind === "zitadel") {
    throw new McpHttpPolicyError("mcp_unauthorized", 401, bearerChallenge(config));
  }
  const kind = auth.actor.kind === "local-token" ? "local-token" : "local-root";
  const clientId = kind === "local-token" ? "service-lasso-local-token" : "service-lasso-loopback";
  const actor: McpTrustedActor = {
    kind,
    actorId: auth.actor.actorId,
    clientId,
    scopes: [...MCP_SUPPORTED_SCOPES],
    permissionProfile: "administrator",
  };
  return {
    actor,
    oauth: config,
    authInfo: {
      token: "",
      clientId,
      scopes: [...MCP_SUPPORTED_SCOPES],
      extra: { actor: { kind, actorId: actor.actorId, clientId, permissionProfile: actor.permissionProfile } },
    },
  };
}

export async function authorizeMcpHttpRequest(
  request: IncomingMessage,
  runtimeAuth: RuntimeAuthPolicyStatus,
  options: McpHttpIdentityOptions = {},
): Promise<McpHttpAuthorization> {
  assertMcpTransportEnabled(options);
  const config = assertMcpOriginAllowed(request, options);
  const authorization = config.enabled
    ? await verifyMcpBearerToken(request, config)
    : localMcpAuthorization(runtimeAuth, config);
  assertMcpScopes(authorization, [MCP_READ_SCOPE]);
  return authorization;
}

function collectRequests(input: unknown): Record<string, unknown>[] {
  if (Array.isArray(input)) return input.filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object" && !Array.isArray(entry));
  return input && typeof input === "object" ? [input as Record<string, unknown>] : [];
}

export function requiredMcpScopesForRequest(input: unknown): string[] {
  const scopes = new Set<string>([MCP_READ_SCOPE]);
  for (const message of collectRequests(input)) {
    if (message.method !== "tools/call" || !message.params || typeof message.params !== "object" || Array.isArray(message.params)) continue;
    const name = (message.params as Record<string, unknown>).name;
    if (name === "service_lasso_logs_summary") scopes.add(MCP_LOGS_READ_SCOPE);
    if (name === "service_lasso_audit_search") scopes.add(MCP_AUDIT_READ_SCOPE);
    if (name === "service_lasso_start_service" || name === "service_lasso_stop_service" || name === "service_lasso_restart_service") {
      scopes.add(MCP_LIFECYCLE_WRITE_SCOPE);
    }
    if (name === "service_lasso_install_service" || name === "service_lasso_configure_service" || name === "service_lasso_run_setup_step") {
      scopes.add(MCP_CONFIG_WRITE_SCOPE);
    }
    if (name === "service_lasso_check_updates" || name === "service_lasso_download_update" || name === "service_lasso_install_update") {
      scopes.add(MCP_UPDATE_WRITE_SCOPE);
    }
    if (name === "service_lasso_start_all" || name === "service_lasso_stop_all") {
      scopes.add(MCP_RUNTIME_ADMIN_SCOPE);
    }
  }
  return [...scopes];
}

export function assertMcpOperatingModeAllowsRequest(
  input: unknown,
  options: McpHttpIdentityOptions = {},
): void {
  const mode = assertMcpTransportEnabled(options);
  if (mode !== "read-only") return;
  for (const message of collectRequests(input)) {
    if (message.method !== "tools/call" || !message.params || typeof message.params !== "object" || Array.isArray(message.params)) continue;
    const name = (message.params as Record<string, unknown>).name;
    if (typeof name === "string" && !MCP_CURRENT_READ_ONLY_TOOLS.has(name)) {
      throw new McpHttpPolicyError("mcp_read_only_mode", 403);
    }
  }
}

export function assertMcpScopes(
  authorization: McpHttpAuthorization,
  requiredScopes: readonly string[],
): void {
  const granted = new Set(authorization.actor.scopes);
  const missing = requiredScopes.filter((scope) => !granted.has(scope));
  if (missing.length > 0) {
    throw new McpHttpPolicyError(
      "mcp_insufficient_scope",
      403,
      bearerChallenge(authorization.oauth, "insufficient_scope", missing),
    );
  }
}

export function mcpPolicyErrorBody(error: McpHttpPolicyError): { error: string; statusCode: number } {
  return { error: error.code, statusCode: error.statusCode };
}
