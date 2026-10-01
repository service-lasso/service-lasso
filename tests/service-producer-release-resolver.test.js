import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ServiceProducerReleaseResolver } from "../dist/runtime/release/service-producer-release-resolver.js";

const sha = (value) => createHash("sha256").update(value).digest("hex");
const commit = "a".repeat(40);
const manifest = JSON.stringify({ id:"resolver-service", name:"Resolver", description:"fixture", executable:"node", args:["x"], healthcheck:{type:"process"}, artifact:{kind:"archive",source:{type:"github-release",repo:"service-lasso/resolver",tag:"v1"},platforms:{win32:{assetName:"resolver.zip",archiveType:"zip",command:"x",checksum:{algorithm:"sha256",value:"b".repeat(64)}}}}});

test("producer resolver uses bounded fixed API asset paths and requires an annotated tag", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "resolver-"));
  const policy = JSON.stringify({schema:"service-lasso.service-producer-release-policy/v1",serviceId:"resolver-service",release:{tag:"v1",targetSha:commit},manifest:{assetName:"service.json",sha256:sha(manifest)},platforms:{win32:{assetName:"resolver.zip",archiveType:"zip",sha256:"b".repeat(64),checksum:{assetName:"SHA256SUMS.txt",sha256:""}}}});
  const sums = `${"b".repeat(64)}  resolver.zip\n`;
  const fixed = JSON.stringify({...JSON.parse(policy), platforms:{win32:{...JSON.parse(policy).platforms.win32,checksum:{assetName:"SHA256SUMS.txt",sha256:sha(sums)}}}});
  const catalogPath = path.join(root, "catalog.json");
  await writeFile(catalogPath, JSON.stringify({version:1,pins:[{repo:"service-lasso/resolver",serviceId:"resolver-service",policySha256:sha(fixed),manifestSha256:sha(manifest)}]}));
  const original = globalThis.fetch; const seen=[];
  globalThis.fetch = async (input) => { const url=new URL(String(input)); seen.push(url.toString()); if(url.origin!=="https://api.github.com") return new Response("no",{status:404}); if(url.pathname==="/repos/service-lasso/resolver/releases/tags/v1") return new Response(JSON.stringify({id:1,tag_name:"v1",draft:false,prerelease:false,assets:[{id:2,name:"service-lasso-release-policy.json",size:Buffer.byteLength(fixed)},{id:3,name:"service.json",size:Buffer.byteLength(manifest)},{id:4,name:"resolver.zip",size:1},{id:5,name:"SHA256SUMS.txt",size:Buffer.byteLength(sums)}]})); if(url.pathname==="/repos/service-lasso/resolver/git/ref/tags/v1") return new Response(JSON.stringify({object:{type:"tag",sha:"c".repeat(40)}})); if(url.pathname===`/repos/service-lasso/resolver/git/tags/${"c".repeat(40)}`) return new Response(JSON.stringify({object:{type:"commit",sha:commit}})); if(url.pathname==="/repos/service-lasso/resolver/releases/assets/2") return new Response(fixed); if(url.pathname==="/repos/service-lasso/resolver/releases/assets/3") return new Response(manifest); if(url.pathname==="/repos/service-lasso/resolver/releases/assets/5") return new Response(sums); return new Response("no",{status:404}); };
  try { const resolved=await new ServiceProducerReleaseResolver(catalogPath).resolve({repo:"service-lasso/resolver",releaseTag:"v1",commitSha:commit,targetServiceId:"resolver-service",platform:"win32"}); assert.equal(resolved.assetId,"4"); assert.ok(seen.every((url)=>url.startsWith("https://api.github.com/"))); assert.ok(seen.includes("https://api.github.com/repos/service-lasso/resolver/releases/assets/2")); }
  finally {globalThis.fetch=original;await rm(root,{recursive:true,force:true});}
});
