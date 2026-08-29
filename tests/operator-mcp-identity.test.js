import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { rm } from "node:fs/promises";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { createApiServer, startApiServer } from "../dist/server/index.js";
import { readAuditEvents } from "../dist/runtime/audit/store.js";
import {
  MCP_MAX_REQUEST_BODY_BYTES,
  resolveMcpOperatingMode,
  resolveMcpOAuthConfiguration,
  resolveMcpPermissionProfile,
  resolveMcpRateLimitConfiguration,
} from "../dist/runtime/operator/mcp-auth.js";
import { makeTempServicesRoot } from "./test-helpers.js";

const issuer = "https://issuer.example";
const resource = "https://mcp.example/api/mcp";
const audience = "service-lasso-operator-mcp";
const allowedOrigin = "https://client.example";
const keyId = "mcp-identity-test-key";

async function startJwksServer() {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const jwk = await exportJWK(publicKey);
  Object.assign(jwk, { kid: keyId, alg: "RS256", use: "sig" });
  const server = createServer((request, response) => {
    if (request.url !== "/jwks") {
      response.statusCode = 404;
      response.end();
      return;
    }
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ keys: [jwk] }));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return {
    privateKey,
    jwksUri: `http://127.0.0.1:${address.port}/jwks`,
    stop: async () => {
      const closed = once(server, "close");
      server.close();
      server.closeAllConnections?.();
      await closed;
    },
  };
}

async function signAccessToken(privateKey, overrides = {}) {
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    client_id: "mcp-test-client",
    scope: "service-lasso:read",
    ...overrides.claims,
  };
  let token = new SignJWT(claims)
    .setProtectedHeader({ alg: "RS256", kid: keyId })
    .setIssuer(overrides.issuer ?? issuer)
    .setAudience(overrides.audience ?? audience)
    .setSubject(overrides.subject ?? "mcp-test-actor")
    .setIssuedAt(now);
  if (!overrides.omitExpiration) {
    token = token.setExpirationTime(overrides.expiresAt ?? now + 300);
  }
  return token.sign(privateKey);
}

async function startDirectApiServer(options) {
  const server = createApiServer(options);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return {
    url: `http://127.0.0.1:${address.port}`,
    stop: async () => {
      const closed = once(server, "close");
      server.close();
      server.closeAllConnections?.();
      await closed;
    },
  };
}

async function postMcp(apiServer, options = {}) {
  const headers = {
    accept: "application/json, text/event-stream",
    "content-type": options.contentType ?? "application/json",
  };
  if (options.origin !== null) headers.origin = options.origin ?? allowedOrigin;
  if (options.token) headers.authorization = `Bearer ${options.token}`;
  Object.assign(headers, options.headers ?? {});
  const response = await fetch(apiServer.url + "/api/mcp", {
    method: "POST",
    headers,
    body: options.rawBody ?? JSON.stringify(options.body ?? {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
    }),
  });
  return {
    status: response.status,
    authenticate: response.headers.get("www-authenticate") ?? "",
    retryAfter: response.headers.get("retry-after") ?? "",
    text: await response.text(),
  };
}

