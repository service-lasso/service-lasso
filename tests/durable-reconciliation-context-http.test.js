import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { createServer, request as httpRequest } from "node:http";
import { access, mkdir, rm, writeFile } from "node:fs/promises";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { createApiServer } from "../dist/server/index.js";
import { mcpOperationStatePath } from "../dist/runtime/operator/mcp-operations.js";
import {
  getLifecycleDocumentPath,
  RECONCILIATION_CONTEXT_IDENTITY_POLICY,
} from "../dist/runtime/state/lifecycle-persistence.js";
import { makeTempServicesRoot } from "./test-helpers.js";

const issuer = "https://reconciliation-context-issuer.example";
const resource = "https://reconciliation-context.example/api/mcp";
const audience = "reconciliation-context-http";
const keyId = "reconciliation-context-key";

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
    async stop() {
      const closed = once(server, "close");
      server.close();
      server.closeAllConnections?.();
      await closed;
    },
  };
}

async function token(privateKey, actorId, clientId, scope = "service-lasso:read") {
  const now = Math.floor(Date.now() / 1_000);
  return await new SignJWT({ client_id: clientId, scope })
    .setProtectedHeader({ alg: "RS256", kid: keyId })
    .setIssuer(issuer)
    .setAudience(audience)
    .setSubject(actorId)
    .setJti(randomUUID())
    .setIssuedAt(now)
    .setExpirationTime(now + 300)
    .sign(privateKey);
}

async function startApi(options, port = 0) {
  const server = createApiServer(options);
  server.listen(port, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return {
    url: `http://127.0.0.1:${address.port}`,
    port: address.port,
    async stop() {
      const closed = once(server, "close");
      server.close();
      server.closeAllConnections?.();
      await closed;
    },
  };
}

async function readContext(api, accessToken, headers = {}) {
  const response = await fetch(`${api.url}/api/operator/lifecycle/reconciliation-context`, {
    headers: { connection: "close", ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}), ...headers },
  });
  return { status: response.status, body: await response.json() };
}

async function readContextWithHost(api, host, accessToken) {
  return await new Promise((resolve, reject) => {
    const request = httpRequest(`${api.url}/api/operator/lifecycle/reconciliation-context`, {
      headers: { host, connection: "close", ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}) },
    }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { body += chunk; });
      response.on("end", () => resolve({ status: response.statusCode, body: JSON.parse(body) }));
    });
    request.once("error", reject);
    request.end();
  });
}

async function pathExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

