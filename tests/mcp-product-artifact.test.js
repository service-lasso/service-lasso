import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { once } from "node:events";
import { promisify } from "node:util";
import AdmZip from "adm-zip";
import { MCP_PRODUCT_EVIDENCE_CONTRACT, validateMcpProductEvidence } from "../scripts/mcp-product-acceptance-lib.mjs";

const execFileAsync = promisify(execFile);

function evidence(candidateSha, platform) {
  const coverage = Object.fromEntries([
    "initializationAndNegotiation",
    "initializedNotification",
    "toolAndResourceDiscovery",
    "closedSchemas",
    "oauthIdentityAndTransportDefences",
    "actorAndClientRateLimits",
    "permissionProfiles",
    "confirmationBindings",
    "idempotentReplay",
    "durableOperationPollingAndCancellation",
    "auditCorrelation",
    "sensitiveOutputRejection",
    "deterministicPaginationLimits",
    "canonicalRepresentativeReads",
  ].map((name) => [name, "passed"]));
  return {
    contractVersion: MCP_PRODUCT_EVIDENCE_CONTRACT,
    issue: 864,
    spec: "SPEC-006 AC-6G",
    repository: "service-lasso/service-lasso",
    workflowRunId: "864123",
    workflowRunAttempt: "1",
    eventName: "pull_request",
    candidateSha,
    platform,
    architecture: "x64",
    nodeVersion: process.version,
    packageVersion: "2026.8.30-0123456",
    packageArchiveSha256: "a".repeat(64),
    sdk: { packageName: "@modelcontextprotocol/sdk", version: "1.30.0", protocolVersion: "2025-11-25" },
    inspector: { packageName: "@modelcontextprotocol/inspector", version: "2.4.0", result: "passed", strictSchema: "passed" },
    packagedRuntime: {
      sourceCheckoutRequired: false,
      streamableHttp: "passed",
      stdio: "passed",
      operatingModes: ["read-only", "guarded"],
    },
    canonical: {
      discovery: "passed",
      representativeReads: "passed",
      guardedLifecycle: "passed",
      exactlyOnce: true,
      terminalState: "running",
    },
    coverage,
    assertions: Object.values(coverage),
    generatedAt: "2026-08-30T00:00:00.000Z",
  };
}

test("#864 retained evidence verifies downloaded content, exact SHA, three OSes, digest, and 90-day retention", async () => {
  const candidateSha = "0123456789abcdef0123456789abcdef01234567";
  const winEvidence = evidence(candidateSha, "win32");
  validateMcpProductEvidence(winEvidence, { candidateSha, platform: "win32" });
  const zip = new AdmZip();
  zip.addFile("mcp-product-win32.json", Buffer.from(`${JSON.stringify(winEvidence)}\n`, "utf8"));
  const archive = zip.toBuffer();
  const digest = `sha256:${createHash("sha256").update(archive).digest("hex")}`;
  const common = {
    size_in_bytes: archive.length,
    expired: false,
    created_at: "2026-08-30T00:00:00.000Z",
    expires_at: "2026-11-28T00:00:00.000Z",
    digest,
    workflow_run: { head_sha: candidateSha },
  };
  const artifacts = [
    { ...common, id: 8641, name: "mcp-product-acceptance-win32-864123-1" },
    { ...common, id: 8642, name: "mcp-product-acceptance-linux-864123-1" },
    { ...common, id: 8643, name: "mcp-product-acceptance-darwin-864123-1" },
  ];
  let artifactReadAttempts = 0;
  const server = createServer((request, response) => {
    response.setHeader("content-type", "application/json");
    if (request.url === "/repos/service-lasso/service-lasso/actions/runs/864123") {
      response.end(JSON.stringify({ head_sha: candidateSha }));
      return;
    }
    if (request.url === "/repos/service-lasso/service-lasso/actions/runs/864123/artifacts?per_page=100") {
      response.end(JSON.stringify({ total_count: artifacts.length, artifacts }));
      return;
    }
    if (request.url === "/repos/service-lasso/service-lasso/actions/artifacts/8641/zip") {
      response.setHeader("content-type", "application/zip");
      response.end(archive);
      return;
    }
    if (request.url === "/repos/service-lasso/service-lasso/actions/artifacts/8641") {
      artifactReadAttempts += 1;
      if (artifactReadAttempts === 1) {
        response.statusCode = 404;
        response.end(JSON.stringify({ error: "artifact_not_indexed_yet" }));
        return;
      }
      response.end(JSON.stringify(artifacts[0]));
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ error: "not_found" }));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const baseEnv = {
    ...process.env,
    GITHUB_API_URL: `http://127.0.0.1:${address.port}`,
    GITHUB_REPOSITORY: "service-lasso/service-lasso",
    GITHUB_RUN_ID: "864123",
    GITHUB_RUN_ATTEMPT: "1",
    GH_TOKEN: "fixture-capability-not-serialized",
    CANDIDATE_SHA: candidateSha,
  };

  try {
    const artifactVerification = await execFileAsync(process.execPath, ["scripts/verify-mcp-product-artifact.mjs"], {
      cwd: process.cwd(),
      env: {
        ...baseEnv,
        MCP_PRODUCT_PLATFORM: "win32",
        MCP_PRODUCT_ARTIFACT_ID: "8641",
        MCP_PRODUCT_ARTIFACT_NAME: artifacts[0].name,
        MCP_PRODUCT_ARTIFACT_DIGEST: digest,
      },
      windowsHide: true,
    });
    const verified = JSON.parse(artifactVerification.stdout);
    assert.equal(verified.artifactId, "8641");
    assert.equal(verified.downloadedContentValidated, true);
    assert.equal(verified.candidateSha, candidateSha);
    assert.equal(artifactReadAttempts, 2);
    assert.equal(artifactVerification.stdout.includes("fixture-capability-not-serialized"), false);

    const aggregateVerification = await execFileAsync(process.execPath, ["scripts/verify-mcp-product-acceptance-run.mjs"], {
      cwd: process.cwd(),
      env: baseEnv,
      windowsHide: true,
    });
    const aggregate = JSON.parse(aggregateVerification.stdout);
    assert.deepEqual(aggregate.artifacts.map((artifact) => artifact.platform), ["darwin", "linux", "win32"]);
    assert.equal(aggregate.artifacts.every((artifact) => artifact.digest === digest), true);

    const workflow = await readFile(".github/workflows/mcp-product-acceptance.yml", "utf8");
    assert.match(workflow, /platform: win32[\s\S]*?platform: linux[\s\S]*?platform: darwin/u);
    assert.match(workflow, /name: mcp-product-acceptance-\$\{\{ matrix\.platform \}\}-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}/u);
    assert.match(workflow, /if-no-files-found: error[\s\S]*?retention-days: 90/u);
    assert.match(workflow, /node scripts\/verify-mcp-product-artifact\.mjs/u);
    assert.match(workflow, /node scripts\/verify-mcp-product-acceptance-run\.mjs/u);

    const releaseWorkflow = await readFile(".github/workflows/release-qualification.yml", "utf8");
    assert.match(releaseWorkflow, /qualify-mcp-product:[\s\S]*?npm run test:mcp:product/u);
    assert.match(releaseWorkflow, /needs:[\s\S]*?- qualify-mcp-product/u);
  } finally {
    const closed = once(server, "close");
    server.close();
    server.closeAllConnections?.();
    await closed;
  }
});
