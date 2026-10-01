import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { rm } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import path from "node:path";
import { zipSync } from "fflate";
import { startApiServer } from "../dist/server/index.js";
import { makeTempServicesRoot } from "./test-helpers.js";

const commitSha = "a".repeat(40);
const bearer = { authorization: "Bearer staged-http-test-token" };

function responseJson(response) {
  return response.json();
}

async function rawRequest(url, { method = "GET", headers = {}, body = null } = {}) {
  const target = new URL(url);
  return await new Promise((resolve, reject) => {
    const request = httpRequest({ hostname: target.hostname, port: target.port, path: `${target.pathname}${target.search}`, method, headers }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve({ status: response.statusCode, body: Buffer.concat(chunks).toString("utf8") }));
    });
    request.on("error", reject);
    if (body !== null) request.write(body);
    request.end();
  });
}

function trustedActorHeaders(actorId, roles) {
  return {
    authorization: "Bearer trusted-ingress-transport-token",
    "x-service-lasso-internal-proxy": "serviceadmin",
    "x-service-lasso-trusted-ingress": "serviceadmin-loopback",
    "x-service-lasso-user": actorId,
    "x-service-lasso-roles": roles,
  };
}

test("staged transfer HTTP maps an unavailable default owner catalog to closed release provenance", async () => {
  const { tempRoot, servicesRoot, workspaceRoot } = await makeTempServicesRoot("service-lasso-staged-http-default-catalog-");
  const previousInstanceRegistry = process.env.SERVICE_LASSO_INSTANCE_REGISTRY_PATH;
  const previousHostRegistry = process.env.SERVICE_LASSO_HOST_PORT_REGISTRY_PATH;
  process.env.SERVICE_LASSO_INSTANCE_REGISTRY_PATH = path.join(tempRoot, "instance-registry.json");
  process.env.SERVICE_LASSO_HOST_PORT_REGISTRY_PATH = path.join(tempRoot, "host-port-registry.json");
  const api = await startApiServer({ port: 0, servicesRoot, workspaceRoot });
  try {
    const response = await fetch(`${api.url}/api/v1/service-transfers`, {
      method: "POST",
      headers: { ...trustedActorHeaders("default-catalog-owner", "owner"), "content-type": "application/json" },
      body: JSON.stringify({
        targetServiceId: "default-catalog-service",
        provenance: { repo: "service-lasso/lasso-example", releaseTag: "v1", commitSha },
        platform: "win32",
        manifestSchemaVersion: "service-lasso.service-manifest/v1",
      }),
    });
    const body = await responseJson(response);
    assert.equal(response.status, 503);
    assert.equal(body.error, "release_provenance_unavailable");
    assert.equal(JSON.stringify(body).includes("owner catalog pin unavailable"), false);
  } finally {
    await api.stop();
    await rm(tempRoot, { recursive: true, force: true });
    if (previousInstanceRegistry === undefined) delete process.env.SERVICE_LASSO_INSTANCE_REGISTRY_PATH;
    else process.env.SERVICE_LASSO_INSTANCE_REGISTRY_PATH = previousInstanceRegistry;
    if (previousHostRegistry === undefined) delete process.env.SERVICE_LASSO_HOST_PORT_REGISTRY_PATH;
    else process.env.SERVICE_LASSO_HOST_PORT_REGISTRY_PATH = previousHostRegistry;
  }
});

async function responseBeforeRequestBody(url, { headers }) {
  const target = new URL(url);
  return await new Promise((resolve, reject) => {
    const request = httpRequest({ hostname: target.hostname, port: target.port, path: `${target.pathname}${target.search}`, method: "POST", headers });
    const timeout = setTimeout(() => {
      request.destroy();
      reject(new Error("server waited for a denied request body"));
    }, 1_000);
    request.once("response", (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        clearTimeout(timeout);
        request.destroy();
        resolve({ status: response.statusCode, body: Buffer.concat(chunks).toString("utf8") });
      });
    });
    request.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    request.flushHeaders();
  });
}