test("#1553 durable reconciliation context is a stable, closed, authorized HTTP read", async () => {
  const first = await makeTempServicesRoot("service-lasso-reconciliation-context-");
  const replacement = await makeTempServicesRoot("service-lasso-reconciliation-replacement-");
  const jwks = await startJwksServer();
  const env = {
    SERVICE_LASSO_MCP_MODE: "guarded",
    SERVICE_LASSO_MCP_OAUTH_ISSUER: issuer,
    SERVICE_LASSO_MCP_OAUTH_JWKS_URI: jwks.jwksUri,
    SERVICE_LASSO_MCP_RESOURCE_URI: resource,
    SERVICE_LASSO_MCP_OAUTH_AUDIENCE: audience,
  };
  let api;
  let replacementApi;
  let localApi;
  try {
    const actorAClientA = await token(jwks.privateKey, "actor-a", "client-a");
    const rotatedActorAClientA = await token(jwks.privateKey, "actor-a", "client-a");
    const actorBClientA = await token(jwks.privateKey, "actor-b", "client-a");
    const actorAClientB = await token(jwks.privateKey, "actor-a", "client-b");
    const insufficient = await token(jwks.privateKey, "actor-a", "client-a", "service-lasso:logs:read");
    api = await startApi({ servicesRoot: first.servicesRoot, workspaceRoot: first.workspaceRoot, mcpHttpIdentity: { env } });

    assert.equal(await pathExists(mcpOperationStatePath(first.workspaceRoot)), false);
    const initial = await readContext(api, actorAClientA);
    assert.equal(initial.status, 200);
    assert.deepEqual(Object.keys(initial.body).sort(), ["context", "contractVersion"]);
    assert.equal(initial.body.contractVersion, "service-lasso-durable-reconciliation-context.v1");
    assert.deepEqual(Object.keys(initial.body.context).sort(), ["actorBinding", "clientBinding", "instanceBinding", "workspaceBinding"]);
    for (const value of Object.values(initial.body.context)) assert.match(value, /^slrc_[a-f0-9]{64}$/u);
    assert.equal(JSON.stringify(initial.body).includes(first.tempRoot), false);
    assert.equal(JSON.stringify(initial.body).includes(actorAClientA), false);
    assert.equal(JSON.stringify(initial.body).includes("actor-a"), false);
    assert.equal(JSON.stringify(initial.body).includes("client-a"), false);
    assert.equal(await pathExists(mcpOperationStatePath(first.workspaceRoot)), false);

    const rotated = await readContext(api, rotatedActorAClientA);
    assert.deepEqual(rotated, initial);
    const changedActor = await readContext(api, actorBClientA);
    assert.equal(changedActor.status, 200);
    assert.notEqual(changedActor.body.context.actorBinding, initial.body.context.actorBinding);
    assert.equal(changedActor.body.context.clientBinding, initial.body.context.clientBinding);
    const changedClient = await readContext(api, actorAClientB);
    assert.equal(changedClient.status, 200);
    assert.equal(changedClient.body.context.actorBinding, initial.body.context.actorBinding);
    assert.notEqual(changedClient.body.context.clientBinding, initial.body.context.clientBinding);

    assert.equal((await readContext(api)).status, 401);
    assert.equal((await readContext(api, insufficient)).status, 403);
    const concurrent = await Promise.all(Array.from({ length: 20 }, () => readContext(api, actorAClientA)));
    for (const result of concurrent) assert.deepEqual(result, initial);

    const originalPort = api.port;
    await api.stop();
    api = await startApi({ servicesRoot: first.servicesRoot, workspaceRoot: first.workspaceRoot, mcpHttpIdentity: { env } }, originalPort);
    assert.deepEqual(await readContext(api, rotatedActorAClientA), initial);

    await api.stop();
    api = null;
    replacementApi = await startApi({ servicesRoot: replacement.servicesRoot, workspaceRoot: replacement.workspaceRoot, mcpHttpIdentity: { env } }, originalPort);
    const replacementContext = await readContext(replacementApi, actorAClientA);
    assert.equal(replacementContext.status, 200);
    assert.notEqual(replacementContext.body.context.instanceBinding, initial.body.context.instanceBinding);
    assert.notEqual(replacementContext.body.context.workspaceBinding, initial.body.context.workspaceBinding);
    assert.notEqual(replacementContext.body.context.actorBinding, initial.body.context.actorBinding);
    assert.notEqual(replacementContext.body.context.clientBinding, initial.body.context.clientBinding);

    await replacementApi.stop();
    replacementApi = null;
    await rm(replacement.workspaceRoot, { recursive: true, force: true });
    await mkdir(replacement.workspaceRoot, { recursive: true });
    replacementApi = await startApi({ servicesRoot: replacement.servicesRoot, workspaceRoot: replacement.workspaceRoot, mcpHttpIdentity: { env } }, originalPort);
    const samePathReplacement = await readContext(replacementApi, actorAClientA);
    assert.equal(samePathReplacement.status, 200);
    assert.notEqual(samePathReplacement.body.context.instanceBinding, replacementContext.body.context.instanceBinding);
    assert.notEqual(samePathReplacement.body.context.workspaceBinding, replacementContext.body.context.workspaceBinding);

    localApi = await startApi({
      servicesRoot: first.servicesRoot,
      workspaceRoot: first.workspaceRoot,
      mcpHttpIdentity: { env: { SERVICE_LASSO_MCP_MODE: "read-only" } },
    });
    const local = await readContext(localApi);
    assert.equal(local.status, 200);
    assert.equal(local.body.contractVersion, "service-lasso-durable-reconciliation-context.v1");
    assert.equal(await pathExists(mcpOperationStatePath(first.workspaceRoot)), false);
  } finally {
    await localApi?.stop().catch(() => undefined);
    await replacementApi?.stop().catch(() => undefined);
    await api?.stop().catch(() => undefined);
    await jwks.stop().catch(() => undefined);
    await rm(first.tempRoot, { recursive: true, force: true });
    await rm(replacement.tempRoot, { recursive: true, force: true });
  }
});