test("#860 protects Streamable HTTP with OAuth discovery, trusted identity, scopes, and content boundaries", async () => {
  assert.notEqual(audience, resource);
  const { tempRoot, servicesRoot, workspaceRoot } = await makeTempServicesRoot("service-lasso-mcp-identity-");
  const jwks = await startJwksServer();
  let apiServer;

  try {
    apiServer = await startApiServer({
      port: 0,
      servicesRoot,
      workspaceRoot,
      mcpHttpIdentity: {
        env: {
          SERVICE_LASSO_MCP_OAUTH_ISSUER: issuer,
          SERVICE_LASSO_MCP_OAUTH_JWKS_URI: jwks.jwksUri,
          SERVICE_LASSO_MCP_RESOURCE_URI: resource,
          SERVICE_LASSO_MCP_OAUTH_AUDIENCE: audience,
          SERVICE_LASSO_MCP_ALLOWED_ORIGINS: allowedOrigin,
        },
      },
    });

    const metadataResponse = await fetch(apiServer.url + "/.well-known/oauth-protected-resource");
    assert.equal(metadataResponse.status, 200);
    const metadata = await metadataResponse.json();
    assert.equal(metadata.resource, resource);
    assert.deepEqual(metadata.authorization_servers, [issuer]);
    assert.deepEqual(metadata.scopes_supported, [
      "service-lasso:read",
      "service-lasso:logs:read",
      "service-lasso:audit:read",
      "service-lasso:lifecycle:write",
      "service-lasso:config:write",
      "service-lasso:update:write",
      "service-lasso:runtime:admin",
    ]);
    assert.deepEqual(metadata.bearer_methods_supported, ["header"]);

    const unauthenticated = await postMcp(apiServer);
    assert.equal(unauthenticated.status, 401);
    assert.match(unauthenticated.authenticate, /^Bearer resource_metadata=/);
    assert.equal(unauthenticated.authenticate.startsWith("Bearer,"), false);
    assert.match(unauthenticated.authenticate, /scope="service-lasso:read"/);

    const validToken = await signAccessToken(jwks.privateKey);
    const nonBrowser = await postMcp(apiServer, { token: validToken, origin: null });
    assert.equal(nonBrowser.status, 200);

    const deniedOrigin = await postMcp(apiServer, { token: validToken, origin: "https://untrusted.example" });
    assert.equal(deniedOrigin.status, 403);

    const deniedContentType = await postMcp(apiServer, { token: validToken, contentType: "text/plain" });
    assert.equal(deniedContentType.status, 415);

    const malformedMarker = "mcp-sensitive-invalid-token-marker";
    const malformed = await postMcp(apiServer, { token: malformedMarker });
    assert.equal(malformed.status, 401);
    assert.equal(malformed.text.includes(malformedMarker), false);
    assert.equal(malformed.authenticate.includes(malformedMarker), false);
    assert.match(malformed.authenticate, /scope="service-lasso:read"/);

    const { privateKey: untrustedPrivateKey } = await generateKeyPair("RS256");
    const untrustedSignature = await postMcp(apiServer, {
      token: await signAccessToken(untrustedPrivateKey),
    });
    assert.equal(untrustedSignature.status, 401);

    const invalidTokens = [
      await signAccessToken(jwks.privateKey, { issuer: "https://wrong-issuer.example" }),
      await signAccessToken(jwks.privateKey, { audience: "https://wrong-audience.example" }),
      await signAccessToken(jwks.privateKey, { expiresAt: Math.floor(Date.now() / 1000) - 60 }),
      await signAccessToken(jwks.privateKey, { omitExpiration: true }),
    ];
    for (const token of invalidTokens) {
      const denied = await postMcp(apiServer, { token });
      assert.equal(denied.status, 401);
    }

    const missingReadScope = await signAccessToken(jwks.privateKey, {
      claims: { scope: "service-lasso:audit:read" },
    });
    const deniedRead = await postMcp(apiServer, { token: missingReadScope });
    assert.equal(deniedRead.status, 403);
    assert.match(deniedRead.authenticate, /scope="service-lasso:read"/);

    const deniedLogs = await postMcp(apiServer, {
      token: validToken,
      body: {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "service_lasso_logs_summary", arguments: { serviceId: "missing" } },
      },
    });
    assert.equal(deniedLogs.status, 403);
    assert.match(deniedLogs.authenticate, /scope="service-lasso:logs:read"/);

    const deniedAuditSearch = await postMcp(apiServer, {
      token: validToken,
      body: {
        jsonrpc: "2.0",
        id: "audit-scope",
        method: "tools/call",
        params: { name: "service_lasso_audit_search", arguments: {} },
      },
    });
    assert.equal(deniedAuditSearch.status, 403);
    assert.match(deniedAuditSearch.authenticate, /scope="service-lasso:audit:read"/);

    const deniedBatchLogs = await postMcp(apiServer, {
      token: validToken,
      body: [
        { jsonrpc: "2.0", id: 20, method: "tools/list" },
        {
          jsonrpc: "2.0",
          id: 21,
          method: "tools/call",
          params: { name: "service_lasso_logs_summary", arguments: { serviceId: "missing" } },
        },
      ],
    });
    assert.equal(deniedBatchLogs.status, 403);
    assert.match(deniedBatchLogs.authenticate, /scope="service-lasso:logs:read"/);

    const malformedJson = await postMcp(apiServer, { token: validToken, rawBody: "{" });
    assert.equal(malformedJson.status, 400);
    assert.equal(malformedJson.text.includes(validToken), false);

    const oversized = await postMcp(apiServer, {
      token: validToken,
      rawBody: JSON.stringify({ padding: "x".repeat(MCP_MAX_REQUEST_BODY_BYTES + 1) }),
    });
    assert.equal(oversized.status, 413);

    const allowed = await postMcp(apiServer, {
      token: validToken,
      body: {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "service_lasso_list_services", arguments: { actor: "untrusted-body-actor" } },
      },
    });
    assert.equal(allowed.status, 200);

    const audit = await readAuditEvents({
      workspaceRoot,
      query: { action: "mcp.auth.allowed" },
    });
    assert.ok(audit.events.length >= 1);
    assert.equal(audit.events[0].actor, "mcp-test-actor");
    assert.equal(audit.events[0].actor === "untrusted-body-actor", false);
    assert.equal(audit.events[0].metadata?.actorKind, "oauth");
    assert.equal(audit.events[0].metadata?.clientId, "mcp-test-client");
    assert.equal(audit.events[0].metadata?.permissionProfile, "observer");
    assert.equal(JSON.stringify(audit).includes(validToken), false);
    assert.equal(JSON.stringify(audit).includes(malformedMarker), false);
  } finally {
    await apiServer?.stop();
    await jwks.stop();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("#860 keeps unconfigured MCP loopback-local and rejects remote identity spoofing", async () => {
  const previousTrustProxy = process.env.SERVICE_LASSO_TRUST_PROXY_HEADERS;
  process.env.SERVICE_LASSO_TRUST_PROXY_HEADERS = "true";
  const { tempRoot, servicesRoot, workspaceRoot } = await makeTempServicesRoot("service-lasso-mcp-local-fallback-");
  let apiServer;
  try {
    apiServer = await startApiServer({ port: 0, servicesRoot, workspaceRoot });

    const local = await postMcp(apiServer, {
      origin: null,
      body: {
        jsonrpc: "2.0",
        id: 30,
        method: "tools/call",
        params: { name: "service_lasso_list_services", arguments: { actor: "spoofed-body-actor" } },
      },
    });
    assert.equal(local.status, 200);

    const readOnlyMutation = await postMcp(apiServer, {
      origin: null,
      body: {
        jsonrpc: "2.0",
        id: 32,
        method: "tools/call",
        params: { name: "service_lasso_start_service", arguments: { serviceId: "missing" } },
      },
    });
    assert.equal(readOnlyMutation.status, 403);
    assert.match(readOnlyMutation.text, /mcp_read_only_mode/);

    const remoteSpoof = await postMcp(apiServer, {
      origin: null,
      headers: {
        "x-forwarded-for": "192.0.2.60",
        "x-service-lasso-zitadel-user-id": "spoofed-header-actor",
      },
      body: {
        jsonrpc: "2.0",
        id: 31,
        method: "tools/list",
        actor: "spoofed-body-actor",
      },
    });
    assert.equal(remoteSpoof.status, 401);

    const audit = await readAuditEvents({ workspaceRoot, query: { action: "mcp.auth.allowed" } });
    assert.ok(audit.events.some((event) => event.actor === "local-root"));
    assert.equal(JSON.stringify(audit).includes("spoofed-body-actor"), false);
    assert.equal(JSON.stringify(audit).includes("spoofed-header-actor"), false);
  } finally {
    await apiServer?.stop();
    await rm(tempRoot, { recursive: true, force: true });
    if (previousTrustProxy === undefined) {
      delete process.env.SERVICE_LASSO_TRUST_PROXY_HEADERS;
    } else {
      process.env.SERVICE_LASSO_TRUST_PROXY_HEADERS = previousTrustProxy;
    }
  }
});

test("#860 fails closed when only part of the MCP OAuth configuration is present", async () => {
  const { tempRoot, servicesRoot, workspaceRoot } = await makeTempServicesRoot("service-lasso-mcp-config-");
  let apiServer;
  try {
    apiServer = await startApiServer({
      port: 0,
      servicesRoot,
      workspaceRoot,
      mcpHttpIdentity: {
        env: { SERVICE_LASSO_MCP_OAUTH_ISSUER: issuer },
      },
    });
    const metadata = await fetch(apiServer.url + "/.well-known/oauth-protected-resource");
    assert.equal(metadata.status, 503);
    const post = await postMcp(apiServer);
    assert.equal(post.status, 503);
  } finally {
    await apiServer?.stop();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("#860 rejects hostname lookalikes as insecure JWKS endpoints", () => {
  assert.throws(
    () => resolveMcpOAuthConfiguration({
      env: {
        SERVICE_LASSO_MCP_OAUTH_ISSUER: issuer,
        SERVICE_LASSO_MCP_OAUTH_JWKS_URI: "http://127.evil/jwks",
        SERVICE_LASSO_MCP_RESOURCE_URI: resource,
        SERVICE_LASSO_MCP_OAUTH_AUDIENCE: audience,
      },
    }),
    (error) => error?.code === "invalid_mcp_oauth_jwks_uri" && error?.statusCode === 503,
  );
});

test("#860 resolves explicit MCP modes, cumulative permission profiles, and bounded rate configuration", () => {
  assert.equal(resolveMcpOperatingMode({ env: {} }), "read-only");
  assert.equal(resolveMcpOperatingMode({ env: { SERVICE_LASSO_MCP_MODE: "disabled" } }), "disabled");
  assert.equal(resolveMcpOperatingMode({ env: { SERVICE_LASSO_MCP_MODE: "guarded" } }), "guarded");
  assert.throws(
    () => resolveMcpOperatingMode({ env: { SERVICE_LASSO_MCP_MODE: "open" } }),
    (error) => error?.code === "invalid_mcp_mode" && error?.statusCode === 503,
  );

  assert.equal(resolveMcpPermissionProfile(["service-lasso:read"]), "observer");
  assert.equal(resolveMcpPermissionProfile([
    "service-lasso:read",
    "service-lasso:lifecycle:write",
  ]), "operator");
  assert.equal(resolveMcpPermissionProfile([
    "service-lasso:read",
    "service-lasso:lifecycle:write",
    "service-lasso:config:write",
    "service-lasso:update:write",
  ]), "maintainer");
  assert.equal(resolveMcpPermissionProfile([
    "service-lasso:read",
    "service-lasso:lifecycle:write",
    "service-lasso:config:write",
    "service-lasso:update:write",
    "service-lasso:runtime:admin",
  ]), "administrator");
  assert.equal(resolveMcpPermissionProfile(["service-lasso:runtime:admin"]), "observer");

  assert.deepEqual(
    resolveMcpRateLimitConfiguration({
      env: {
        SERVICE_LASSO_MCP_RATE_LIMIT_WINDOW_MS: "5000",
        SERVICE_LASSO_MCP_RATE_LIMIT_PER_ACTOR: "3",
        SERVICE_LASSO_MCP_RATE_LIMIT_PER_CLIENT: "5",
      },
    }),
    { windowMs: 5000, perActor: 3, perClient: 5 },
  );
  assert.throws(
    () => resolveMcpRateLimitConfiguration({ env: { SERVICE_LASSO_MCP_RATE_LIMIT_PER_ACTOR: "0" } }),
    (error) => error?.code === "invalid_mcp_rate_limit_per_actor" && error?.statusCode === 503,
  );
});

test("#860 enforces guarded-mode profile evidence plus independent actor and client rate limits", async () => {
  const { tempRoot, servicesRoot, workspaceRoot } = await makeTempServicesRoot("service-lasso-mcp-rate-limit-");
  const jwks = await startJwksServer();
  let apiServer;
  const env = {
    SERVICE_LASSO_MCP_MODE: "guarded",
    SERVICE_LASSO_MCP_OAUTH_ISSUER: issuer,
    SERVICE_LASSO_MCP_OAUTH_JWKS_URI: jwks.jwksUri,
    SERVICE_LASSO_MCP_RESOURCE_URI: resource,
    SERVICE_LASSO_MCP_OAUTH_AUDIENCE: audience,
    SERVICE_LASSO_MCP_ALLOWED_ORIGINS: allowedOrigin,
    SERVICE_LASSO_MCP_RATE_LIMIT_WINDOW_MS: "60000",
    SERVICE_LASSO_MCP_RATE_LIMIT_PER_ACTOR: "2",
    SERVICE_LASSO_MCP_RATE_LIMIT_PER_CLIENT: "2",
  };

  try {
    apiServer = await startDirectApiServer({ servicesRoot, workspaceRoot, mcpHttpIdentity: { env } });
    const infoResponse = await fetch(apiServer.url + "/api/mcp/info");
    assert.equal(infoResponse.status, 200);
    const info = await infoResponse.json();
    assert.deepEqual(info.policy, { operatingMode: "guarded", guardedToolsAvailable: true });

    const profileScopes = {
      observer: "service-lasso:read",
      operator: "service-lasso:read service-lasso:lifecycle:write",
      maintainer: "service-lasso:read service-lasso:lifecycle:write service-lasso:config:write service-lasso:update:write",
      administrator: "service-lasso:read service-lasso:lifecycle:write service-lasso:config:write service-lasso:update:write service-lasso:runtime:admin",
    };
    const profileTokens = {};
    for (const [profile, scope] of Object.entries(profileScopes)) {
      const token = await signAccessToken(jwks.privateKey, {
        subject: `profile-${profile}`,
        claims: { client_id: `client-${profile}`, scope },
      });
      profileTokens[profile] = token;
      const allowed = await postMcp(apiServer, { token });
      assert.equal(allowed.status, 200);
    }

    const observerMutation = await postMcp(apiServer, {
      token: profileTokens.observer,
      body: {
        jsonrpc: "2.0",
        id: 61,
        method: "tools/call",
        params: { name: "service_lasso_start_service", arguments: { serviceId: "missing" } },
      },
    });
    assert.equal(observerMutation.status, 403);
    assert.match(observerMutation.authenticate, /scope="service-lasso:lifecycle:write"/);

    const actorToken = await signAccessToken(jwks.privateKey, {
      subject: "rate-actor",
      claims: { client_id: "rate-actor-client", scope: "service-lasso:read" },
    });
    assert.equal((await postMcp(apiServer, { token: actorToken })).status, 200);
    assert.equal((await postMcp(apiServer, { token: actorToken })).status, 200);
    const actorDenied = await postMcp(apiServer, { token: actorToken });
    assert.equal(actorDenied.status, 429);
    assert.match(actorDenied.retryAfter, /^[1-9][0-9]*$/);

    const sharedClientTokens = await Promise.all(["a", "b", "c"].map((suffix) => signAccessToken(jwks.privateKey, {
      subject: `shared-client-actor-${suffix}`,
      claims: { client_id: "shared-rate-client", scope: "service-lasso:read" },
    })));
    assert.equal((await postMcp(apiServer, { token: sharedClientTokens[0] })).status, 200);
    assert.equal((await postMcp(apiServer, { token: sharedClientTokens[1] })).status, 200);
    const clientDenied = await postMcp(apiServer, { token: sharedClientTokens[2] });
    assert.equal(clientDenied.status, 429);
    assert.match(clientDenied.retryAfter, /^[1-9][0-9]*$/);

    const audit = await readAuditEvents({ workspaceRoot });
    const profileByActor = new Map(audit.events
      .filter((event) => event.action === "mcp.auth.allowed")
      .map((event) => [event.actor, event.metadata?.permissionProfile]));
    for (const profile of Object.keys(profileScopes)) {
      assert.equal(profileByActor.get(`profile-${profile}`), profile);
    }
    const denied = audit.events.filter((event) => event.action === "mcp.auth.denied" && event.reason === "mcp_rate_limited");
    assert.ok(denied.some((event) => event.actor === "rate-actor" && event.metadata?.clientId === "rate-actor-client"));
    assert.ok(denied.some((event) => event.actor === "shared-client-actor-c" && event.metadata?.clientId === "shared-rate-client"));
    assert.ok(audit.events.some((event) =>
      event.action === "mcp.action.denied" &&
      event.actor === "profile-observer" &&
      event.reason === "mcp_insufficient_scope" &&
      event.metadata?.clientId === "client-observer" &&
      event.metadata?.action === "service_start" &&
      event.metadata?.targetIds?.includes("missing") &&
      typeof event.correlationId === "string"
    ));
    for (const token of [...Object.values(profileTokens), actorToken, ...sharedClientTokens]) {
      assert.equal(JSON.stringify(audit).includes(token), false);
    }
  } finally {
    await apiServer?.stop();
    await jwks.stop();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("#860 disables every MCP route and fails closed without leaking Audit-store errors", async () => {
  const { tempRoot, servicesRoot, workspaceRoot } = await makeTempServicesRoot("service-lasso-mcp-mode-audit-");
  const previousTestHooks = process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS;
  let disabledServer;
  let auditFailureServer;
  try {
    disabledServer = await startDirectApiServer({
      servicesRoot,
      workspaceRoot,
      mcpHttpIdentity: { env: { SERVICE_LASSO_MCP_MODE: "disabled" } },
    });
    assert.equal((await fetch(disabledServer.url + "/.well-known/oauth-protected-resource")).status, 404);
    assert.equal((await fetch(disabledServer.url + "/api/mcp/info")).status, 404);
    assert.equal((await postMcp(disabledServer, { origin: null })).status, 404);
    await disabledServer.stop();
    disabledServer = undefined;

    process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS = "1";
    const auditFailureMarker = "mcp-sensitive-audit-store-failure";
    auditFailureServer = await startDirectApiServer({
      servicesRoot,
      workspaceRoot,
      mcpPolicyTestHooks: {
        appendAuditEvent: async () => {
          throw new Error(auditFailureMarker);
        },
      },
    });
    const denied = await postMcp(auditFailureServer, { origin: null });
    assert.equal(denied.status, 503);
    assert.match(denied.text, /mcp_audit_unavailable/);
    assert.equal(denied.text.includes(auditFailureMarker), false);
    assert.equal(denied.text.includes("service_lasso_list_services"), false);
  } finally {
    await disabledServer?.stop();
    await auditFailureServer?.stop();
    await rm(tempRoot, { recursive: true, force: true });
    if (previousTestHooks === undefined) {
      delete process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS;
    } else {
      process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS = previousTestHooks;
    }
  }
});