test("staged transfer HTTP route enforces closed credentials and drives an actor-scoped byte-bound registration", async () => {
  const { tempRoot, servicesRoot, workspaceRoot } = await makeTempServicesRoot("service-lasso-staged-http-");
  const previousInstanceRegistry = process.env.SERVICE_LASSO_INSTANCE_REGISTRY_PATH;
  const previousHostRegistry = process.env.SERVICE_LASSO_HOST_PORT_REGISTRY_PATH;
  process.env.SERVICE_LASSO_INSTANCE_REGISTRY_PATH = path.join(tempRoot, "instance-registry.json");
  process.env.SERVICE_LASSO_HOST_PORT_REGISTRY_PATH = path.join(tempRoot, "host-port-registry.json");
  const archive = Buffer.from(zipSync({ "release.txt": Buffer.from("staged fixture") }));
  const archiveSha256 = createHash("sha256").update(archive).digest("hex");
  const heldManifest = Buffer.from("staged-http-held-manifest", "utf8");
  const identity = {
    repo: "service-lasso/lasso-example", releaseTag: "v1", commitSha,
    targetServiceId: "staged-http-service", platform: "win32", archiveType: "zip",
    assetName: "staged.zip", assetId: "asset-1", archiveBytes: archive.length,
    archiveSha256, manifestSha256: createHash("sha256").update(heldManifest).digest("hex"), manifestBytes: heldManifest.toString("base64"), releaseId: "release-1",
    manifestAssetId: "manifest-1", checksumAssetId: "checksums-1",
  };
  const imported = [];
  const api = await startApiServer({
    port: 0, servicesRoot, workspaceRoot,
    stagedServiceTransfer: {
      resolver: { resolve: async () => identity },
      importer: {
        import: async (input) => {
          const bytes = input.readByteObject();
          assert.deepEqual(bytes, archive);
          assert.equal(input.readByteObject(), null, "HTTP registration receives one read-once claimed object");
          imported.push({ id: input.byteObjectId, digest: input.archiveSha256, workspace: input.workspaceId });
          return "completed";
        },
        reconcile: async () => "completed",
      },
    },
  });
  try {
    const createBody = {
      targetServiceId: identity.targetServiceId,
      provenance: { repo: identity.repo, releaseTag: identity.releaseTag, commitSha },
      platform: "win32", manifestSchemaVersion: "service-lasso.service-manifest/v1",
    };
    const missing = await fetch(`${api.url}/api/v1/service-transfers`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(createBody),
    });
    assert.equal(missing.status, 401);
    assert.equal((await responseJson(missing)).error, "actor_credential_missing");

    const invalid = await fetch(`${api.url}/api/v1/service-transfers`, {
      method: "POST", headers: { "content-type": "application/json", authorization: "Token nope" }, body: JSON.stringify(createBody),
    });
    assert.equal(invalid.status, 401);
    assert.equal((await responseJson(invalid)).error, "actor_credential_invalid");

    const misplaced = await fetch(`${api.url}/api/v1/service-transfers`, {
      method: "POST", headers: { "content-type": "application/json", ...bearer, "x-service-transfer-confirmation": "scf_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }, body: JSON.stringify(createBody),
    });
    assert.equal(misplaced.status, 400);
    assert.equal((await responseJson(misplaced)).error, "invalid_request");

    const createdResponse = await fetch(`${api.url}/api/v1/service-transfers`, {
      method: "POST", headers: { "content-type": "application/json", ...bearer }, body: JSON.stringify(createBody),
    });
    assert.equal(createdResponse.status, 201, JSON.stringify(await createdResponse.clone().json()));
    const created = await responseJson(createdResponse);
    assert.equal(created.archiveBytes, archive.length);
    assert.equal(created.workspaceId, undefined);

    const upload = await fetch(`${api.url}/api/v1/service-transfers/${created.stageId}/chunks/0`, {
      method: "PUT",
      headers: { ...bearer, "content-type": "application/octet-stream", "x-service-transfer-token": created.uploadToken, "x-chunk-sha256": archiveSha256, "content-range": `bytes 0-${archive.length - 1}/${archive.length}` },
      body: archive,
    });
    assert.equal(upload.status, 204);

    const finalized = await fetch(`${api.url}/api/v1/service-transfers/${created.stageId}/finalize`, { method: "POST", headers: bearer });
    assert.equal(finalized.status, 200);
    assert.equal((await responseJson(finalized)).state, "ready");

    const confirmationResponse = await fetch(`${api.url}/api/v1/service-transfers/${created.stageId}/confirmation`, { method: "POST", headers: bearer });
    assert.equal(confirmationResponse.status, 200);
    const confirmation = await responseJson(confirmationResponse);

    const registration = await fetch(`${api.url}/api/v1/service-transfers/${created.stageId}/registration`, {
      method: "POST", headers: { "content-type": "application/json", ...bearer, "x-service-transfer-confirmation": confirmation.confirmationId },
      body: JSON.stringify({ idempotencyKey: "staged-http-idempotency-0001" }),
    });
    assert.equal(registration.status, 202);
    assert.equal((await responseJson(registration)).replayed, false);
    assert.equal(imported.length, 1);

    const replay = await fetch(`${api.url}/api/v1/service-transfers/${created.stageId}/registration`, {
      method: "POST", headers: { "content-type": "application/json", ...bearer, "x-service-transfer-confirmation": confirmation.confirmationId },
      body: JSON.stringify({ idempotencyKey: "staged-http-idempotency-0001" }),
    });
    assert.equal(replay.status, 200);
    assert.equal((await responseJson(replay)).replayed, true);
    assert.equal(imported.length, 1, "a replay cannot invoke the child twice");

    const status = await fetch(`${api.url}/api/v1/service-transfers/${created.stageId}`, { headers: bearer });
    assert.equal(status.status, 200);
    const readback = await responseJson(status);
    assert.equal(readback.state, "consumed");
    assert.equal(JSON.stringify(readback).includes(archiveSha256), false, "HTTP readback exposes only safe digest prefixes");

    const queried = await fetch(`${api.url}/api/v1/service-transfers/${created.stageId}?workspace=caller-controlled`, { headers: bearer });
    assert.equal(queried.status, 400);
  } finally {
    await api.stop();
    await rm(tempRoot, { recursive: true, force: true });
    if (previousInstanceRegistry === undefined) delete process.env.SERVICE_LASSO_INSTANCE_REGISTRY_PATH;
    else process.env.SERVICE_LASSO_INSTANCE_REGISTRY_PATH = previousInstanceRegistry;
    if (previousHostRegistry === undefined) delete process.env.SERVICE_LASSO_HOST_PORT_REGISTRY_PATH;
    else process.env.SERVICE_LASSO_HOST_PORT_REGISTRY_PATH = previousHostRegistry;
  }
});

