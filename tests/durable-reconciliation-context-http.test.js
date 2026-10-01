import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createHash, randomUUID } from "node:crypto";
import { createServer, request as httpRequest } from "node:http";
import { access, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { createApiServer, waitForApiServerInitialization } from "../dist/server/index.js";
import { mcpOperationStatePath } from "../dist/runtime/operator/mcp-operations.js";
import {
  getLifecycleDocumentPath,
  RECONCILIATION_CONTEXT_AUTHORITY_POLICY,
  RECONCILIATION_CONTEXT_CUSTODY_POLICY,
  RECONCILIATION_CONTEXT_IDENTITY_POLICY,
  RECONCILIATION_CONTEXT_PUBLICATION_JOURNAL_POLICY,
  RECONCILIATION_CONTEXT_PUBLICATION_MARKER_POLICY,
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

async function startApi(options, port = 0, allowInitializationFailure = false) {
  const server = createApiServer(options);
  server.listen(port, "127.0.0.1");
  await once(server, "listening");
  if (allowInitializationFailure) {
    await assert.rejects(() => waitForApiServerInitialization(server));
  } else {
    await waitForApiServerInitialization(server);
  }
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

test("#1553 fails closed for malformed, legacy, custody-mismatched, and duplicate durable identity state", async () => {
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
    { name: "malformed", contents: "{not-json" },
    { name: "legacy", contents: JSON.stringify({ version: 0, authorityId: "a".repeat(64) }) },
    {
      name: "custody mismatch",
      contents: JSON.stringify({
        schemaVersion: "service-lasso.reconciliation-context-authority.v2",
        version: 2,
        authorityId: "a".repeat(64),
        authorityDigest: "b".repeat(64),
        phase: "committed",
      }),
    },
    {
      name: "duplicate keys",
      contents: `{"schemaVersion":"service-lasso.reconciliation-context-authority.v2","version":2,"authorityId":"${"a".repeat(64)}","authorityId":"${"b".repeat(64)}","authorityDigest":"${"a".repeat(64)}","phase":"committed"}`,
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
        const identityPath = getLifecycleDocumentPath(fixture.workspaceRoot, RECONCILIATION_CONTEXT_AUTHORITY_POLICY);
        await writeFile(identityPath, scenario.contents, "utf8");
        restarted = await startApi({ servicesRoot: fixture.servicesRoot, workspaceRoot: fixture.workspaceRoot, mcpHttpIdentity: { env } }, originalPort, true);
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

test("#1553 refuses the interrupted v1 custody publication rather than adopting or replacing it", async () => {
  const fixture = await makeTempServicesRoot("service-lasso-reconciliation-legacy-pair-");
  const jwks = await startJwksServer();
  let api;
  let restarted;
  try {
    const actor = await token(jwks.privateKey, "actor-a", "client-a");
    api = await startApi({
      servicesRoot: fixture.servicesRoot,
      workspaceRoot: fixture.workspaceRoot,
      mcpHttpIdentity: { env: {
        SERVICE_LASSO_MCP_MODE: "guarded",
        SERVICE_LASSO_MCP_OAUTH_ISSUER: issuer,
        SERVICE_LASSO_MCP_OAUTH_JWKS_URI: jwks.jwksUri,
        SERVICE_LASSO_MCP_RESOURCE_URI: resource,
        SERVICE_LASSO_MCP_OAUTH_AUDIENCE: audience,
      } },
    });
    const port = api.port;
    await api.stop();
    api = null;
    await rm(getLifecycleDocumentPath(fixture.workspaceRoot, RECONCILIATION_CONTEXT_AUTHORITY_POLICY), { force: true });
    await writeFile(getLifecycleDocumentPath(fixture.workspaceRoot, RECONCILIATION_CONTEXT_IDENTITY_POLICY), JSON.stringify({
      schemaVersion: "service-lasso.reconciliation-context-identity.v1",
      version: 1,
      authorityId: "a".repeat(64),
    }), "utf8");
    restarted = await startApi({ servicesRoot: fixture.servicesRoot, workspaceRoot: fixture.workspaceRoot, mcpHttpIdentity: { env: {
      SERVICE_LASSO_MCP_MODE: "guarded",
      SERVICE_LASSO_MCP_OAUTH_ISSUER: issuer,
      SERVICE_LASSO_MCP_OAUTH_JWKS_URI: jwks.jwksUri,
      SERVICE_LASSO_MCP_RESOURCE_URI: resource,
      SERVICE_LASSO_MCP_OAUTH_AUDIENCE: audience,
    } }, }, port, true);
    const response = await readContext(restarted, actor);
    assert.equal(response.status, 503);
    assert.equal(JSON.stringify(response.body).includes("authorityId"), false);
  } finally {
    await restarted?.stop().catch(() => undefined);
    await api?.stop().catch(() => undefined);
    await jwks.stop().catch(() => undefined);
    await rm(fixture.tempRoot, { recursive: true, force: true });
  }
});

test("#1553 rolls forward only a validated interrupted authority publication and never a lost published authority", async () => {
  const fixture = await makeTempServicesRoot("service-lasso-reconciliation-publication-recovery-");
  let api;
  let restarted;
  try {
    api = await startApi({ servicesRoot: fixture.servicesRoot, workspaceRoot: fixture.workspaceRoot });
    const initial = await readContext(api);
    assert.equal(initial.status, 200);
    const port = api.port;
    await api.stop();
    api = null;

    const authorityPath = getLifecycleDocumentPath(fixture.workspaceRoot, RECONCILIATION_CONTEXT_AUTHORITY_POLICY);
    const markerPath = getLifecycleDocumentPath(fixture.workspaceRoot, RECONCILIATION_CONTEXT_PUBLICATION_MARKER_POLICY);
    await rm(markerPath, { force: true });
    restarted = await startApi({ servicesRoot: fixture.servicesRoot, workspaceRoot: fixture.workspaceRoot }, port);
    assert.deepEqual(await readContext(restarted), initial, "authority plus matching journal restores only the marker");
    await restarted.stop();
    restarted = null;

    await rm(authorityPath, { force: true });
    restarted = await startApi({ servicesRoot: fixture.servicesRoot, workspaceRoot: fixture.workspaceRoot }, port, true);
    const lostAuthority = await readContext(restarted);
    assert.equal(lostAuthority.status, 503, "a published marker never permits authority replacement");
    await restarted.stop();
    restarted = null;

    await rm(fixture.workspaceRoot, { recursive: true, force: true });
    await mkdir(fixture.workspaceRoot, { recursive: true });
    const stagedAuthorityId = "c".repeat(64);
    const stagedDigest = createHash("sha256").update(stagedAuthorityId, "utf8").digest("hex");
    const journalPath = getLifecycleDocumentPath(fixture.workspaceRoot, RECONCILIATION_CONTEXT_PUBLICATION_JOURNAL_POLICY);
    await mkdir(path.dirname(journalPath), { recursive: true });
    await writeFile(journalPath, JSON.stringify({
      schemaVersion: "service-lasso.reconciliation-context-publication-journal.v1",
      version: 1,
      authorityId: stagedAuthorityId,
      authorityDigest: stagedDigest,
    }), "utf8");
    restarted = await startApi({ servicesRoot: fixture.servicesRoot, workspaceRoot: fixture.workspaceRoot }, port);
    const journalRecovery = await readContext(restarted);
    assert.equal(journalRecovery.status, 200);
    assert.notEqual(journalRecovery.body.context.instanceBinding, initial.body.context.instanceBinding);
    assert.equal(await pathExists(getLifecycleDocumentPath(fixture.workspaceRoot, RECONCILIATION_CONTEXT_AUTHORITY_POLICY)), true);
    assert.equal(await pathExists(getLifecycleDocumentPath(fixture.workspaceRoot, RECONCILIATION_CONTEXT_PUBLICATION_MARKER_POLICY)), true);
  } finally {
    await restarted?.stop().catch(() => undefined);
    await api?.stop().catch(() => undefined);
    await rm(fixture.tempRoot, { recursive: true, force: true });
  }
});

test("#1553 fails closed without changing any exact custody residue after primary loss", async () => {
  const custodyPolicies = [
    RECONCILIATION_CONTEXT_AUTHORITY_POLICY,
    RECONCILIATION_CONTEXT_PUBLICATION_JOURNAL_POLICY,
    RECONCILIATION_CONTEXT_PUBLICATION_MARKER_POLICY,
    RECONCILIATION_CONTEXT_IDENTITY_POLICY,
    RECONCILIATION_CONTEXT_CUSTODY_POLICY,
  ];
  const residueKinds = [
    { name: "crash backup", suffix: (policy) => ".bak" },
    { name: "migration backup", suffix: (policy) => `.v${policy.legacyVersion}.bak` },
    { name: "migration journal", suffix: () => ".migrate.json" },
    { name: "migration candidate", suffix: () => ".migrate.tmp" },
    { name: "writer temp", suffix: () => `.123.${randomUUID()}.tmp` },
  ];
  for (const policy of custodyPolicies) {
    for (const residueKind of residueKinds) {
      const fixture = await makeTempServicesRoot(`service-lasso-reconciliation-residue-${policy.currentVersion}-`);
      let api;
      let restarted;
      try {
        api = await startApi({ servicesRoot: fixture.servicesRoot, workspaceRoot: fixture.workspaceRoot });
        const initial = await readContext(api);
        assert.equal(initial.status, 200);
        const port = api.port;
        await api.stop();
        api = null;

        for (const primaryPolicy of custodyPolicies.slice(0, 3)) {
          await rm(getLifecycleDocumentPath(fixture.workspaceRoot, primaryPolicy), { force: true });
        }
        const primaryPath = getLifecycleDocumentPath(fixture.workspaceRoot, policy);
        const residuePath = `${primaryPath}${residueKind.suffix(policy)}`;
        await writeFile(residuePath, "retained-custody-residue", "utf8");
        const stateDirectory = path.dirname(primaryPath);
        const beforeEntries = await readdir(stateDirectory);
        const beforeResidue = await readFile(residuePath, "utf8");

        restarted = await startApi({ servicesRoot: fixture.servicesRoot, workspaceRoot: fixture.workspaceRoot }, port, true);
        const response = await readContext(restarted);
        assert.equal(response.status, 503, `${policy.currentSchemaVersion} ${residueKind.name}`);
        assert.equal(JSON.stringify(response.body).includes("retained-custody-residue"), false);
        assert.deepEqual(await readdir(stateDirectory), beforeEntries);
        assert.equal(await readFile(residuePath, "utf8"), beforeResidue);
        for (const primaryPolicy of custodyPolicies.slice(0, 3)) {
          assert.equal(await pathExists(getLifecycleDocumentPath(fixture.workspaceRoot, primaryPolicy)), false);
        }
      } finally {
        await restarted?.stop().catch(() => undefined);
        await api?.stop().catch(() => undefined);
        await rm(fixture.tempRoot, { recursive: true, force: true });
      }
    }
  }
});

test("#1553 ignores unrelated workspace files while creating a legitimately fresh authority", async () => {
  const fixture = await makeTempServicesRoot("service-lasso-reconciliation-unrelated-");
  let api;
  try {
    const stateDirectory = path.dirname(getLifecycleDocumentPath(fixture.workspaceRoot, RECONCILIATION_CONTEXT_AUTHORITY_POLICY));
    await mkdir(stateDirectory, { recursive: true });
    await writeFile(path.join(stateDirectory, "unrelated-lifecycle-note.tmp"), "not-custody", "utf8");
    api = await startApi({ servicesRoot: fixture.servicesRoot, workspaceRoot: fixture.workspaceRoot });
    assert.equal((await readContext(api)).status, 200);
  } finally {
    await api?.stop().catch(() => undefined);
    await rm(fixture.tempRoot, { recursive: true, force: true });
  }
});

test("#1553 fails closed when authority custody is replaced by a filesystem redirect object", async () => {
  const fixture = await makeTempServicesRoot("service-lasso-reconciliation-redirect-");
  const jwks = await startJwksServer();
  let api;
  let restarted;
  try {
    const actor = await token(jwks.privateKey, "actor-a", "client-a");
    api = await startApi({ servicesRoot: fixture.servicesRoot, workspaceRoot: fixture.workspaceRoot, mcpHttpIdentity: { env: {
      SERVICE_LASSO_MCP_MODE: "guarded",
      SERVICE_LASSO_MCP_OAUTH_ISSUER: issuer,
      SERVICE_LASSO_MCP_OAUTH_JWKS_URI: jwks.jwksUri,
      SERVICE_LASSO_MCP_RESOURCE_URI: resource,
      SERVICE_LASSO_MCP_OAUTH_AUDIENCE: audience,
    } } });
    const port = api.port;
    await api.stop();
    api = null;
    const authorityPath = getLifecycleDocumentPath(fixture.workspaceRoot, RECONCILIATION_CONTEXT_AUTHORITY_POLICY);
    await rm(authorityPath, { force: true });
    await mkdir(authorityPath);
    restarted = await startApi({ servicesRoot: fixture.servicesRoot, workspaceRoot: fixture.workspaceRoot, mcpHttpIdentity: { env: {
      SERVICE_LASSO_MCP_MODE: "guarded",
      SERVICE_LASSO_MCP_OAUTH_ISSUER: issuer,
      SERVICE_LASSO_MCP_OAUTH_JWKS_URI: jwks.jwksUri,
      SERVICE_LASSO_MCP_RESOURCE_URI: resource,
      SERVICE_LASSO_MCP_OAUTH_AUDIENCE: audience,
    } }, }, port, true);
    const response = await readContext(restarted, actor);
    assert.equal(response.status, 503);
    assert.equal(JSON.stringify(response.body).includes(authorityPath), false);
  } finally {
    await restarted?.stop().catch(() => undefined);
    await api?.stop().catch(() => undefined);
    await jwks.stop().catch(() => undefined);
    await rm(fixture.tempRoot, { recursive: true, force: true });
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

test("#1553 records exactly one redacted authorization Audit event before GET success or denial and fails closed on Audit outage", async () => {
  const fixture = await makeTempServicesRoot("service-lasso-reconciliation-audit-");
  const jwks = await startJwksServer();
  const previousTestHooks = process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS;
  const events = [];
  let api;
  let outageApi;
  try {
    process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS = "1";
    const env = {
      SERVICE_LASSO_MCP_MODE: "guarded",
      SERVICE_LASSO_MCP_OAUTH_ISSUER: issuer,
      SERVICE_LASSO_MCP_OAUTH_JWKS_URI: jwks.jwksUri,
      SERVICE_LASSO_MCP_RESOURCE_URI: resource,
      SERVICE_LASSO_MCP_OAUTH_AUDIENCE: audience,
    };
    const allowed = await token(jwks.privateKey, "audit-actor", "audit-client");
    const denied = await token(jwks.privateKey, "denied-actor", "denied-client", "service-lasso:logs:read");
    api = await startApi({
      servicesRoot: fixture.servicesRoot,
      workspaceRoot: fixture.workspaceRoot,
      mcpHttpIdentity: { env },
      mcpPolicyTestHooks: { appendAuditEvent: async (event) => { events.push(event); } },
    });
    assert.equal((await readContext(api, allowed)).status, 200);
    assert.equal((await readContext(api, denied)).status, 403);
    assert.equal(events.length, 2);
    assert.deepEqual(events.map((event) => [event.action, event.outcome, event.statusCode, event.actor, event.metadata.clientId]), [
      ["mcp.auth.allowed", "success", 200, "audit-actor", "audit-client"],
      ["mcp.auth.denied", "failure", 403, "denied-actor", "denied-client"],
    ]);
    for (const event of events) {
      assert.equal(Object.hasOwn(event, "workspaceRoot"), false);
      assert.equal(Object.hasOwn(event, "serviceRoot"), false);
      assert.equal(event.routeTemplate, "/api/operator/lifecycle/reconciliation-context");
      assert.equal(event.method, "GET");
      assert.equal(JSON.stringify(event).includes(allowed), false);
      assert.equal(JSON.stringify(event).includes(denied), false);
      assert.equal(JSON.stringify(event).includes(fixture.tempRoot), false);
      assert.equal(JSON.stringify(event).includes(fixture.workspaceRoot), false);
      assert.equal(JSON.stringify(event).includes("Bearer "), false);
      assert.equal(JSON.stringify(event).includes("/api/operator/lifecycle/reconciliation-context"), true);
    }

    outageApi = await startApi({
      servicesRoot: fixture.servicesRoot,
      workspaceRoot: fixture.workspaceRoot,
      mcpHttpIdentity: { env },
      mcpPolicyTestHooks: { appendAuditEvent: async () => { throw new Error("audit-sensitive-failure"); } },
    });
    const outage = await readContext(outageApi, allowed);
    assert.equal(outage.status, 503);
    assert.equal(outage.body.error, "mcp_audit_unavailable");
    assert.equal(JSON.stringify(outage.body).includes("audit-sensitive-failure"), false);
    assert.equal(JSON.stringify(outage.body).includes(allowed), false);
  } finally {
    await outageApi?.stop().catch(() => undefined);
    await api?.stop().catch(() => undefined);
    await jwks.stop().catch(() => undefined);
    await rm(fixture.tempRoot, { recursive: true, force: true });
    if (previousTestHooks === undefined) delete process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS;
    else process.env.SERVICE_LASSO_ENABLE_TEST_HOOKS = previousTestHooks;
  }
});

test("#1553 direct server initialization rejection remains observable and retains its owned workspace", async () => {
  const fixture = await makeTempServicesRoot("service-lasso-reconciliation-initializer-rejection-");
  const authorityPath = getLifecycleDocumentPath(fixture.workspaceRoot, RECONCILIATION_CONTEXT_AUTHORITY_POLICY);
  const server = createApiServer({ servicesRoot: fixture.servicesRoot, workspaceRoot: fixture.workspaceRoot });
  let closed = false;
  try {
    await mkdir(path.dirname(authorityPath), { recursive: true });
    await writeFile(authorityPath, "{malformed", "utf8");
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    await assert.rejects(
      () => waitForApiServerInitialization(server),
      /reconciliation/i,
    );
    assert.equal(await pathExists(authorityPath), true);
  } finally {
    if (server.listening) {
      const close = once(server, "close");
      server.close();
      server.closeAllConnections?.();
      await close;
      closed = true;
    }
  }
  assert.equal(closed, true);
  assert.equal(await pathExists(authorityPath), true);
  await rm(fixture.tempRoot, { recursive: true, force: true });
});
