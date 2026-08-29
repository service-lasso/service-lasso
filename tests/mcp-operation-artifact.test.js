import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { once } from "node:events";
import { promisify } from "node:util";
import AdmZip from "adm-zip";

const execFileAsync = promisify(execFile);

test("#863 retained evidence verifier binds artifact API, archive digest, expiry, exact candidate SHA, and workflow retention", async () => {
  const candidateSha = "0123456789abcdef0123456789abcdef01234567";
  const evidence = {
    contractVersion: "service-lasso.mcp-operation-evidence.v1",
    issue: 863,
    spec: "SPEC-006 AC-6F",
    repository: "service-lasso/service-lasso",
    workflowRunId: "123",
    workflowRunAttempt: "1",
    eventName: "pull_request",
    candidateSha,
    platform: "linux",
    architecture: "x64",
    nodeVersion: process.version,
    testCommand: "npm test",
    assertions: ["durable operation lifecycle"],
    generatedAt: "2026-08-29T00:00:00.000Z",
  };
  const zip = new AdmZip();
  zip.addFile("mcp-operations.json", Buffer.from(`${JSON.stringify(evidence)}\n`, "utf8"));
  const archive = zip.toBuffer();
  const digest = `sha256:${createHash("sha256").update(archive).digest("hex")}`;
  const artifact = {
    id: 863,
    name: "mcp-operations-123-1",
    size_in_bytes: archive.length,
    expired: false,
    created_at: "2026-08-29T00:00:00.000Z",
    expires_at: "2026-11-27T00:00:00.000Z",
    digest,
    workflow_run: { head_sha: candidateSha },
  };
  let artifactReadAttempts = 0;
  const server = createServer((request, response) => {
    response.setHeader("content-type", "application/json");
    if (request.url === "/repos/service-lasso/service-lasso/actions/runs/123") {
      response.end(JSON.stringify({ head_sha: candidateSha }));
      return;
    }
    if (request.url === "/repos/service-lasso/service-lasso/actions/artifacts/863/zip") {
      response.setHeader("content-type", "application/zip");
      response.end(archive);
      return;
    }
    if (request.url === "/repos/service-lasso/service-lasso/actions/artifacts/863") {
      artifactReadAttempts += 1;
      if (artifactReadAttempts === 1) {
        response.statusCode = 404;
        response.end(JSON.stringify({ error: "artifact_not_indexed_yet" }));
        return;
      }
      response.end(JSON.stringify(artifact));
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ error: "not_found" }));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");

  try {
    const { stdout } = await execFileAsync(process.execPath, ["scripts/verify-mcp-operation-artifact.mjs"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        GITHUB_API_URL: `http://127.0.0.1:${address.port}`,
        GITHUB_REPOSITORY: "service-lasso/service-lasso",
        GITHUB_RUN_ID: "123",
        GH_TOKEN: "fixture-token-not-serialized",
        CANDIDATE_SHA: candidateSha,
        MCP_OPERATION_ARTIFACT_ID: "863",
        MCP_OPERATION_ARTIFACT_NAME: artifact.name,
        MCP_OPERATION_ARTIFACT_DIGEST: digest,
      },
      windowsHide: true,
    });
    const verified = JSON.parse(stdout);
    assert.equal(verified.artifactId, "863");
    assert.equal(verified.digest, digest);
    assert.equal(verified.candidateSha, candidateSha);
    assert.equal(artifactReadAttempts, 2);
    assert.equal(stdout.includes("fixture-token-not-serialized"), false);

    const workflow = await readFile(".github/workflows/release-qualification.yml", "utf8");
    assert.match(workflow, /name: mcp-operations-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}/u);
    assert.match(workflow, /path: artifacts\/mcp-operations\.json[\s\S]*?if-no-files-found: error[\s\S]*?retention-days: 90/u);
    assert.match(workflow, /node scripts\/verify-mcp-operation-artifact\.mjs/u);
  } finally {
    const closed = once(server, "close");
    server.close();
    server.closeAllConnections?.();
    await closed;
  }
});
