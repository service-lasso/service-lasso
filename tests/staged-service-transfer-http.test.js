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

test("staged transfer HTTP route enforces closed credentials and drives an actor-scoped byte-bound registration", async () => {
  const { tempRoot, servicesRoot, workspaceRoot } = await makeTempServicesRoot("service-lasso-staged-http-");
  const previousInstanceRegistry = process.env.SERVICE_LASSO_INSTANCE_REGISTRY_PATH;
  const previousHostRegistry = process.env.SERVICE_LASSO_HOST_PORT_REGISTRY_PATH;
  process.env.SERVICE_LASSO_INSTANCE_REGISTRY_PATH = path.join(tempRoot, "instance-registry.json");
  process.env.SERVICE_LASSO_HOST_PORT_REGISTRY_PATH = path.join(tempRoot, "host-port-registry.json");
  const archive = Buffer.from(zipSync({ "release.txt": Buffer.from("staged fixture") }));
  const archiveSha256 = createHash("sha256").update(archive).digest("hex");
  const identity = {
    repo: "service-lasso/lasso-example", releaseTag: "v1", commitSha,
    targetServiceId: "staged-http-service", platform: "win32", archiveType: "zip",
    assetName: "staged.zip", assetId: "asset-1", archiveBytes: archive.length,
    archiveSha256, manifestSha256: "b".repeat(64), releaseId: "release-1",
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