test("#1553 fails closed for missing, malformed, legacy, and duplicate durable identity state", async () => {
  const jwks = await startJwksServer();
  const env = {
    SERVICE_LASSO_MCP_MODE: "guarded",
    SERVICE_LASSO_MCP_OAUTH_ISSUER: issuer,
    SERVICE_LASSO_MCP_OAUTH_JWKS_URI: jwks.jwksUri,
    SERVICE_LASSO_MCP_RESOURCE_URI: resource,
    SERVICE_LASSO_MCP_OAUTH_AUDIENCE: audience,
  };
  const actor = await token(jwks.privateKey, "actor-a", "client-a");
  const cases = [
    { name: "missing", contents: null },
    { name: "malformed", contents: "{not-json" },
    { name: "legacy", contents: JSON.stringify({ version: 0, authorityId: "a".repeat(64) }) },
    {
      name: "custody mismatch",
      contents: JSON.stringify({
        schemaVersion: "service-lasso.reconciliation-context-identity.v1",
        version: 1,
        authorityId: "a".repeat(64),
      }),
    },
    {
      name: "duplicate keys",
      contents: `{"schemaVersion":"service-lasso.reconciliation-context-identity.v1","version":1,"authorityId":"${"a".repeat(64)}","authorityId":"${"b".repeat(64)}"}`,
    },
  ];
  try {
    for (const scenario of cases) {
      const fixture = await makeTempServicesRoot(`service-lasso-reconciliation-${scenario.name}-`);
      let api;
      let restarted;
      try {
        api = await startApi({ servicesRoot: fixture.servicesRoot, workspaceRoot: fixture.workspaceRoot, mcpHttpIdentity: { env } });
        assert.equal((await readContext(api, actor)).status, 200);
        const originalPort = api.port;
        await api.stop();
        api = null;
        const identityPath = getLifecycleDocumentPath(fixture.workspaceRoot, RECONCILIATION_CONTEXT_IDENTITY_POLICY);
        if (scenario.contents === null) await rm(identityPath, { force: true });
        else await writeFile(identityPath, scenario.contents, "utf8");
        restarted = await startApi({ servicesRoot: fixture.servicesRoot, workspaceRoot: fixture.workspaceRoot, mcpHttpIdentity: { env } }, originalPort);
        const response = await readContext(restarted, actor);
        assert.equal(response.status, 503, scenario.name);
        assert.equal(JSON.stringify(response.body).includes(fixture.tempRoot), false);
        assert.equal(JSON.stringify(response.body).includes("authorityId"), false);
      } finally {
        await restarted?.stop().catch(() => undefined);
        await api?.stop().catch(() => undefined);
        await rm(fixture.tempRoot, { recursive: true, force: true });
      }
    }
  } finally {
    await jwks.stop().catch(() => undefined);
  }
});

test("#1553 serializes concurrent Core initialization without rotating authority", async () => {
  const fixture = await makeTempServicesRoot("service-lasso-reconciliation-concurrent-");
  const first = await startApi({ servicesRoot: fixture.servicesRoot, workspaceRoot: fixture.workspaceRoot });
  const second = await startApi({ servicesRoot: fixture.servicesRoot, workspaceRoot: fixture.workspaceRoot });
  try {
    const [left, right] = await Promise.all([readContext(first), readContext(second)]);
    assert.equal(left.status, 200);
    assert.deepEqual(right, left);
  } finally {
    await second.stop().catch(() => undefined);
    await first.stop().catch(() => undefined);
    await rm(fixture.tempRoot, { recursive: true, force: true });
  }
});

test("#1553 keeps the shared read boundary's Origin and actor/client rate denials", async () => {
  const fixture = await makeTempServicesRoot("service-lasso-reconciliation-policy-");
  const jwks = await startJwksServer();
  const env = {
    SERVICE_LASSO_MCP_MODE: "guarded",
    SERVICE_LASSO_MCP_OAUTH_ISSUER: issuer,
    SERVICE_LASSO_MCP_OAUTH_JWKS_URI: jwks.jwksUri,
    SERVICE_LASSO_MCP_RESOURCE_URI: resource,
    SERVICE_LASSO_MCP_OAUTH_AUDIENCE: audience,
    SERVICE_LASSO_MCP_ALLOWED_ORIGINS: "https://allowed.example",
    SERVICE_LASSO_MCP_RATE_LIMIT_WINDOW_MS: "60000",
    SERVICE_LASSO_MCP_RATE_LIMIT_PER_ACTOR: "2",
    SERVICE_LASSO_MCP_RATE_LIMIT_PER_CLIENT: "2",
  };
  let api;
  try {
    const actor = await token(jwks.privateKey, "actor-a", "client-a");
    api = await startApi({ servicesRoot: fixture.servicesRoot, workspaceRoot: fixture.workspaceRoot, mcpHttpIdentity: { env } });
    const deniedOrigin = await readContext(api, actor, { origin: "https://denied.example" });
    assert.equal(deniedOrigin.status, 403);
    assert.equal(JSON.stringify(deniedOrigin.body).includes("denied.example"), false);
    const deniedHost = await readContextWithHost(api, "attacker-controlled.example", actor);
    assert.equal(deniedHost.status, 403);
    assert.equal(JSON.stringify(deniedHost.body).includes("attacker-controlled.example"), false);
    assert.equal((await readContext(api, actor, { origin: "https://allowed.example" })).status, 200);
    assert.equal((await readContext(api, actor, { origin: "https://allowed.example" })).status, 200);
    const limited = await readContext(api, actor, { origin: "https://allowed.example" });
    assert.equal(limited.status, 429);
    assert.equal(JSON.stringify(limited.body).includes(actor), false);
  } finally {
    await api?.stop().catch(() => undefined);
    await jwks.stop().catch(() => undefined);
    await rm(fixture.tempRoot, { recursive: true, force: true });
  }
});
