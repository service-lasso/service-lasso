import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile, rename, rm, chmod } from "node:fs/promises";
import path from "node:path";
import { createDisposableTestFixture, removeDisposableTestFixture } from "./disposable-test-fixture.js";

test("OTF-1 ordinary teardown accepts only its actual creator token and exact root",async()=>{
 const a=await createDisposableTestFixture("owned-fixture-a-");const b=await createDisposableTestFixture("owned-fixture-b-");
 try {
  await writeFile(path.join(a.root,"original"),"synthetic-a");await writeFile(path.join(b.root,"original"),"synthetic-b");
  await assert.rejects(removeDisposableTestFixture({},a.root),/not owned/);
  await assert.rejects(removeDisposableTestFixture(a.token,b.root),/not owned/);
  assert.equal(await readFile(path.join(b.root,"original"),"utf8"),"synthetic-b");
  await removeDisposableTestFixture(a.token,a.root);await assert.rejects(readFile(path.join(a.root,"original")),{code:"ENOENT"});
  await assert.rejects(removeDisposableTestFixture(a.token,a.root),/not owned/);
 }finally{await rm(a.root,{recursive:true,force:true});await rm(b.root,{recursive:true,force:true});}
});

test("OTF-3 changed original root cannot redirect disposable teardown",async()=>{
 const fixture=await createDisposableTestFixture("owned-fixture-replaced-");const moved=fixture.root+"-original";
 try {
  await writeFile(path.join(fixture.root,"original"),"synthetic-original");await rename(fixture.root,moved);await mkdir(fixture.root,{mode:0o700});
  await writeFile(path.join(fixture.root,"foreign"),"synthetic-foreign");
  await assert.rejects(removeDisposableTestFixture(fixture.token,fixture.root),/identity changed/);
  assert.equal(await readFile(path.join(fixture.root,"foreign"),"utf8"),"synthetic-foreign");assert.equal(await readFile(path.join(moved,"original"),"utf8"),"synthetic-original");
 }finally{await rm(fixture.root,{recursive:true,force:true});await rm(moved,{recursive:true,force:true});}
});

test("OTF-3 non-private disposable root refuses ordinary teardown",{skip:process.platform==="win32"},async()=>{
 const fixture=await createDisposableTestFixture("owned-fixture-permissions-");
 try {await chmod(fixture.root,0o755);await assert.rejects(removeDisposableTestFixture(fixture.token,fixture.root),/not private/);await chmod(fixture.root,0o700);await removeDisposableTestFixture(fixture.token,fixture.root);}
 finally{await rm(fixture.root,{recursive:true,force:true});}
});