test("staged transfer HTTP rejects malformed route grammar before state disclosure and accepts only strict transfer bodies", async () => {
  const { tempRoot, servicesRoot, workspaceRoot } = await makeTempServicesRoot("service-lasso-staged-http-negative-");
  const priorInstance = process.env.SERVICE_LASSO_INSTANCE_REGISTRY_PATH;
  const priorHost = process.env.SERVICE_LASSO_HOST_PORT_REGISTRY_PATH;
  process.env.SERVICE_LASSO_INSTANCE_REGISTRY_PATH = path.join(tempRoot, "instance-registry.json");
  process.env.SERVICE_LASSO_HOST_PORT_REGISTRY_PATH = path.join(tempRoot, "host-port-registry.json");
  const archive = Buffer.from(zipSync({ "release.txt": Buffer.from("negative fixture") }));
  const digest = createHash("sha256").update(archive).digest("hex");
  const identity = { repo: "service-lasso/lasso-example", releaseTag: "v1", commitSha, targetServiceId: "negative-http-service", platform: "win32", archiveType: "zip", assetName: "negative.zip", assetId: "asset-negative", archiveBytes: archive.length, archiveSha256: digest, manifestSha256: "b".repeat(64), releaseId: "release-negative", manifestAssetId: "manifest-negative", checksumAssetId: "checksums-negative" };
  let imported = 0;
  const api = await startApiServer({ port: 0, servicesRoot, workspaceRoot, stagedServiceTransfer: { resolver: { resolve: async () => identity }, importer: { import: async () => { imported += 1; return "completed"; }, reconcile: async () => "completed" } } });
  const createBody = JSON.stringify({ targetServiceId: identity.targetServiceId, provenance: { repo: identity.repo, releaseTag: identity.releaseTag, commitSha }, platform: "win32", manifestSchemaVersion: "service-lasso.service-manifest/v1" });
  try {
    const malformedHeaders = [
      ["POST", "/api/v1/service-transfers", { authorization: ["Bearer one", "Bearer two"], "content-type": "application/json" }, createBody],
      ["POST", "/api/v1/service-transfers", { ...bearer, "content-type": "text/plain" }, createBody],
      ["POST", "/api/v1/service-transfers", { ...bearer, "content-type": "application/json", "x-service-transfer-token": "sut_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }, createBody],
      ["POST", "/api/v1/service-transfers", { ...bearer, "content-type": "application/json", "x-service-transfer-confirmation": "scf_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }, createBody],
    ];
    for (const [method, route, headers, body] of malformedHeaders) {
      const response = await rawRequest(`${api.url}${route}`, { method, headers, body });
      assert.equal(response.status, 400, `${route}: ${response.body}`);
      assert.equal(JSON.parse(response.body).error, "invalid_request");
    }
    for (const body of [
      '{"targetServiceId":"negative-http-service","targetServiceId":"other","provenance":{"repo":"service-lasso/lasso-example","releaseTag":"v1","commitSha":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},"platform":"win32","manifestSchemaVersion":"service-lasso.service-manifest/v1"}',
      '{"targetServiceId":"negative-http-service","\\u0074argetServiceId":"other","provenance":{"repo":"service-lasso/lasso-example","releaseTag":"v1","commitSha":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},"platform":"win32","manifestSchemaVersion":"service-lasso.service-manifest/v1"}',
      JSON.stringify({ ...JSON.parse(createBody), unexpected: true }),
      "{not-json",
    ]) {
      const response = await rawRequest(`${api.url}/api/v1/service-transfers`, { method: "POST", headers: { ...bearer, "content-type": "application/json" }, body });
      assert.equal(response.status, 400, response.body);
    }
    const createdResponse = await fetch(`${api.url}/api/v1/service-transfers`, { method: "POST", headers: { ...bearer, "content-type": "application/json" }, body: createBody });
    assert.equal(createdResponse.status, 201);
    const created = await createdResponse.json();
    const stageRoutes = [
      ["GET", `/api/v1/service-transfers/${created.stageId}/finalize`],
      ["PUT", `/api/v1/service-transfers/${created.stageId}/confirmation`],
      ["POST", `/api/v1/service-transfers/${created.stageId}/chunks/0`],
      ["GET", `/api/v1/service-transfers/${created.stageId}/chunks/0`],
    ];
    for (const [method, route] of stageRoutes) {
      const response = await rawRequest(`${api.url}${route}`, { method, headers: bearer });
      assert.equal(response.status, 404, `${method} ${route}: ${response.body}`);
    }
    for (const route of [`/api/v1/service-transfers/${created.stageId}?tail=1`, `/api/v1/service-transfers/${created.stageId}/finalize?x=1`]) {
      const response = await rawRequest(`${api.url}${route}`, { headers: bearer });
      assert.equal(response.status, 400);
    }
    const badUpload = await rawRequest(`${api.url}/api/v1/service-transfers/${created.stageId}/chunks/0`, { method: "PUT", headers: { ...bearer, "content-type": "application/json", "x-service-transfer-token": created.uploadToken, "x-chunk-sha256": digest, "content-range": `bytes 0-${archive.length - 1}/${archive.length}`, "content-length": String(archive.length) }, body: archive });
    assert.equal(badUpload.status, 400);
    const noPermissionMutation = await rawRequest(`${api.url}/api/v1/service-transfers/${created.stageId}/registration`, { method: "POST", headers: { ...bearer, "content-type": "application/json", "x-service-transfer-confirmation": "scf_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }, body: JSON.stringify({ idempotencyKey: "negative-http-replay-0001" }) });
    assert.equal(noPermissionMutation.status, 404, "registration cannot consume or mutate an uploading stage");
    assert.equal(imported, 0);
  } finally {
    await api.stop();
    await rm(tempRoot, { recursive: true, force: true });
    if (priorInstance === undefined) delete process.env.SERVICE_LASSO_INSTANCE_REGISTRY_PATH; else process.env.SERVICE_LASSO_INSTANCE_REGISTRY_PATH = priorInstance;
    if (priorHost === undefined) delete process.env.SERVICE_LASSO_HOST_PORT_REGISTRY_PATH; else process.env.SERVICE_LASSO_HOST_PORT_REGISTRY_PATH = priorHost;
  }
});

test("staged transfer HTTP keeps actors isolated, denies before body reads, and preserves terminal confirmation privacy", async () => {
  const { tempRoot, servicesRoot, workspaceRoot } = await makeTempServicesRoot("service-lasso-staged-http-actors-");
  const priorInstance = process.env.SERVICE_LASSO_INSTANCE_REGISTRY_PATH;
  const priorHost = process.env.SERVICE_LASSO_HOST_PORT_REGISTRY_PATH;
  process.env.SERVICE_LASSO_INSTANCE_REGISTRY_PATH = path.join(tempRoot, "instance-registry.json");
  process.env.SERVICE_LASSO_HOST_PORT_REGISTRY_PATH = path.join(tempRoot, "host-port-registry.json");
  const archive = Buffer.from(zipSync({ "release.txt": Buffer.from("actor terminal fixture") }));
  const digest = createHash("sha256").update(archive).digest("hex");
  const heldManifest = Buffer.from("terminal-http-held-manifest", "utf8");
  let now = 1_700_000_000_000;
  let resolutions = 0;
  let imports = 0;
  const owner = trustedActorHeaders("owner-actor", "owner");
  const secondOwner = trustedActorHeaders("second-owner", "owner");
  const viewer = trustedActorHeaders("viewer-actor", "viewer");
  const identityFor = (targetServiceId) => ({
    repo: "service-lasso/lasso-example", releaseTag: "v1", commitSha, targetServiceId,
    platform: "win32", archiveType: "zip", assetName: `${targetServiceId}.zip`, assetId: `asset-${targetServiceId}`,
    archiveBytes: archive.length, archiveSha256: targetServiceId === "rejected-http-service" ? "c".repeat(64) : digest, manifestSha256: createHash("sha256").update(heldManifest).digest("hex"), manifestBytes: heldManifest.toString("base64"), releaseId: `release-${targetServiceId}`,
    manifestAssetId: `manifest-${targetServiceId}`, checksumAssetId: `checksums-${targetServiceId}`,
  });
  const api = await startApiServer({
    port: 0, servicesRoot, workspaceRoot,
    stagedServiceTransfer: {
      now: () => now,
      resolver: { resolve: async (input) => { resolutions += 1; return identityFor(input.targetServiceId); } },
      importer: {
        import: async (input) => {
          imports += 1;
          assert.deepEqual(input.readByteObject(), archive);
          return input.serviceId === "quarantined-http-service" ? "conflict" : input.serviceId === "unknown-http-service" ? "unknown" : "completed";
        },
        reconcile: async (input) => input.serviceId === "completed-http-service" ? "completed" : "unknown",
      },
    },
  });
  const createBody = (targetServiceId) => JSON.stringify({ targetServiceId, provenance: { repo: "service-lasso/lasso-example", releaseTag: "v1", commitSha }, platform: "win32", manifestSchemaVersion: "service-lasso.service-manifest/v1" });
  const create = async (targetServiceId) => {
    const response = await fetch(`${api.url}/api/v1/service-transfers`, { method: "POST", headers: { ...owner, "content-type": "application/json" }, body: createBody(targetServiceId) });
    assert.equal(response.status, 201);
    return await response.json();
  };
  const ready = async (targetServiceId) => {
    const stage = await create(targetServiceId);
    const upload = await fetch(`${api.url}/api/v1/service-transfers/${stage.stageId}/chunks/0`, { method: "PUT", headers: { ...owner, "content-type": "application/octet-stream", "x-service-transfer-token": stage.uploadToken, "x-chunk-sha256": digest, "content-range": `bytes 0-${archive.length - 1}/${archive.length}` }, body: archive });
    assert.equal(upload.status, 204);
    const finalized = await fetch(`${api.url}/api/v1/service-transfers/${stage.stageId}/finalize`, { method: "POST", headers: owner });
    assert.equal(finalized.status, 200);
    return stage;
  };
  const confirmation = async (stageId) => {
    const response = await fetch(`${api.url}/api/v1/service-transfers/${stageId}/confirmation`, { method: "POST", headers: owner });
    assert.equal(response.status, 200);
    return await response.json();
  };
  const register = async (stageId, confirmationId, idempotencyKey) => await fetch(`${api.url}/api/v1/service-transfers/${stageId}/registration`, { method: "POST", headers: { ...owner, "content-type": "application/json", "x-service-transfer-confirmation": confirmationId }, body: JSON.stringify({ idempotencyKey }) });
  try {
    const isolated = await create("isolated-http-service");
    const ownMissing = await fetch(`${api.url}/api/v1/service-transfers/stg_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`, { headers: secondOwner });
    const nonOwned = await fetch(`${api.url}/api/v1/service-transfers/${isolated.stageId}`, { headers: secondOwner });
    assert.equal(ownMissing.status, 404);
    assert.equal(nonOwned.status, 404);
    assert.deepEqual(await nonOwned.json(), await ownMissing.json(), "a second configured actor receives the same no-leak result");

    const resolutionBeforeDeniedBody = resolutions;
    const denied = await responseBeforeRequestBody(`${api.url}/api/v1/service-transfers`, {
      headers: { ...viewer, "content-type": "application/json", "content-length": "999" },
    });
    assert.equal(denied.status, 403);
    assert.equal(JSON.parse(denied.body).error, "permission_denied");
    assert.equal(resolutions, resolutionBeforeDeniedBody, "permission denial happens before body parsing or resolver mutation");

    const expiring = await ready("expired-http-service");
    const expiringConfirmation = await confirmation(expiring.stageId);
    now += 31 * 60_000;
    const expiredRegistration = await register(expiring.stageId, expiringConfirmation.confirmationId, "expired-http-idempotency-0001");
    assert.equal(expiredRegistration.status, 404);
    const expired = await fetch(`${api.url}/api/v1/service-transfers/${expiring.stageId}`, { headers: owner });
    assert.equal((await expired.json()).state, "expired");

    const rejected = await create("rejected-http-service");
    const rejectedUpload = await fetch(`${api.url}/api/v1/service-transfers/${rejected.stageId}/chunks/0`, { method: "PUT", headers: { ...owner, "content-type": "application/octet-stream", "x-service-transfer-token": rejected.uploadToken, "x-chunk-sha256": digest, "content-range": `bytes 0-${archive.length - 1}/${archive.length}` }, body: archive });
    assert.equal(rejectedUpload.status, 204);
    const rejectedFinalize = await fetch(`${api.url}/api/v1/service-transfers/${rejected.stageId}/finalize`, { method: "POST", headers: owner });
    assert.equal(rejectedFinalize.status, 409);
    const rejectedReadback = await fetch(`${api.url}/api/v1/service-transfers/${rejected.stageId}`, { headers: owner });
    assert.equal((await rejectedReadback.json()).state, "rejected");
    const rejectedConfirmation = await fetch(`${api.url}/api/v1/service-transfers/${rejected.stageId}/confirmation`, { method: "POST", headers: owner });
    assert.equal(rejectedConfirmation.status, 404);

    const terminalCases = [
      ["completed-http-service", "consumed", "completed-http-idempotency-0001"],
      ["quarantined-http-service", "quarantined", "quarantined-http-idempotency-0001"],
      ["unknown-http-service", "unknown", "unknown-http-idempotency-0001"],
    ];
    for (const [serviceId, terminalState, idempotencyKey] of terminalCases) {
      const stage = await ready(serviceId);
      const issued = await confirmation(stage.stageId);
      const first = await register(stage.stageId, issued.confirmationId, idempotencyKey);
      assert.equal(first.status, 202);
      const replay = await register(stage.stageId, issued.confirmationId, idempotencyKey);
      assert.equal(replay.status, 200, `${terminalState} registration replays without consuming a child again`);
      assert.equal((await replay.json()).replayed, true);
      const readback = await fetch(`${api.url}/api/v1/service-transfers/${stage.stageId}`, { headers: owner });
      const publicState = await readback.json();
      assert.equal(publicState.state, terminalState);
      assert.equal(JSON.stringify(publicState).includes(issued.confirmationId), false);
      assert.equal(JSON.stringify(publicState).includes(digest), false);
      const reissue = await fetch(`${api.url}/api/v1/service-transfers/${stage.stageId}/confirmation`, { method: "POST", headers: owner });
      assert.equal(reissue.status, 404, `${terminalState} cannot issue another confirmation`);
    }
    assert.equal(imports, 3, "only non-replayed terminal registrations invoke the direct child");
  } finally {
    await api.stop();
    await rm(tempRoot, { recursive: true, force: true });
    if (priorInstance === undefined) delete process.env.SERVICE_LASSO_INSTANCE_REGISTRY_PATH; else process.env.SERVICE_LASSO_INSTANCE_REGISTRY_PATH = priorInstance;
    if (priorHost === undefined) delete process.env.SERVICE_LASSO_HOST_PORT_REGISTRY_PATH; else process.env.SERVICE_LASSO_HOST_PORT_REGISTRY_PATH = priorHost;
  }
});
