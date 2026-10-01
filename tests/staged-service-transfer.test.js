import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { zipSync } from "fflate";
import { StagedServiceTransfer, TransferError } from "../dist/runtime/release/staged-service-transfer.js";
import { createStagedReleaseAssetImporter } from "../dist/runtime/operator/remote-service-registration.js";

test("staged transfer stays fail closed when the owner catalog pin is unavailable", async () => { const root=await mkdtemp(path.join(os.tmpdir(),"staged-transfer-")); try { const service=new StagedServiceTransfer(root,{resolve:async()=>{throw new TransferError("release_provenance_unavailable",503)}},{import:async()=> "completed"}); await assert.rejects(service.create({id:"a",workspaceId:"w",canConfigure:true},{targetServiceId:"sample-service",provenance:{repo:"service-lasso/lasso-example",releaseTag:"v1",commitSha:"a".repeat(40)},platform:"win32",manifestSchemaVersion:"service-lasso.service-manifest/v1"}),/denied/); } finally {await rm(root,{recursive:true,force:true});} });

test("staged transfer reserves actor and workspace capacity, binds exact chunk ranges, and expires before reuse", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "staged-transfer-"));
  let clock = 1000;
  const digest = "b".repeat(64);
  const identity = { repo:"service-lasso/lasso-example", releaseTag:"v1", commitSha:"a".repeat(40), targetServiceId:"sample-service", platform:"win32", archiveType:"zip", assetName:"sample.zip", assetId:"1", archiveBytes:262144, archiveSha256:digest, manifestSha256:"c".repeat(64), releaseId:"2" };
  const transfer = new StagedServiceTransfer(root, { resolve: async () => identity }, { import: async () => "completed" }, () => clock);
  const actor = { id:"actor", workspaceId:"trusted-workspace", canConfigure:true };
  const input = { targetServiceId:"sample-service", provenance:{repo:identity.repo,releaseTag:"v1",commitSha:"a".repeat(40)},platform:"win32",manifestSchemaVersion:"service-lasso.service-manifest/v1" };
  try {
    const first = await transfer.create(actor, input);
    const bytes = Buffer.alloc(262144, 7);
    await assert.rejects(() => transfer.upload(actor, first.stageId, 0, first.uploadToken, createHash("sha256").update(bytes).digest("hex"), bytes, {start:1,end:262144,total:262144}), /denied/);
    await transfer.upload(actor, first.stageId, 0, first.uploadToken, createHash("sha256").update(bytes).digest("hex"), bytes, {start:0,end:262143,total:262144});
    await transfer.upload(actor, first.stageId, 0, first.uploadToken, createHash("sha256").update(bytes).digest("hex"), bytes, {start:0,end:262143,total:262144});
    for (let index = 1; index < 8; index += 1) await transfer.create(actor, input);
    await assert.rejects(() => transfer.create(actor, input), /denied/);
    // Expiry does not silently free capacity: retained terminal records are
    // quarantined from allocation until their documented metadata retention.
    clock += 24 * 60 * 60_000 + 31 * 60_000;
    const replacement = await transfer.create(actor, input);
    assert.equal(replacement.state, "uploading");
    assert.equal((await transfer.status(actor, first.stageId)).state, "cleaned");
  } finally { await rm(root,{recursive:true,force:true}); }
});

test("staged direct-child importer registers the canonical manifest without downloading or extracting the archive", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "staged-direct-child-"));
  const servicesRoot = path.join(root, "services");
  const archiveBytes = Buffer.from("claimed-release-asset", "utf8");
  const manifest = JSON.stringify({
    id: "staged-service",
    name: "Staged Service",
    description: "fixture",
    executable: "node",
    args: ["fixture.js"],
    healthcheck: { type: "process" },
    artifact: {
      kind: "archive",
      source: { type: "github-release", repo: "service-lasso/lasso-node", tag: "v1" },
      platforms: { win32: { assetName: "staged.zip", archiveType: "zip", command: "fixture.js", checksum: { algorithm: "sha256", value: "b".repeat(64) } } },
    },
  });
  const priorFetch = globalThis.fetch;
  const archiveDigest = createHash("sha256").update(archiveBytes).digest("hex");
  const manifestDigest = createHash("sha256").update(manifest).digest("hex");
  const requests = [];
  globalThis.fetch = async (url) => {
    requests.push(String(url));
    if (String(url).includes("/git/ref/tags/v1")) return new Response(JSON.stringify({ object: { type: "commit", sha: "a".repeat(40) } }));
    if (String(url).includes("/releases/tags/v1")) return new Response(JSON.stringify({ tag_name: "v1", assets: [{ name: "service.json", browser_download_url: "https://github.com/service-lasso/lasso-node/releases/download/v1/service.json" }] }));
    if (String(url).endsWith("/service.json")) return new Response(manifest);
    throw new Error(`unexpected release request: ${url}`);
  };
  try {
    const result = await createStagedReleaseAssetImporter({ servicesRoot }).import({
      serviceId: "staged-service", bytes: archiveBytes, byteObjectId: "sbo_test", archiveSha256: archiveDigest,
      manifestSha256: manifestDigest, releaseId: "1", targetSha: "a".repeat(40), workspaceId: "trusted-workspace",
      repo: "service-lasso/lasso-node", releaseTag: "v1", manifestBytes: Buffer.from(manifest, "utf8"),
    });
    assert.equal(result, "completed");
    assert.equal(await readFile(path.join(servicesRoot, "staged-service", "service.json"), "utf8"), manifest);
    assert.equal(requests.some((url) => url.includes("staged.zip")), false);
  } finally {
    globalThis.fetch = priorFetch;
    await rm(root, { recursive: true, force: true });
  }
});

