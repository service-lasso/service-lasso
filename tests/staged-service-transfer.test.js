import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { zipSync } from "fflate";
import { StagedServiceTransfer, TransferError } from "../dist/runtime/release/staged-service-transfer.js";
import { createStagedReleaseAssetImporter, readRemoteServiceRegistrationOperation } from "../dist/runtime/operator/remote-service-registration.js";

test("staged transfer stays fail closed when the owner catalog pin is unavailable", async () => { const root=await mkdtemp(path.join(os.tmpdir(),"staged-transfer-")); try { const service=new StagedServiceTransfer(root,{resolve:async()=>{throw new TransferError("release_provenance_unavailable",503)}},{import:async()=> "completed"}); await assert.rejects(service.create({id:"a",workspaceId:"w",canConfigure:true},{targetServiceId:"sample-service",provenance:{repo:"service-lasso/lasso-example",releaseTag:"v1",commitSha:"a".repeat(40)},platform:"win32",manifestSchemaVersion:"service-lasso.service-manifest/v1"}),/denied/); } finally {await rm(root,{recursive:true,force:true});} });

test("staged transfer migrates an unambiguous v3 sidecar and rejects a divergent retained copy", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "staged-migration-"));
  const operator = path.join(root, ".service-lasso", "operator");
  const identity = { repo:"service-lasso/lasso-example", releaseTag:"v1", commitSha:"a".repeat(40), targetServiceId:"sample-service", platform:"win32", archiveType:"zip", assetName:"sample.zip", assetId:"1", archiveBytes:1, archiveSha256:"b".repeat(64), manifestSha256:"c".repeat(64), releaseId:"2" };
  const actor = { id:"actor", workspaceId:"trusted-workspace", canConfigure:true };
  const input = { targetServiceId:"sample-service", provenance:{repo:identity.repo,releaseTag:identity.releaseTag,commitSha:identity.commitSha},platform:"win32",manifestSchemaVersion:"service-lasso.service-manifest/v1" };
  try {
    await mkdir(operator, { recursive:true });
    await writeFile(path.join(operator, "staged-service-transfers.json"), JSON.stringify({ version:3, stages:[], auditOutbox:[] }));
    const transfer = new StagedServiceTransfer(root, { resolve:async () => identity }, { import:async () => "completed" });
    const created = await transfer.create(actor, input);
    const unified = JSON.parse(await readFile(path.join(operator, "service-registration-operations.json"), "utf8"));
    assert.equal(unified.version, 1);
    assert.equal(unified.stagedTransfer.version, 3);
    assert.equal(unified.stagedTransfer.stages[0].id, created.stageId);
    await writeFile(path.join(operator, "staged-service-transfers.json"), JSON.stringify({ version:3, stages:[{ id:"contradiction" }], auditOutbox:[] }));
    await assert.rejects(() => transfer.status(actor, created.stageId), (error) => error instanceof TransferError && error.statusCode === 503);
  } finally { await rm(root, { recursive:true, force:true }); }
});

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

