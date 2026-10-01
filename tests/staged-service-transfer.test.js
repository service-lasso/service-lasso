import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { StagedServiceTransfer, TransferError } from "../dist/runtime/release/staged-service-transfer.js";

test("staged transfer stays fail closed when the owner catalog pin is unavailable", async () => { const root=await mkdtemp(path.join(os.tmpdir(),"staged-transfer-")); try { const service=new StagedServiceTransfer(root,{resolve:async()=>{throw new TransferError("release_provenance_unavailable",503)}},{import:async()=> "completed"}); await assert.rejects(service.create({id:"a",workspaceId:"w",canConfigure:true},{targetServiceId:"sample-service",provenance:{repo:"service-lasso/lasso-example",releaseTag:"v1",commitSha:"a".repeat(40)},platform:"win32",manifestSchemaVersion:"service-lasso.service-manifest/v1"}),/denied/); } finally {await rm(root,{recursive:true,force:true});} });

