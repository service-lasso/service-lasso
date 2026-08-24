import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { rm } from "node:fs/promises";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { startApiServer } from "../dist/server/index.js";
import { readAuditEvents } from "../dist/runtime/audit/store.js";
import {
  MCP_MAX_REQUEST_BODY_BYTES,
  resolveMcpOAuthConfiguration,
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
    assert.deepEqual(metadata.scopes_supported, ["service-lasso:read", "service-lasso:logs:read"]);
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
