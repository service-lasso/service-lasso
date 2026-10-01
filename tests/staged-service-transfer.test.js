import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { StagedServiceTransfer, TransferError } from "../dist/runtime/release/staged-service-transfer.js";

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