test("staged transfer keeps Linux TAR provenance eligible and makes a full digest mismatch terminal before parsing", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "staged-tar-digest-"));
  const bytes = Buffer.from("not-a-tar-but-never-parser-admitted", "utf8");
  const actualDigest = createHash("sha256").update(bytes).digest("hex");
  const identity = { repo:"service-lasso/lasso-example", releaseTag:"v1", commitSha:"a".repeat(40), targetServiceId:"sample-service", platform:"linux", archiveType:"tar.gz", assetName:"sample.tar.gz", assetId:"1", archiveBytes:bytes.length, archiveSha256:"d".repeat(64), manifestSha256:"c".repeat(64), releaseId:"2" };
  const transfer = new StagedServiceTransfer(root, { resolve: async () => identity }, { import: async () => "completed" });
  const actor = { id:"actor", workspaceId:"trusted-workspace", canConfigure:true };
  const input = { targetServiceId:"sample-service", provenance:{repo:identity.repo,releaseTag:identity.releaseTag,commitSha:identity.commitSha},platform:"linux",manifestSchemaVersion:"service-lasso.service-manifest/v1" };
  try {
    const stage = await transfer.create(actor, input);
    await transfer.upload(actor, stage.stageId, 0, stage.uploadToken, actualDigest, bytes, { start: 0, end: bytes.length - 1, total: bytes.length });
    await assert.rejects(() => transfer.finalize(actor, stage.stageId), (error) => error instanceof TransferError && error.code === "digest_mismatch");
    assert.equal((await transfer.status(actor, stage.stageId)).state, "rejected");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("staged transfer keeps a correctly digested TAR asset fail closed until T1--T5 enablement", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "staged-tar-disabled-"));
  const bytes = Buffer.from("not-a-tar-but-the-gate-precedes-parser-admission", "utf8");
  const digest = createHash("sha256").update(bytes).digest("hex");
  const identity = { repo:"service-lasso/lasso-example", releaseTag:"v1", commitSha:"a".repeat(40), targetServiceId:"sample-service", platform:"linux", archiveType:"tar.gz", assetName:"sample.tar.gz", assetId:"1", archiveBytes:bytes.length, archiveSha256:digest, manifestSha256:"c".repeat(64), releaseId:"2" };
  const transfer = new StagedServiceTransfer(root, { resolve: async () => identity }, { import: async () => "completed" });
  const actor = { id:"actor", workspaceId:"trusted-workspace", canConfigure:true };
  const input = { targetServiceId:"sample-service", provenance:{repo:identity.repo,releaseTag:identity.releaseTag,commitSha:identity.commitSha},platform:"linux",manifestSchemaVersion:"service-lasso.service-manifest/v1" };
  try {
    const stage = await transfer.create(actor, input);
    await transfer.upload(actor, stage.stageId, 0, stage.uploadToken, digest, bytes, { start: 0, end: bytes.length - 1, total: bytes.length });
    await assert.rejects(() => transfer.finalize(actor, stage.stageId), (error) => error instanceof TransferError && error.code === "archive_unsafe");
    assert.equal((await transfer.status(actor, stage.stageId)).state, "rejected");
  } finally { await rm(root, { recursive:true, force:true }); }
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
    let byteObjectReads = 0;
    const result = await createStagedReleaseAssetImporter({ servicesRoot }).import({
      serviceId: "staged-service", readByteObject: (() => { let read = false; return () => { if (read) return null; read = true; byteObjectReads += 1; return Buffer.from(archiveBytes); }; })(), byteObjectId: "sbo_test", byteLength: archiveBytes.length, archiveSha256: archiveDigest,
      manifestSha256: manifestDigest, releaseId: "1", targetSha: "a".repeat(40), workspaceId: "trusted-workspace", actorId: "trusted-actor", stageId: "stg_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", operationId: "sro_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      repo: "service-lasso/lasso-node", releaseTag: "v1", assetId: "asset-1", assetName: "staged.zip", archiveType: "zip", manifestAssetId: "manifest-1", checksumAssetId: "checksum-1", manifestBytes: Buffer.from(manifest, "utf8"),
    });
    assert.equal(result, "completed");
    assert.equal(byteObjectReads, 1, "the child must consume the held archive exactly once");
    assert.equal(await readFile(path.join(servicesRoot, "staged-service", "service.json"), "utf8"), manifest);
    const attachment = JSON.parse(await readFile(path.join(servicesRoot, "staged-service", ".service-lasso", "staged-release-input.json"), "utf8"));
    assert.deepEqual(attachment, {
      schema: "service-lasso.staged-release-input/v1", operationId: "sro_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", stageId: "stg_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", actorId: "trusted-actor", workspaceId: "trusted-workspace", targetServiceId: "staged-service",
      byteObject: { id: "sbo_test", length: archiveBytes.length, sha256: archiveDigest },
      release: { id: "1", repo: "service-lasso/lasso-node", tag: "v1", targetSha: "a".repeat(40), assetId: "asset-1", assetName: "staged.zip", archiveType: "zip", manifestAssetId: "manifest-1", checksumAssetId: "checksum-1", manifestSha256: manifestDigest },
    });
    const recovered = await createStagedReleaseAssetImporter({ servicesRoot }).reconcile({
      serviceId: "staged-service", byteObjectId: "sbo_test", byteLength: archiveBytes.length, archiveSha256: archiveDigest,
      manifestSha256: manifestDigest, releaseId: "1", targetSha: "a".repeat(40), workspaceId: "trusted-workspace", actorId: "trusted-actor", stageId: "stg_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", operationId: "sro_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      repo: "service-lasso/lasso-node", releaseTag: "v1", assetId: "asset-1", assetName: "staged.zip", archiveType: "zip", manifestAssetId: "manifest-1", checksumAssetId: "checksum-1", manifestBytes: Buffer.from(manifest, "utf8"),
    });
    assert.equal(recovered, "completed", "recovery must read back the full durable direct-child binding");
    const contradictory = await createStagedReleaseAssetImporter({ servicesRoot }).reconcile({
      serviceId: "staged-service", byteObjectId: "sbo_test", byteLength: archiveBytes.length, archiveSha256: archiveDigest,
      manifestSha256: manifestDigest, releaseId: "1", targetSha: "a".repeat(40), workspaceId: "other-workspace", actorId: "trusted-actor", stageId: "stg_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", operationId: "sro_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      repo: "service-lasso/lasso-node", releaseTag: "v1", assetId: "asset-1", assetName: "staged.zip", archiveType: "zip", manifestAssetId: "manifest-1", checksumAssetId: "checksum-1", manifestBytes: Buffer.from(manifest, "utf8"),
    });
    assert.equal(contradictory, "conflict", "workspace binding cannot be reinterpreted during recovery");
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
    const stored = JSON.parse(await readFile(path.join(root, ".service-lasso", "operator", "service-registration-operations.json"), "utf8"));
    assert.equal(stored.version, 1);
    const stage = stored.stagedTransfer.stages[0];
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
    const readback = await readRemoteServiceRegistrationOperation({ workspaceRoot: root, actor: { id: actor.id }, operationId: first.operation.id });
    assert.equal(readback.status, "completed");
    assert.equal(readback.sourceCommit, identity.commitSha);
    const replay = await transfer.register(actor, stage.stageId, confirmation.confirmationId, "staged-journal-0001");
    assert.equal(replay.replayed, true);
    assert.equal(imports, 1);
  } finally { await rm(root, { recursive:true, force:true }); }
});

