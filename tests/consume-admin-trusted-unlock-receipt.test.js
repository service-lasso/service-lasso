import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { classify, parseReceipt } from "../scripts/consume-admin-trusted-unlock-receipt.mjs";

const valid = JSON.stringify({ schema: "service-admin.trusted-unlock-receipt.v1", status: "observed", present: true, verified: false, localRoot: false, loading: true, unavailable: false });

test("AC-4BY.2 parses an exact primitive receipt before duplicate JSON members can collapse", () => {
  assert.equal(parseReceipt(valid)?.loading, true);
  assert.equal(parseReceipt(valid.replace('"status"', '"\\u0073chema"')), null);
  assert.equal(parseReceipt(`${valid.slice(0, -1)},"private":false}`), null);
  assert.equal(parseReceipt('{"schema":"x","status":"observed","present":true,"verified":false,"localRoot":false,"loading":true,"unavailable":false,"extra":false}'), null);
  assert.equal(parseReceipt({ get schema() { throw new Error("must not access getter"); } }), null);
  assert.deepEqual(classify([]), { classification: "missing" });
});

test("AC-4BY.2 retains no child output and preserves the original nonzero exit", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "admin-receipt-"));
  try {
    const consumer = fileURLToPath(new URL("../scripts/consume-admin-trusted-unlock-receipt.mjs", import.meta.url));
    const run = async (body) => {
      const fixture = path.join(root, `${Math.random()}.mjs`), output = path.join(root, `${Math.random()}.json`);
      await writeFile(fixture, body);
      const child = spawn(process.execPath, [consumer, "--receipt", output, "--", process.execPath, fixture], { stdio: "ignore" });
      const result = await new Promise((resolve, reject) => { child.once("error", reject); child.once("close", (code, signal) => resolve({ code, signal })); });
      return { result, receipt: JSON.parse(await readFile(output, "utf8")) };
    };
    const closed = await run(`process.stdout.write("secret stdout\\n"); process.stderr.write(${JSON.stringify(`${valid}\r\n`)}, () => process.exit(7));`);
    assert.equal(closed.result.code, 7);
    assert.deepEqual(closed.receipt, { schema: "service-lasso.admin-trusted-unlock-consumer.v1", outcome: "nonzero_exit", exitCode: 7, signal: null, trustedUnlock: { classification: "closed", receipt: JSON.parse(valid) } });
    assert.doesNotMatch(JSON.stringify(closed.receipt), /secret stdout/);
    for (const source of ["", `${valid}{\n`, `${valid.slice(0, -1)},"private":true}\n`, `${valid.replace('"loading":true', '"loading":true,"loading":false')}\n`, `${valid.replace('"status"', '"\\u0073chema"')}\n`]) {
      const outcome = await run(`process.stderr.write(${JSON.stringify(source)}, () => process.exit(7));`);
      assert.deepEqual(outcome.receipt.trustedUnlock, { classification: source ? "invalid" : "missing" });
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("AC-4BY.2 keeps UTF-8 and CRLF receipt framing across arbitrary chunks while bounding a schema flood", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "admin-receipt-"));
  try {
    const consumer = fileURLToPath(new URL("../scripts/consume-admin-trusted-unlock-receipt.mjs", import.meta.url));
    const run = async (source) => {
      const fixture = path.join(root, `${Math.random()}.mjs`), output = path.join(root, `${Math.random()}.json`);
      await writeFile(fixture, source);
      const child = spawn(process.execPath, [consumer, "--receipt", output, "--", process.execPath, fixture], { stdio: "ignore" });
      const result = await new Promise((resolve, reject) => { child.once("error", reject); child.once("close", (code, signal) => resolve({ code, signal })); });
      return { result, receipt: JSON.parse(await readFile(output, "utf8")) };
    };
    const bytes = Buffer.from(`noise 🙂\r\n${valid}\r\n`, "utf8");
    const emojiStart = bytes.indexOf(Buffer.from("🙂"));
    const split = await run(`const bytes=Buffer.from(${JSON.stringify([...bytes])}); process.stderr.write(bytes.subarray(0, ${emojiStart + 2})); setImmediate(() => process.stderr.write(bytes.subarray(${emojiStart + 2}), () => process.exit(7)));`);
    assert.equal(split.result.code, 7);
    assert.equal(split.receipt.trustedUnlock.classification, "closed");
    const flood = await run(`for (let i=0;i<2000;i++) process.stderr.write(${JSON.stringify(`${valid}\n`)}); process.exit(7);`);
    assert.equal(flood.result.code, 7);
    assert.deepEqual(flood.receipt.trustedUnlock, { classification: "invalid" });
    const overlong = await run(`process.stderr.write(${JSON.stringify(`${"x".repeat(300)}${valid}\n`)}, () => process.exit(7));`);
    assert.equal(overlong.result.code, 7);
    assert.deepEqual(overlong.receipt.trustedUnlock, { classification: "invalid" });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("AC-4BY.2 records a signal without converting it into success", { skip: process.platform === "win32" }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "admin-receipt-"));
  try {
    const consumer = fileURLToPath(new URL("../scripts/consume-admin-trusted-unlock-receipt.mjs", import.meta.url));
    const fixture = path.join(root, "signal.mjs"), output = path.join(root, "signal.json");
    await writeFile(fixture, `process.stderr.write(${JSON.stringify(`${valid}\n`)}, () => process.kill(process.pid, "SIGTERM"));`);
    const child = spawn(process.execPath, [consumer, "--receipt", output, "--", process.execPath, fixture], { stdio: "ignore" });
    const result = await new Promise((resolve, reject) => { child.once("error", reject); child.once("close", (code, signal) => resolve({ code, signal })); });
    assert.deepEqual(result, { code: null, signal: "SIGTERM" });
    const receipt = JSON.parse(await readFile(output, "utf8"));
    assert.deepEqual(receipt, { schema: "service-lasso.admin-trusted-unlock-consumer.v1", outcome: "signal", exitCode: null, signal: "SIGTERM", trustedUnlock: { classification: "closed", receipt: JSON.parse(valid) } });
  } finally { await rm(root, { recursive: true, force: true }); }
});
