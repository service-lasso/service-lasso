import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { zipSync } from "fflate";
import { claimProofRoot } from "./newcomer-proof.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function verifyPairIsolation(a, b) {
  assert.ok(a.commit && a.commit === b.commit, "Pair must use the same exact candidate");
  for (const field of ["servicesRoot", "workspaceRoot", "corePid", "runtimeUrl", "adminUrl", "appUrl", "appCoreUrl"]) {
    assert.ok(a[field] && b[field] && a[field] !== b[field], `Pair must have distinct ${field}`);
  }
  assert.ok(a.end < b.start || b.end < a.start, "Pair lease ranges must not overlap");
}

async function observe(identity) {
  const service = async (url, id) => {
    const response = await fetch(`${url}/api/services/${encodeURIComponent(id)}`, { signal: AbortSignal.timeout(10000) });
    assert.equal(response.status, 200);
    const lifecycle = (await response.json()).service.lifecycle;
    assert.equal(lifecycle.running, true);
    assert.ok(Number.isInteger(lifecycle.runtime.pid) && lifecycle.runtime.pid > 0);
    return lifecycle.runtime.pid;
  };
  const pids = {
    echo: await service(identity.runtimeUrl, "echo-service"),
    admin: await service(identity.runtimeUrl, "@serviceadmin"),
    database: await service(identity.appCoreUrl, "postgres"),
  };
  for (const url of [identity.adminUrl, identity.appUrl]) {
    assert.equal((await fetch(url, { signal: AbortSignal.timeout(10000) })).status, 200);
  }
  return pids;
}

function launch(side, root, issue) {
  const child = fork(path.join(repoRoot, "scripts/newcomer-proof.mjs"), [`--proof-id=${side}`, `--proof-root=${path.join(root, side)}`, `--issue=${issue}`, "--pair-child"], { cwd: repoRoot, windowsHide: true, silent: true });
  let output = "";
  child.stdout.on("data", data => { output += data; });
  child.stderr.on("data", data => { output += data; });
  let readyResolve, readyReject;
  const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  // Both promises get rejection handlers immediately, including when sibling
  // provisioning fails before this lane reaches its browser checkpoint.
  void ready.catch(() => undefined);
  child.on("message", message => { if (message?.stage === "browser-complete") readyResolve(message.identity); });
  child.on("error", readyReject);
  const closed = new Promise(resolve => child.once("close", (code, signal) => {
    readyReject(new Error(`Pair child ${side} exited before its checkpoint`));
    resolve({ code, signal });
  }));
  return { child, ready, closed, release() { if (child.connected) child.send({ stage: "allow-cleanup" }); }, output: () => output };
}

async function main() {
  const args = process.argv.slice(2);
  const rootArg = args.find(arg => arg.startsWith("--proof-root="))?.slice(13);
  if (!rootArg) throw new Error("Specify --proof-root=<new-pair-folder>.");
  const root = path.resolve(rootArg);
  const issue = args.find(arg => arg.startsWith("--issue="))?.slice(8) ?? "1328";
  await claimProofRoot(root);
  const receipt = { schema: "service-lasso.newcomer-pair.v1", startedAt: new Date().toISOString(), status: "Invalidated", issue };
  const a = launch("a", root, issue), b = launch("b", root, issue);
  let timer;
  try {
    const [ai, bi] = await Promise.race([Promise.all([a.ready, b.ready]), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Pair browser checkpoint timeout")), 35 * 60_000); })]);
    clearTimeout(timer);
    verifyPairIsolation(ai, bi);
    const beforeA = await observe(ai), beforeB = await observe(bi);
    assert.equal(new Set([...Object.values(beforeA), ...Object.values(beforeB)]).size, 6, "Pair must own distinct service processes");
    receipt.candidate = ai.commit;
    receipt.overlap = { observedAt: new Date().toISOString(), a: beforeA, b: beforeB, distinctRootsAndLeases: true };
    a.release();
    await a.closed;
    const ar = JSON.parse(await readFile(path.join(root, "a/bundle/receipt.json"), "utf8"));
    assert.equal(ar.cleanup?.status, "Verified");
    assert.equal(ar.appCleanup?.status, "Verified");
    assert.deepEqual(await observe(bi), beforeB, "A cleanup must preserve B process ownership and HTTP health");
    receipt.cleanupIsolation = { status: "Verified", observedAt: new Date().toISOString() };
    b.release();
    await b.closed;
    const br = JSON.parse(await readFile(path.join(root, "b/bundle/receipt.json"), "utf8"));
    for (const childReceipt of [ar, br]) {
      assert.equal(childReceipt.checks.playwright, "Verified");
      assert.equal(childReceipt.cleanup?.status, "Verified");
      assert.equal(childReceipt.appCleanup?.status, "Verified");
      assert.equal(childReceipt.status, "Blocked");
      assert.deepEqual(childReceipt.coverage.outstanding, ["simultaneous independent folders"]);
    }
    receipt.status = "Verified";
    receipt.note = "Child receipts retain their single-run limitation; this paired observation proves the remaining simultaneous-folder requirement.";
  } catch (error) {
    await writeFile(path.join(root, "private-pair-failure.json"), JSON.stringify({ message: String(error) }));
    receipt.failure = "Pair qualification failed; inspect private diagnostics locally.";
  } finally {
    clearTimeout(timer);
    a.release(); b.release();
    await Promise.all([a.closed, b.closed]);
    await writeFile(path.join(root, "private-child-output.json"), JSON.stringify({ a: a.output(), b: b.output() }));
    receipt.finishedAt = new Date().toISOString();
    await writeFile(path.join(root, "pair-receipt.json"), JSON.stringify(receipt, null, 2));
    const entries = { "pair-receipt.json": new Uint8Array(await readFile(path.join(root, "pair-receipt.json"))) };
    for (const side of ["a", "b"]) {
      try { entries[`${side}.zip`] = new Uint8Array(await readFile(path.join(root, side, `${side}.zip`))); } catch {}
    }
    const zip = zipSync(entries);
    await writeFile(path.join(root, "newcomer-pair.zip"), zip);
    console.log(JSON.stringify({ status: receipt.status, sha256: createHash("sha256").update(zip).digest("hex") }));
    if (receipt.status !== "Verified") process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