test("a restart reconciles a claimed unknown direct-child outcome without reimporting or reacquiring bytes", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "staged-claimed-recovery-"));
  const bytes = Buffer.from(zipSync({ "release.txt": Buffer.from("fixture") }));
  const digest = createHash("sha256").update(bytes).digest("hex");
  const manifest = Buffer.from(JSON.stringify({ id:"sample-service" }), "utf8");
  const identity = { repo:"service-lasso/lasso-example", releaseTag:"v1", commitSha:"a".repeat(40), targetServiceId:"sample-service", platform:"win32", archiveType:"zip", assetName:"sample.zip", assetId:"1", archiveBytes:bytes.length, archiveSha256:digest, manifestSha256:createHash("sha256").update(manifest).digest("hex"), releaseId:"2", manifestBytes:manifest.toString("base64") };
  const actor = { id:"actor", workspaceId:"trusted-workspace", canConfigure:true };
  const input = { targetServiceId:"sample-service", provenance:{repo:identity.repo,releaseTag:identity.releaseTag,commitSha:identity.commitSha},platform:"win32",manifestSchemaVersion:"service-lasso.service-manifest/v1" };
  let imports = 0, reconciles = 0;
  try {
    const first = new StagedServiceTransfer(root, { resolve:async () => identity }, { import:async () => { imports += 1; return "unknown"; } });
    const stage = await first.create(actor, input);
    await first.upload(actor, stage.stageId, 0, stage.uploadToken, digest, bytes, { start:0, end:bytes.length - 1, total:bytes.length });
    await first.finalize(actor, stage.stageId);
    const confirmation = await first.confirmation(actor, stage.stageId);
    const original = await first.register(actor, stage.stageId, confirmation.confirmationId, "claimed-recovery-0001");
    assert.equal(original.status, "unknown");
    const statePath = path.join(root, ".service-lasso", "operator", "service-registration-operations.json");
    const state = JSON.parse(await readFile(statePath, "utf8"));
    state.stagedTransfer.stages[0].state = "claimed";
    await writeFile(statePath, JSON.stringify(state));
    const restarted = new StagedServiceTransfer(root, { resolve:async () => { throw new Error("replay must not resolve"); } }, {
      import:async () => { throw new Error("recovery must not import again"); },
      reconcile:async () => { reconciles += 1; return "completed"; },
    });
    const replay = await restarted.register(actor, stage.stageId, confirmation.confirmationId, "claimed-recovery-0001");
    assert.equal(replay.replayed, true);
    assert.equal(replay.status, "consumed");
    assert.equal(imports, 1);
    assert.equal(reconciles, 1);
  } finally { await rm(root, { recursive:true, force:true }); }
});