test("staged registration replays before resolver or confirmation access", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "staged-replay-"));
  const bytes = Buffer.from(zipSync({ "release.txt": Buffer.from("fixture") }));
  const digest = createHash("sha256").update(bytes).digest("hex");
  let resolutions = 0;
  const identity = { repo:"service-lasso/lasso-example", releaseTag:"v1", commitSha:"a".repeat(40), targetServiceId:"sample-service", platform:"win32", archiveType:"zip", assetName:"sample.zip", assetId:"1", archiveBytes:bytes.length, archiveSha256:digest, manifestSha256:"c".repeat(64), releaseId:"2" };
  const transfer = new StagedServiceTransfer(root, { resolve: async () => { resolutions += 1; return identity; } }, { import: async () => "completed" });
  const actor = { id:"actor", workspaceId:"trusted-workspace", canConfigure:true };
  const input = { targetServiceId:"sample-service", provenance:{repo:identity.repo,releaseTag:identity.releaseTag,commitSha:identity.commitSha},platform:"win32",manifestSchemaVersion:"service-lasso.service-manifest/v1" };
  try {
    const stage = await transfer.create(actor, input);
    await transfer.upload(actor, stage.stageId, 0, stage.uploadToken, digest, bytes, { start: 0, end: bytes.length - 1, total: bytes.length });
    await transfer.finalize(actor, stage.stageId);
    const confirmation = await transfer.confirmation(actor, stage.stageId);
    const first = await transfer.register(actor, stage.stageId, confirmation.confirmationId, "staged-replay-0001");
    assert.equal(first.replayed, false);
    const beforeReplay = resolutions;
    const replay = await transfer.register(actor, stage.stageId, confirmation.confirmationId, "staged-replay-0001");
    assert.equal(replay.replayed, true);
    assert.equal(resolutions, beforeReplay);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("staged registration persists its full prepared claim before the direct child is invoked", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "staged-journal-"));
  const bytes = Buffer.from(zipSync({ "release.txt": Buffer.from("fixture") }));
  const digest = createHash("sha256").update(bytes).digest("hex");
  const identity = { repo:"service-lasso/lasso-example", releaseTag:"v1", commitSha:"a".repeat(40), targetServiceId:"sample-service", platform:"win32", archiveType:"zip", assetName:"sample.zip", assetId:"1", archiveBytes:bytes.length, archiveSha256:digest, manifestSha256:"c".repeat(64), releaseId:"2" };
  const actor = { id:"actor", workspaceId:"trusted-workspace", canConfigure:true };
  let imports = 0;
  const transfer = new StagedServiceTransfer(root, { resolve: async () => identity }, { import: async () => {
    imports += 1;
    const stored = JSON.parse(await readFile(path.join(root, ".service-lasso", "operator", "staged-service-transfers.json"), "utf8"));
    const stage = stored.stages[0];
    assert.equal(stage.state, "claimed");
    assert.equal(stage.operation.state, "unknown");
    assert.equal(stage.journal.phase, "claimed");
    assert.equal(stage.journal.workspaceId, actor.workspaceId);
    assert.equal(stage.journal.byteLength, bytes.length);
    assert.equal(stage.journal.fullDigest, digest);
    return "completed";
  }});
  const input = { targetServiceId:"sample-service", provenance:{repo:identity.repo,releaseTag:identity.releaseTag,commitSha:identity.commitSha},platform:"win32",manifestSchemaVersion:"service-lasso.service-manifest/v1" };
  try {
    const stage = await transfer.create(actor, input);
    await transfer.upload(actor, stage.stageId, 0, stage.uploadToken, digest, bytes, { start: 0, end: bytes.length - 1, total: bytes.length });
    await transfer.finalize(actor, stage.stageId);
    const confirmation = await transfer.confirmation(actor, stage.stageId);
    const first = await transfer.register(actor, stage.stageId, confirmation.confirmationId, "staged-journal-0001");
    assert.equal(first.status, "consumed");
    const replay = await transfer.register(actor, stage.stageId, confirmation.confirmationId, "staged-journal-0001");
    assert.equal(replay.replayed, true);
    assert.equal(imports, 1);
  } finally { await rm(root, { recursive:true, force:true }); }
});

