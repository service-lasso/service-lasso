import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { rm } from "node:fs/promises";
import path from "node:path";
import { zipSync } from "fflate";
import { startApiServer } from "../dist/server/index.js";
import { makeTempServicesRoot } from "./test-helpers.js";

const commitSha = "a".repeat(40);
const bearer = { authorization: "Bearer staged-http-test-token" };

function responseJson(response) {
  return response.json();
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
      headers: { ...bearer, "x-service-transfer-token": created.uploadToken, "x-chunk-sha256": archiveSha256, "content-range": `bytes 0-${archive.length - 1}/${archive.length}` },
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
