import test from "node:test";
import assert from "node:assert/strict";
import { projectAuditRequest } from "../scripts/audit-request-observation.mjs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

test("audit requests retain only the two fixed endpoints and bounded response metadata", () => {
  assert.deepEqual(projectAuditRequest("npm http fetch POST 200 https://registry.npmjs.org/-/npm/v1/security/advisories/bulk 464ms"), { endpoint: "bulk", status: 200, elapsedMs: 464 });
  assert.deepEqual(projectAuditRequest("npm http fetch POST 400 https://registry.npmjs.org/-/npm/v1/security/audits/quick 99999999ms"), { endpoint: "quick", status: 400, elapsedMs: 3_600_000 });
  for (const line of ["PRIVATE-PAYLOAD", "npm http fetch POST 200 https://private.example/token 10ms", "npm http fetch POST 200 https://registry.npmjs.org/-/npm/v1/security/advisories/bulk?token=PRIVATE 10ms", "npm http fetch POST 999 https://registry.npmjs.org/-/npm/v1/security/advisories/bulk 10ms"]) {
    assert.equal(projectAuditRequest(line), null);
  }
});

test("audit transport observations use closed failure codes", () => {
  assert.deepEqual(projectAuditRequest("npm http fetch POST https://registry.npmjs.org/-/npm/v1/security/advisories/bulk attempt 1 failed with ETIMEDOUT"), { endpoint: "bulk", status: null, elapsedMs: null, attempt: 1, failureCode: "ETIMEDOUT" });
  assert.equal(projectAuditRequest("npm http fetch POST https://registry.npmjs.org/-/npm/v1/security/advisories/bulk attempt 1 failed with PRIVATE-TOKEN"), null);
});

test("audit observer preserves findings, nonzero exit and severity arguments without leaking HTTP input", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "audit-observation-"));
  try {
    const cli = path.join(root, "fixture.cjs");
    await writeFile(cli, 'process.stdout.write(JSON.stringify(process.argv.slice(2))); process.stderr.write("npm http fetch POST 200 https://private.example/PRIVATE-TOKEN 10ms\\n"); process.exitCode = 13;');
    const helper = new URL("../scripts/audit-request-observation.mjs", import.meta.url).href;
    const source = `import { observeAudit } from ${JSON.stringify(helper)}; process.exitCode = await observeAudit("production", ${JSON.stringify(cli)});`;
    await assert.rejects(promisify(execFile)(process.execPath, ["--input-type=module", "-e", source]), (error) => {
      assert.equal(error.code, 13);
      assert.deepEqual(JSON.parse(error.stdout), ["audit", "--omit=dev", "--audit-level=low", "--loglevel=http"]);
      assert.equal(error.stderr.includes("PRIVATE-TOKEN"), false);
      assert.equal(JSON.parse(error.stderr.trim()).scope, "production");
      return true;
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
