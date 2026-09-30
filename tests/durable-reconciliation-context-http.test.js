import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { access, rm } from "node:fs/promises";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { createApiServer } from "../dist/server/index.js";
import { mcpOperationStatePath } from "../dist/runtime/operator/mcp-operations.js";
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

async function readContext(api, accessToken) {
  const response = await fetch(`${api.url}/api/operator/lifecycle/reconciliation-context`, {
    headers: { connection: "close", ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}) },
  });
  return { status: response.status, body: await response.json() };
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
