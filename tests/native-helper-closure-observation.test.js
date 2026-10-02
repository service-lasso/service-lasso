import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import { capture } from "../scripts/native-tool-journal-v4-lib.mjs";
// #1610 / SPEC-003 BR-008 / SPEC-006 AC-6G.native-boundary-observation.
// Source-authored contract fixtures only; UNEXECUTED, no native acceptance.
const prefix = "[native-helper-closure-observation] ";
const decode = line => JSON.parse(line.slice(prefix.length));
function fixture({ exitCode = 0, signal = null, stdoutEof = true, stderrEof = true, error } = {}) {
  return (executable, args, options) => {
    assert.equal(executable, "private-path"); assert.deepEqual(args, ["private-script"]);
    assert.deepEqual(options, { shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.pid = 42;
    queueMicrotask(() => {
      if (error !== undefined) { child.emit("error", error); return; }
      child.stdout.emit("data", Buffer.from(JSON.stringify({self:{pid:42,chain:[{pid:42,private:"private-value"}]}})));
      child.stderr.emit("data", Buffer.from("private-stderr"));
      if (stdoutEof) child.stdout.emit("end"); if (stderrEof) child.stderr.emit("end");
      child.emit("close", exitCode, signal);
    });
    return child;
  };
}
function run(options, report) { return capture("private-path", ["private-script"], fixture(options), report); }
test("complete original capture returns original bytes, identity and closure silently", async () => {
  const lines=[]; const result=await run({}, line=>lines.push(line));
  assert.deepEqual(lines,[]); assert.equal(result.exitCode,0); assert.equal(result.signal,null);
  assert.equal(result.stdoutEof,true); assert.equal(result.stderrEof,true);
  assert.equal(result.spawnedPid,42); assert.deepEqual(result.selfIdentity,{pid:42,private:"private-value"});
  assert.equal(result.stderr.toString(),"private-stderr"); assert.match(result.stdoutSha256,/^[a-f0-9]{64}$/u);
});
test("each first reached incomplete predicate retains original refusal and finite private-free record", async () => {
  for(const [options,reason] of [
    [{exitCode:1,signal:"private-signal",stdoutEof:false,stderrEof:false},"exit_nonzero"],
    [{signal:"private-signal",stdoutEof:false,stderrEof:false},"signal_present"],
    [{stdoutEof:false,stderrEof:false},"stdout_eof_missing"],
    [{stderrEof:false},"stderr_eof_missing"],
  ]) {
    const lines=[]; await assert.rejects(run(options,line=>lines.push(line)),/first_custody_native_helper_incomplete/u);
    assert.equal(lines.length,1); assert.deepEqual(decode(lines[0]),{schema:"service-lasso.native-helper-closure-observation.v1",observationStatus:"captured",reason});
    assert.equal(lines[0].includes("private"),false); assert.ok(lines[0].length<250);
  }
});
test("closure comparison never coerces private exit or signal values", async () => {
  let traps=0; const hostile=new Proxy({}, {get(){traps++;throw new Error("inspection");},ownKeys(){traps++;throw new Error("inspection");}});
  for(const options of [{exitCode:hostile,signal:hostile},{signal:hostile}]) {
    const lines=[]; await assert.rejects(run(options,line=>lines.push(line)),/first_custody_native_helper_incomplete/u);
    assert.equal(lines.length,1); assert.equal(lines[0].includes("private"),false);
  }
  assert.equal(traps,0);
});
test("acquisition errors stay identical with zero hostile exception inspection and unavailable observation", async () => {
  let traps=0;const primary=new Proxy({}, {get(){traps++;throw 17;},ownKeys(){traps++;throw 18;}});
  for(const spawnHelper of [()=>{throw primary;},fixture({error:primary})]) {
    const lines=[];
    let caught=false; try { await capture("private-path",["private-script"],spawnHelper,line=>lines.push(line)); } catch(error) { caught=true; assert.equal(error,primary); } assert.equal(caught,true);
    assert.deepEqual(decode(lines[0]),{schema:"service-lasso.native-helper-closure-observation.v1",observationStatus:"unavailable",reason:"unavailable"});
  }
  assert.equal(traps,0);
});
test("observer throw or hostile then return never replaces or assimilates original acquisition value", async () => {
  const primary={}; let traps=0;const hostile=new Proxy({}, {get(){traps++;throw 19;}});
  for(const report of [()=>{throw hostile;},()=>hostile]) {
    let caught=false; try { await capture("private-path",[],()=>{throw primary;},report); } catch(error) { caught=true; assert.equal(error,primary); } assert.equal(caught,true);
  }
  assert.equal(traps,0);
  await assert.rejects(run({stderrEof:false},()=>{throw hostile;}),/first_custody_native_helper_incomplete/u);
  assert.equal(traps,0);
});