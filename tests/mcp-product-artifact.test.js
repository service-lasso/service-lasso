import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { once } from "node:events";
import { promisify } from "node:util";
import { ZipArchive } from "./helpers/zip-fixture.mjs";
import { assertManagedClosureSourceConformance } from "./helpers/core1681-managed-closure-source-contract.mjs";
import {
  MCP_PACKAGED_COVERAGE_KEYS,
  MCP_PRODUCT_EVIDENCE_CONTRACT,
  fetchBoundedDiagnosticJson,
  parsePackagedAcceptanceFailure,
  projectPackagedWindowsTreeInspection,
  validateMcpProductEvidence,
} from "../scripts/mcp-product-acceptance-lib.mjs";

const execFileAsync = promisify(execFile);

test("#1326 packaged projection retains only bounded initial-inspection evidence", () => {
  const privateValue = "C:\\private\\workspace token=secret command --password";
  assert.deepEqual(projectPackagedWindowsTreeInspection({
    windowsTreeInspectionPhase: "native_snapshot",
    windowsTreeInspectionAttempts: 53,
    windowsTreeInspectionRetries: 52,
    windowsTreeInspectionQueueMs: 6,
    windowsTreeInspectionNativeMs: 2600,
    windowsTreeInspectionLastRetry: "descendant_command_partial_copy",
    pid: 4343,
    command: privateValue,
    path: privateValue,
  }), {
    windowsTreeInspectionPhase: "native_snapshot",
    windowsTreeInspectionAttempts: 53,
    windowsTreeInspectionRetries: 52,
    windowsTreeInspectionQueueMs: 6,
    windowsTreeInspectionNativeMs: 2600,
    windowsTreeInspectionLastRetry: "descendant_command_partial_copy",
  });
  assert.equal(projectPackagedWindowsTreeInspection({ windowsTreeInspectionPhase: "private_phase" }), null);
  assert.deepEqual(projectPackagedWindowsTreeInspection({
    windowsTreeInspectionPhase: "queue_wait",
    windowsTreeInspectionAttempts: 1001,
    windowsTreeInspectionRetries: -1,
    windowsTreeInspectionQueueMs: 600001,
    windowsTreeInspectionNativeMs: 600001,
    windowsTreeInspectionLastRetry: privateValue,
  }), {
    windowsTreeInspectionPhase: "queue_wait",
    windowsTreeInspectionAttempts: null,
    windowsTreeInspectionRetries: null,
    windowsTreeInspectionQueueMs: null,
    windowsTreeInspectionNativeMs: null,
    windowsTreeInspectionLastRetry: null,
  });
});

test("#864 guarded diagnostic acquisition is time- and size-bounded", async () => {
  const server = createServer((request, response) => {
    if (request.url === "/small") {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ status: "ready" }));
      return;
    }
    if (request.url === "/oversize") {
      response.setHeader("content-type", "application/json");
      response.write(`{"value":"${"x".repeat(64)}`);
      response.end('"}');
      return;
    }
    // Keep the response open so the caller's diagnostic-only deadline owns it.
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const root = `http://127.0.0.1:${address.port}`;
  try {
    assert.deepEqual(await fetchBoundedDiagnosticJson(`${root}/small`, { timeoutMs: 1_000, maxBytes: 64 }), { status: "ready" });
    await assert.rejects(
      fetchBoundedDiagnosticJson(`${root}/oversize`, { timeoutMs: 1_000, maxBytes: 32 }),
      /bounded size/u,
    );
    await assert.rejects(
      fetchBoundedDiagnosticJson(`${root}/hang`, { timeoutMs: 100, maxBytes: 32 }),
      /abort|invalid_argument/iu,
    );
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }
});

test("#1681 AC-4DI.4 G1 actual-source closure guard rejects ownership and ordering drift", async () => {
  // These are source-conformance vectors. They do not invoke the C# launcher or
  // create native outcomes, and cannot qualify the retained executable images.
  const source = await readFile("src/runtime/execution/windows-managed-launcher-native.cs", "utf8");
  assert.doesNotThrow(() => assertManagedClosureSourceConformance(source));
  const vectors = [
    ["disposal before containment", "RunManagedInvocation", "try { ContainManagedJobBeforeFileRelease(", "invocation.Files[0].Dispose(); try { ContainManagedJobBeforeFileRelease("],
    ["file release before outer finally", "RunManagedInvocation", "targetAssignedToJob = true;", "targetAssignedToJob = true; invocation.ReleaseFile(boundFiles[0], 0);"],
    ["wrong original file", "ReleaseFile", "File = file, Attempted = true", "File = null, Attempted = true"],
    ["wrong original ordinal", "FinishManagedReleases", "invocation.ReleaseFile(invocation.Files[ordinal], ordinal)", "invocation.ReleaseFile(invocation.Files[ordinal], ordinal + 1)"],
    ["missing original exception capture", "ReleaseFile", "original.Exception = failure; original.Failed = true;", "original.Failed = true;"],
    ["missing original object retention", "ReleaseFile", "Outcomes.Add(original);", "// original was not retained"],
    ["repeated attempt after earlier outcome", "ReleaseFile", "if (previous != null) return previous.Closed;", "// retry bypasses previous outcome"],
    ["missing original failure fold", "ReleaseFile", "Failed |= original.Failed;", "// failed result was not folded"],
    ["missing same-owner failure retention", "FinishManagedReleases", "if (invocation.Failed) RetainManagedInvocation(invocation);", "// failed invocation escapes"],
    ["later safe releases conditioned on earlier close", "FinishManagedReleases", "invocation.Release(ref process,", "if (!invocation.Failed) invocation.Release(ref process,"],
    ["early success bypass", "RunManagedInvocation", "return invocation.PrimaryResult;", "return 0;"],
    ["unknown containment skips retention", "RunManagedInvocation", "RetainManagedInvocation(invocation);", "// unknown containment escapes"],
    ["lost live owner", "RetainManagedInvocation", "GC.KeepAlive(owner);", "GC.KeepAlive(null);"],
    ["unreachable release decoy", "ReleaseFile", "Outcomes.Add(original);", "if (false) { Outcomes.Add(original); }"],
  ];
  for (const [label, owner, needle, replacement] of vectors) {
    const signatures = {
      RunManagedInvocation: "internal static int RunManagedInvocation(",
      ReleaseFile: "internal bool ReleaseFile(",
      FinishManagedReleases: "internal static void FinishManagedReleases(",
      RetainManagedInvocation: "internal static void RetainManagedInvocation(",
    };
    const at = source.indexOf(signatures[owner]);
    assert.ok(at >= 0, `${label}: actual owner exists`);
    const after = source.slice(at);
    assert.ok(after.includes(needle), `${label}: actual mutation anchor exists`);
    const mutant = source.slice(0, at) + after.replace(needle, replacement);
    assert.notEqual(mutant, source, `${label}: actual source changed`);
    assert.throws(() => assertManagedClosureSourceConformance(mutant), /managed closure/u, label);
    // A correct-looking original snippet outside the owning body cannot repair
    // either lexical ownership or the independently required relational chain.
    const decoy = `${mutant}\n/* unrelated original snippet: ${needle} */\n`;
    assert.throws(() => assertManagedClosureSourceConformance(decoy), /managed closure/u, `${label}: outside-owner decoy`);
  }
});

test("#864 packaged failure diagnostics admit one strict bounded record and discard captured process detail", () => {
  const safe = {
    stage: "guarded_preflight",
    errorCode: "guarded_preflight_failed",
    result: { isError: true, status: null, errorCode: "invalid_request" },
    componentProbe: { stage: "component_probe", errorCode: null },
    auditProbe: { stage: "audit_probe", reason: "confirmation_private_state_protect_integrity_timeout" },
  };
  const hostile = "token=secret C:\\private\\workspace /opt/private command --password";
  assert.deepEqual(
    parsePackagedAcceptanceFailure(`${hostile}\n[mcp-package-acceptance-error] ${JSON.stringify(safe)}\n${hostile}`),
    safe,
  );
  assert.equal(parsePackagedAcceptanceFailure(`[mcp-package-acceptance-error] ${JSON.stringify({ ...safe, path: hostile })}`), null);
  assert.equal(parsePackagedAcceptanceFailure(`[mcp-package-acceptance-error] ${JSON.stringify({
    ...safe,
    auditProbe: { stage: "audit_probe", reason: "secret_token_value" },
  })}`), null);
  assert.equal(parsePackagedAcceptanceFailure(`[mcp-package-acceptance-error] ${JSON.stringify({
    ...safe,
    result: { ...safe.result, status: "secret_token_value" },
  })}`), null);
  assert.equal(parsePackagedAcceptanceFailure(`[mcp-package-acceptance-error] ${JSON.stringify(safe)}\n[mcp-package-acceptance-error] ${JSON.stringify(safe)}`), null);
  assert.equal(JSON.stringify(safe).includes(hostile), false);
  assert.ok(JSON.stringify(safe).length < 512);
  const helperTimeout = {
    ...safe,
    auditProbe: { stage: "audit_probe", reason: "confirmation_private_state_protect_helper_timeout" },
  };
  assert.deepEqual(
    parsePackagedAcceptanceFailure(`[mcp-package-acceptance-error] ${JSON.stringify(helperTimeout)}`),
    helperTimeout,
  );

  const guarded = {
    stage: "guarded_replay",
    errorCode: "guarded_replay_contract_failed",
    guardedProbe: {
      completed: { isError: false, status: "succeeded", errorCode: null, replayed: false, running: true },
      replayed: { isError: false, status: "replayed", errorCode: null, replayed: true, running: true },
      sameCorrelation: true,
      lifecycle: {
        attemptStatus: "failed",
        phase: "health_check",
        exitClass: "nonzero",
        readinessAttribution: "not_applicable",
        healthcheckFailed: true,
        processStartFailurePhase: "launcher_file_hash",
        windowsTreeInspection: {
          windowsTreeInspectionPhase: "native_snapshot",
          windowsTreeInspectionAttempts: 53,
          windowsTreeInspectionRetries: 52,
          windowsTreeInspectionQueueMs: 6,
          windowsTreeInspectionNativeMs: 2600,
          windowsTreeInspectionLastRetry: "descendant_command_partial_copy",
        },
      },
    },
  };
  assert.deepEqual(
    parsePackagedAcceptanceFailure(`[mcp-package-acceptance-error] ${JSON.stringify(guarded)}`),
    guarded,
  );
  assert.equal(parsePackagedAcceptanceFailure(`[mcp-package-acceptance-error] ${JSON.stringify({
    ...guarded,
    guardedProbe: { ...guarded.guardedProbe, message: hostile },
  })}`), null);
  assert.equal(parsePackagedAcceptanceFailure(`[mcp-package-acceptance-error] ${JSON.stringify({
    ...guarded,
    guardedProbe: {
      ...guarded.guardedProbe,
      lifecycle: {
        ...guarded.guardedProbe.lifecycle,
        windowsTreeInspection: {
          ...guarded.guardedProbe.lifecycle.windowsTreeInspection,
          pid: 4343,
          command: hostile,
        },
      },
    },
  })}`), null);
  assert.equal(parsePackagedAcceptanceFailure(`[mcp-package-acceptance-error] ${JSON.stringify({
    ...guarded,
    guardedProbe: {
      ...guarded.guardedProbe,
      lifecycle: {
        ...guarded.guardedProbe.lifecycle,
        windowsTreeInspection: {
          ...guarded.guardedProbe.lifecycle.windowsTreeInspection,
          windowsTreeInspectionAttempts: 1001,
        },
      },
    },
  })}`), null);
  assert.equal(parsePackagedAcceptanceFailure(`[mcp-package-acceptance-error] ${JSON.stringify({
    ...guarded,
    guardedProbe: {
      ...guarded.guardedProbe,
      completed: { ...guarded.guardedProbe.completed, summary: hostile },
    },
  })}`), null);
  assert.equal(parsePackagedAcceptanceFailure(`[mcp-package-acceptance-error] ${JSON.stringify({
    ...guarded,
    guardedProbe: {
      ...guarded.guardedProbe,
      completed: { ...guarded.guardedProbe.completed, status: "secret_token_value" },
    },
  })}`), null);
  assert.equal(parsePackagedAcceptanceFailure(`[mcp-package-acceptance-error] ${JSON.stringify({
    ...guarded,
    guardedProbe: {
      ...guarded.guardedProbe,
      lifecycle: { ...guarded.guardedProbe.lifecycle, readinessAttribution: "secret_token_value" },
    },
  })}`), null);
  assert.equal(parsePackagedAcceptanceFailure(`[mcp-package-acceptance-error] ${JSON.stringify({
    ...guarded,
    guardedProbe: {
      ...guarded.guardedProbe,
      lifecycle: { ...guarded.guardedProbe.lifecycle, attemptStatus: "secret_token_value" },
    },
  })}`), null);
  assert.equal(parsePackagedAcceptanceFailure(`[mcp-package-acceptance-error] ${JSON.stringify({
    ...guarded,
    guardedProbe: {
      ...guarded.guardedProbe,
      lifecycle: { ...guarded.guardedProbe.lifecycle, phase: "secret_token_value" },
    },
  })}`), null);
  assert.equal(parsePackagedAcceptanceFailure(`[mcp-package-acceptance-error] ${JSON.stringify({
    ...guarded,
    guardedProbe: {
      ...guarded.guardedProbe,
      lifecycle: { ...guarded.guardedProbe.lifecycle, processStartFailurePhase: "secret_token_value" },
    },
  })}`), null);
  assert.equal(JSON.stringify(guarded).includes(hostile), false);
  assert.ok(JSON.stringify(guarded).length < 1024);
});

function evidence(candidateSha, platform) {
  const coverage = Object.fromEntries(MCP_PACKAGED_COVERAGE_KEYS.map((name) => [name, "passed"]));
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
    sdk: {
      packageName: "@modelcontextprotocol/sdk",
      version: "1.31.0",
      protocolVersion: "2025-11-25",
      supportedProtocolVersions: ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05", "2024-10-07"],
    },
    inspector: { packageName: "@modelcontextprotocol/inspector", version: "2.4.0", result: "passed", strictSchema: "passed" },
    packagedRuntime: {
      sourceCheckoutRequired: false,
      sourceCheckoutAccess: "denied-by-node-permission-model",
      moduleResolution: "fresh-consumer-node-modules",
      workingDirectory: "fresh-consumer",
      streamableHttp: "passed",
      stdio: "passed",
      operatingModes: ["read-only", "guarded"],
      identityInspectionPolicy: platform === "win32"
        ? "native-win32-product-default"
        : "product-default",
    },
    canonical: {
      discovery: "passed",
      representativeReads: "passed",
      guardedLifecycle: "passed",
      exactlyOnce: true,
      terminalState: "running",
    },
    coverage,
    assertions: [...MCP_PACKAGED_COVERAGE_KEYS],
    generatedAt: "2026-08-30T00:00:00.000Z",
  };
}

test("#864 retained evidence rejects incomplete, inflated, unexpected, or malformed metadata", () => {
  const candidateSha = "0123456789abcdef0123456789abcdef01234567";
  const valid = evidence(candidateSha, "linux");
  validateMcpProductEvidence(valid, { candidateSha, platform: "linux" });

  const invalidMutations = [
    (value) => { value.assertions = []; },
    (value) => { delete value.coverage.officialInspector; },
    (value) => { value.coverage.oauthIdentityAndTransportDefences = "passed"; },
    (value) => { value.credentials = "not-allowed"; },
    (value) => { value.sdk.unexpected = "passed"; },
    (value) => { value.sdk.version = "1.29.0"; },
    (value) => { value.sdk.version = "1.30.1"; },
    (value) => { value.inspector.version = "2.3.0"; },
    (value) => { value.packageArchiveSha256 = "not-a-digest"; },
    (value) => { value.canonical.discovery = "failed"; },
    (value) => { value.packagedRuntime.operatingModes.reverse(); },
    (value) => { value.packagedRuntime.identityInspectionPolicy = "native-win32-product-default"; },
  ];
  for (const mutate of invalidMutations) {
    const invalid = structuredClone(valid);
    mutate(invalid);
    assert.throws(
      () => validateMcpProductEvidence(invalid, { candidateSha, platform: "linux" }),
      /closed acceptance contract/u,
    );
  }
});

test("#864 retained evidence verifies downloaded content, exact SHA, three OSes, digest, and 90-day retention", async () => {
  const candidateSha = "0123456789abcdef0123456789abcdef01234567";
  const winEvidence = evidence(candidateSha, "win32");
  validateMcpProductEvidence(winEvidence, { candidateSha, platform: "win32" });
  assert.throws(
    () => validateMcpProductEvidence(
      { ...winEvidence, packagedRuntime: { ...winEvidence.packagedRuntime, identityInspectionPolicy: "real-host-60s-acceptance-bound" } },
      { candidateSha, platform: "win32" },
    ),
    /closed acceptance contract/u,
  );
  const zip = new ZipArchive();
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
    assert.match(workflow, /scripts\/mcp-packaged-consumer-runner\.mjs/u);
    for (const governedRuntimePath of [
      ".gitattributes",
      "scripts/copy-runtime-assets.mjs",
      "scripts/verify-windows-process-inspector.ps1",
      "scripts/verify-windows-dpapi-helper.ps1",
      "docs/reference/process-ownership-registry.md",
      "src/runtime/execution/supervisor.ts",
      "src/runtime/execution/windows-managed-launcher-native.cs",
      "src/runtime/execution/windows-managed-launcher-native.exe",
      "src/runtime/execution/windows-managed-launcher-native.provenance.json",
      "src/runtime/execution/windows-managed-launcher.ps1",
      "src/runtime/lifecycle/actions.ts",
      "src/runtime/security/private-json.ts",
      "src/runtime/security/windows-dpapi-helper.cs",
      "src/runtime/security/windows-dpapi-helper.exe",
      "src/runtime/security/windows-dpapi-helper.provenance.json",
      "src/runtime/process/identity.ts",
      "src/runtime/process/registry.ts",
      "src/runtime/process/tree.ts",
      "src/runtime/process/windows-process-inspector.cs",
      "src/runtime/process/windows-process-inspector.exe",
      "src/runtime/process/windows-process-inspector.provenance.json",
      "src/runtime/setup/definition-revision.ts",
      "tests/process-ownership.test.js",
      "tests/private-json.test.js",
      "tests/service-start-trace.test.js",
    ]) {
      assert.equal(workflow.split(`- ${governedRuntimePath}`).length - 1, 2);
    }
    const gitAttributes = await readFile(".gitattributes", "utf8");
    assert.match(gitAttributes, /windows-process-inspector\.cs text eol=lf/u);
    assert.match(gitAttributes, /windows-process-inspector\.provenance\.json text eol=lf/u);
    assert.match(gitAttributes, /windows-process-inspector\.ps1 text eol=lf/u);
    assert.match(gitAttributes, /windows-process-inspector\.exe binary/u);
    assert.match(gitAttributes, /windows-dpapi-helper\.cs text eol=lf/u);
    assert.match(gitAttributes, /windows-dpapi-helper\.provenance\.json text eol=lf/u);
    assert.match(gitAttributes, /windows-dpapi-helper\.ps1 text eol=lf/u);
    assert.match(gitAttributes, /windows-dpapi-helper\.exe binary/u);
    assert.match(gitAttributes, /windows-managed-launcher-native\.cs text eol=lf/u);
    assert.match(gitAttributes, /windows-managed-launcher-native\.provenance\.json text eol=lf/u);
    assert.match(gitAttributes, /windows-managed-launcher-native\.exe binary/u);

    const releaseWorkflow = await readFile(".github/workflows/release-qualification.yml", "utf8");
    assert.match(releaseWorkflow, /qualify-mcp-product:[\s\S]*?npm run test:mcp:product/u);
    assert.match(releaseWorkflow, /qualify-mcp-packaged:[\s\S]*?platform: win32[\s\S]*?platform: linux[\s\S]*?platform: darwin/u);
    assert.match(releaseWorkflow, /qualify-mcp-packaged:[\s\S]*?Build packaged MCP verifier[\s\S]*?npm run build[\s\S]*?SERVICE_LASSO_RELEASE_METADATA_TOKEN: \$\{\{ github\.token \}\}[\s\S]*?node scripts\/verify-mcp-packaged-bootstrap\.mjs/u);
    assert.match(releaseWorkflow, /Verify attached-terminal TUI behavior \(Windows ConPTY\)[\s\S]*?if: matrix\.platform == 'win32'[\s\S]*?node scripts\/verify-operator-tui-conpty\.mjs/u);
    assert.match(releaseWorkflow, /MCP_PRODUCT_EVIDENCE_PATH: artifacts\/mcp-product-\$\{\{ matrix\.platform \}\}\.json[\s\S]*?path: artifacts\/mcp-product-\$\{\{ matrix\.platform \}\}\.json/u);
    assert.match(releaseWorkflow, /qualify-release:[\s\S]*?needs:[\s\S]*?- qualify-mcp-product[\s\S]*?- qualify-mcp-packaged/u);

    for (const workflowPath of [".github/workflows/publish-package.yml", ".github/workflows/release-artifact.yml"]) {
      const publicationWorkflow = await readFile(workflowPath, "utf8");
      assert.match(publicationWorkflow, /qualify-mcp-packaged:[\s\S]*?platform: win32[\s\S]*?platform: linux[\s\S]*?platform: darwin/u);
      assert.match(publicationWorkflow, /qualify-mcp-packaged:[\s\S]*?Build packaged MCP verifier[\s\S]*?npm run build[\s\S]*?SERVICE_LASSO_RELEASE_METADATA_TOKEN: \$\{\{ github\.token \}\}[\s\S]*?node scripts\/verify-mcp-packaged-bootstrap\.mjs/u);
      assert.match(publicationWorkflow, /MCP_PRODUCT_EVIDENCE_PATH: artifacts\/mcp-product-\$\{\{ matrix\.platform \}\}\.json[\s\S]*?path: artifacts\/mcp-product-\$\{\{ matrix\.platform \}\}\.json/u);
      assert.match(publicationWorkflow, /needs:[\s\S]*?- qualify-mcp-packaged/u);
      assert.match(publicationWorkflow, /retention-days: 90/u);
      assert.match(publicationWorkflow, /node scripts\/verify-mcp-product-artifact\.mjs/u);
    }

    const packagedBootstrap = await readFile("scripts/verify-mcp-packaged-bootstrap.mjs", "utf8");
    assert.match(packagedBootstrap, /bootstrapReleaseMetadataToken\(\);[\s\S]*?await import\("\.\/verify-mcp-packaged\.mjs"\)/u);
    const packagedVerifier = await readFile("scripts/verify-mcp-packaged.mjs", "utf8");
    assert.match(packagedVerifier, /takeBootstrappedReleaseMetadataToken\(\)/u);
    assert.match(packagedVerifier, /const tempRoot = await realpath\(await mkdtemp/u);
    assert.match(packagedVerifier, /PSModulePath: path\.join\(process\.env\.SystemRoot, "System32", "WindowsPowerShell", "v1\.0", "Modules"\)/u);
    assert.match(packagedVerifier, /verifyWindowsProcessInspectorProvenance[\s\S]*?verify-windows-process-inspector\.ps1/u);
    assert.match(packagedVerifier, /verifyWindowsDpapiHelperProvenance[\s\S]*?verify-windows-dpapi-helper\.ps1/u);
    assert.match(packagedVerifier, /verifyWindowsManagedLauncherNativeProvenance[\s\S]*?-ManagedLauncherNative/u);
    assert.doesNotMatch(packagedVerifier, /-Behavioral/u);
    assert.match(
      packagedVerifier,
      /const windowsSystemRoot = process\.env\.SystemRoot \?\? process\.env\.WINDIR;[\s\S]*?process\.platform === "win32" && \(!windowsSystemRoot \|\| !path\.win32\.isAbsolute\(windowsSystemRoot\)\)/u,
    );
    assert.match(
      packagedVerifier,
      /const executable = process\.platform === "win32"[\s\S]*?path\.win32\.join\(path\.win32\.normalize\(windowsSystemRoot\), "System32", "WindowsPowerShell", "v1\.0", "powershell\.exe"\)[\s\S]*?: process\.execPath;/u,
    );
    assert.match(
      packagedVerifier,
      /const args = process\.platform === "win32"[\s\S]*?"-NoLogo",[\s\S]*?"-NoProfile",[\s\S]*?"-NonInteractive",[\s\S]*?"-Command",[\s\S]*?"\[Threading\.Thread\]::Sleep\(\[Threading\.Timeout\]::Infinite\)"[\s\S]*?: \["runtime\/canonical-service\.mjs"\];/u,
    );
    const packagedConsumer = await readFile("scripts/mcp-packaged-consumer-runner.mjs", "utf8");
    assert.match(packagedConsumer, /"NODE_OPTIONS", "PSModulePath"/u);
    assert.match(packagedConsumer, /SAFE_DIAGNOSTIC_CODE[\s\S]*?componentProbe/u);
    assert.doesNotMatch(packagedConsumer, /JSON\.stringify\(plan\)/u);
    assert.doesNotMatch(packagedConsumer, /setWindowsProcessInspectionTimeoutForTests|mcp-packaged-stdio-preload/u);
    assert.match(packagedVerifier, /verificationFailure[\s\S]*?cleanup_failed[\s\S]*?mcp-package-verification-error/u);
    const identitySource = await readFile("src/runtime/process/identity.ts", "utf8");
    assert.match(identitySource, /windows-process-inspector\.exe/u);
    assert.doesNotMatch(identitySource, /windows-process-inspector\.ps1|powershell\.exe/u);
    assert.doesNotMatch(identitySource, /setWindowsProcessInspectionTimeoutForTests|System\.Management\.ManagementObjectSearcher/u);
    assert.doesNotMatch(identitySource, /Get-CimInstance Win32_Process/u);
    const privateJsonSource = await readFile("src/runtime/security/private-json.ts", "utf8");
    assert.match(privateJsonSource, /windows-dpapi-helper\.exe[\s\S]*?\[operation\]/u);
    assert.match(privateJsonSource, /WINDOWS_DPAPI_HELPER_BYTES = 5_120[\s\S]*?WINDOWS_DPAPI_HELPER_PROVENANCE_BYTES = 722/u);
    assert.match(privateJsonSource, /lstat\(assetPath\)[\s\S]*?!beforeOpen\.isFile\(\)[\s\S]*?beforeOpen\.isSymbolicLink\(\)[\s\S]*?afterOpen\.size !== expectedBytes/u);
    assert.match(privateJsonSource, /integrityDeadline = new Promise<never>[\s\S]*?integrityAbort\.abort\(\)[\s\S]*?Promise\.race/u);
    assert.match(privateJsonSource, /signal\.throwIfAborted\(\)[\s\S]*?lstat\(assetPath\)[\s\S]*?signal\.throwIfAborted\(\)[\s\S]*?open\(assetPath/u);
    assert.match(privateJsonSource, /spawn\(helperPath[\s\S]*?remainingAfterSpawnMs = deadline - Date\.now\(\)[\s\S]*?setTimeout[\s\S]*?remainingAfterSpawnMs/u);
    assert.doesNotMatch(privateJsonSource, /Add-Type|ProtectedData|powershell\.exe/u);
    const dpapiHelperSource = await readFile("src/runtime/security/windows-dpapi-helper.cs", "utf8");
    assert.match(dpapiHelperSource, /ProtectedData\.Protect[\s\S]*?DataProtectionScope\.CurrentUser/u);
    assert.match(dpapiHelperSource, /ProtectedData\.Unprotect[\s\S]*?DataProtectionScope\.CurrentUser/u);
    assert.match(dpapiHelperSource, /MaximumInputCharacters[\s\S]*?IsCanonicalBase64[\s\S]*?Array\.Clear/u);
    assert.doesNotMatch(dpapiHelperSource, /Reflection\.Emit|Add-Type|Process\.Start|PowerShell/u);
    const dpapiHelperBinary = await readFile("src/runtime/security/windows-dpapi-helper.exe");
    const dpapiHelperProvenance = JSON.parse(
      await readFile("src/runtime/security/windows-dpapi-helper.provenance.json", "utf8"),
    );
    const dpapiProvenanceBytes = await readFile("src/runtime/security/windows-dpapi-helper.provenance.json");
    assert.equal(dpapiHelperProvenance.source.sha256, createHash("sha256").update(dpapiHelperSource).digest("hex"));
    assert.equal(dpapiHelperProvenance.binary.sha256, createHash("sha256").update(dpapiHelperBinary).digest("hex"));
    assert.equal(dpapiHelperProvenance.binary.byteLength, dpapiHelperBinary.byteLength);
    assert.equal(dpapiHelperProvenance.binary.peTimestamp, "zero");
    assert.equal(dpapiHelperProvenance.binary.moduleVersionId, "zero");
    assert.match(privateJsonSource, new RegExp(dpapiHelperProvenance.binary.sha256, "u"));
    assert.match(privateJsonSource, new RegExp(createHash("sha256").update(dpapiProvenanceBytes).digest("hex"), "u"));
    assert.deepEqual(
      await readFile("dist/runtime/security/windows-dpapi-helper.exe"),
      dpapiHelperBinary,
    );
    assert.deepEqual(
      JSON.parse(await readFile("dist/runtime/security/windows-dpapi-helper.provenance.json", "utf8")),
      dpapiHelperProvenance,
    );
    const dpapiProvenanceVerifier = await readFile("scripts/verify-windows-dpapi-helper.ps1", "utf8");
    assert.match(dpapiProvenanceVerifier, /Get-NormalizedAssemblyBytes[\s\S]*?peOffset \+ 8[\s\S]*?moduleVersionIdOffset/u);
    assert.match(dpapiProvenanceVerifier, /Assert-ExactBytes[\s\S]*?Invoke-Helper[\s\S]*?protect[\s\S]*?unprotect/u);
    assert.match(dpapiProvenanceVerifier, /if \(\$Behavioral\)[\s\S]*?contractCases = 8/u);
    assert.match(packagedVerifier, /installedDpapiHelper[\s\S]*?installedDpapiProvenance[\s\S]*?reviewedDpapiHelper[\s\S]*?reviewedDpapiProvenance/u);
    const nativeInspectorSource = await readFile("src/runtime/process/windows-process-inspector.cs", "utf8");
    assert.match(nativeInspectorSource, /DllImport[\s\S]*?OpenProcess[\s\S]*?GetProcessTimes[\s\S]*?QueryFullProcessImageName[\s\S]*?NtQueryInformationProcess/u);
    assert.match(nativeInspectorSource, /CreateToolhelp32Snapshot[\s\S]*?Process32First[\s\S]*?Process32Next/u);
    assert.match(nativeInspectorSource, /ReadParentProcessId[\s\S]*?NtQueryInformationProcess/u);
    assert.match(nativeInspectorSource, /ParentProcessId[\s\S]*?Native process tree changed during inspection/u);
    assert.match(nativeInspectorSource, /returnedLength < headerSize[\s\S]*?length > maximumLength[\s\S]*?maximumLength > availableLength/u);
    assert.doesNotMatch(nativeInspectorSource, /Reflection\.Emit|Add-Type|Get-CimInstance|Win32_Process/u);
    const nativeInspectorBinary = await readFile("src/runtime/process/windows-process-inspector.exe");
    assert.equal(nativeInspectorBinary.byteLength > 8_000, true);
    const inspectorProvenance = JSON.parse(
      await readFile("src/runtime/process/windows-process-inspector.provenance.json", "utf8"),
    );
    assert.equal(inspectorProvenance.compiler.path, "%WINDIR%/Microsoft.NET/Framework64/v4.0.30319/csc.exe");
    assert.deepEqual(inspectorProvenance.compiler.options, [
      "/nologo",
      "/target:exe",
      "/platform:anycpu",
      "/optimize+",
    ]);
    assert.equal(
      inspectorProvenance.source.sha256,
      createHash("sha256").update(nativeInspectorSource).digest("hex"),
    );
    assert.equal(
      inspectorProvenance.binary.sha256,
      createHash("sha256").update(nativeInspectorBinary).digest("hex"),
    );
    assert.equal(inspectorProvenance.binary.byteLength, nativeInspectorBinary.byteLength);
    assert.equal(inspectorProvenance.binary.peTimestamp, "zero");
    assert.equal(inspectorProvenance.binary.moduleVersionId, "zero");
    assert.deepEqual(
      await readFile("dist/runtime/process/windows-process-inspector.exe"),
      nativeInspectorBinary,
    );
    assert.deepEqual(
      JSON.parse(await readFile("dist/runtime/process/windows-process-inspector.provenance.json", "utf8")),
      inspectorProvenance,
    );
    const inspectorProvenanceVerifier = await readFile("scripts/verify-windows-process-inspector.ps1", "utf8");
    assert.match(inspectorProvenanceVerifier, /Framework64[\s\S]*?v4\.0\.30319[\s\S]*?csc\.exe/u);
    assert.match(inspectorProvenanceVerifier, /Get-NormalizedAssemblyBytes[\s\S]*?peOffset \+ 8[\s\S]*?moduleVersionIdOffset/u);
    assert.match(inspectorProvenanceVerifier, /shippedBytes\[\$index\] -ne \$normalizedBytes\[\$index\]/u);
    assert.match(inspectorProvenanceVerifier, /Assert-CanonicalProvenanceBytes/u);
    assert.match(inspectorProvenanceVerifier, /Assert-ExactPropertyNames/u);
    assert.match(inspectorProvenanceVerifier, /Test-ProvenanceJsonInteger/u);
    assert.match(inspectorProvenanceVerifier, /Test-ProvenanceExactString[\s\S]*?actualCompilerOptions[\s\S]*?SourceSha256[\s\S]*?BinarySha256/u);
    assert.match(inspectorProvenanceVerifier, /Invoke-ProvenanceNegativeTests[\s\S]*?extra property[\s\S]*?reordered properties[\s\S]*?string schema[\s\S]*?non-integral schema[\s\S]*?string binary length[\s\S]*?non-integral binary length[\s\S]*?compiler path[\s\S]*?compiler option[\s\S]*?source digest[\s\S]*?binary digest[\s\S]*?normalization declaration[\s\S]*?boolean compiler path[\s\S]*?boolean compiler option[\s\S]*?boolean source digest[\s\S]*?boolean normalization declaration/u);
    assert.match(inspectorProvenanceVerifier, /first-bad last-good duplicate key[\s\S]*?UTF-8 BOM[\s\S]*?UTF-16 BOM/u);
    assert.doesNotMatch(inspectorProvenanceVerifier, /actualJson -cne expectedJson/u);
    const managedLauncherManagedSource = await readFile(
      "src/runtime/execution/windows-managed-launcher-native.cs",
      "utf8",
    );
    assert.match(
      managedLauncherManagedSource,
      /DllImport[\s\S]*?CreateJobObjectW[\s\S]*?SetInformationJobObject[\s\S]*?CreateProcessW[\s\S]*?AssignProcessToJobObject[\s\S]*?ResumeThread/u,
    );
    assert.match(managedLauncherManagedSource, /0x00000004[\s\S]*?0x00002000/u);
    assert.match(managedLauncherManagedSource, /ParseLaunchPayload[\s\S]*?ValidateStrictJsonSyntax[\s\S]*?DeserializeObject[\s\S]*?RequireExactKeys/u);
    assert.match(managedLauncherManagedSource, /ParseJsonObject[\s\S]*?keys\.Add[\s\S]*?duplicate property/u);
    assert.match(managedLauncherManagedSource, /ValidatePayload/u);
    assert.match(managedLauncherManagedSource, /RequireString[\s\S]*?IndexOf\('\\0'\)[\s\S]*?RequireInt[\s\S]*?RequireBoolean/u);
    assert.match(managedLauncherManagedSource, /FileShare\.Read[\s\S]*?SHA256\.Create/u);
    assert.match(managedLauncherManagedSource, /GetFinalPathNameByHandleW[\s\S]*?requireExecutableBinding/u);
    assert.match(managedLauncherManagedSource, /releaseToken[\s\S]*?filesBoundToken[\s\S]*?continueToken[\s\S]*?ackToken/u);
    assert.match(managedLauncherManagedSource, /HMACSHA256[\s\S]*?RetireProgress[\s\S]*?ClearLaunchEnvironment/u);
    assert.match(managedLauncherManagedSource, /AssertBootstrapEnvironmentSanitized[\s\S]*?ApplyTargetEnvironmentOverrides[\s\S]*?CreateProcessW[\s\S]*?ClearTargetEnvironmentOverrides/u);
    assertManagedClosureSourceConformance(managedLauncherManagedSource);
    assert.match(managedLauncherManagedSource, /ContainManagedJobBeforeFileRelease[\s\S]*?TerminateJobObject[\s\S]*?ActiveProcesses == 0/u);
    assert.doesNotMatch(managedLauncherManagedSource, /Reflection\.Emit|Add-Type|Process\.Start|PowerShell/u);
    const managedLauncher = await readFile("src/runtime/execution/windows-managed-launcher-managed.exe");
    const managedLauncherProvenance = JSON.parse(
      await readFile("src/runtime/execution/windows-managed-launcher-managed.provenance.json", "utf8"),
    );
    const managedLauncherNativeSource = await readFile("src/runtime/execution/windows-managed-launcher-native-bootstrap.c", "utf8");
    const managedLauncherNative = await readFile("src/runtime/execution/windows-managed-launcher-native.exe");
    const managedLauncherNativeProvenance = JSON.parse(
      await readFile("src/runtime/execution/windows-managed-launcher-native.provenance.json", "utf8"),
    );
    assert.equal(
      managedLauncherProvenance.source.sha256,
      createHash("sha256").update(await readFile("src/runtime/execution/windows-managed-launcher-native.cs")).digest("hex"),
    );
    assert.equal(
      managedLauncherProvenance.binary.sha256,
      createHash("sha256").update(managedLauncher).digest("hex"),
    );
    assert.equal(managedLauncherProvenance.binary.byteLength, managedLauncher.byteLength);
    assert.equal(managedLauncherNativeProvenance.source.sha256, createHash("sha256").update(managedLauncherNativeSource).digest("hex"));
    assert.equal(managedLauncherNativeProvenance.managedLauncher.sha256, createHash("sha256").update(managedLauncher).digest("hex"));
    assert.equal(managedLauncherNativeProvenance.binary.sha256, createHash("sha256").update(managedLauncherNative).digest("hex"));
    assert.equal(managedLauncherNativeProvenance.binary.byteLength, managedLauncherNative.byteLength);
    assert.equal(managedLauncherNativeProvenance.binary.peTimestamp, "zero");
    assert.equal(managedLauncherNativeProvenance.binary.clrMetadata, "absent");
    assert.match(managedLauncherNativeSource, /SanitizeLoaderEnvironment[\s\S]*?VerifyPackageDirectory[\s\S]*?CreateProcessW[\s\S]*?WaitForSingleObject/u);
    assert.match(managedLauncherNativeSource, /VerifyPackageDirectory[\s\S]*?FILE_SHARE_READ \| FILE_SHARE_WRITE[\s\S]*?GetFinalPathNameByHandleW/u);
    assert.match(managedLauncherNativeSource, /MANAGED_LAUNCHER_BYTE_LENGTH[\s\S]*?MANAGED_LAUNCHER_SHA256/u);
    assert.doesNotMatch(managedLauncherNative.toString("ascii"), /BSJB/u);
    assert.deepEqual(
      await readFile("dist/runtime/execution/windows-managed-launcher-native.exe"),
      managedLauncherNative,
    );
    assert.deepEqual(
      JSON.parse(await readFile("dist/runtime/execution/windows-managed-launcher-native.provenance.json", "utf8")),
      managedLauncherNativeProvenance,
    );
    assert.deepEqual(await readFile("dist/runtime/execution/windows-managed-launcher-managed.exe"), managedLauncher);
    assert.deepEqual(JSON.parse(await readFile("dist/runtime/execution/windows-managed-launcher-managed.provenance.json", "utf8")), managedLauncherProvenance);
    await assert.rejects(
      readFile("src/runtime/execution/windows-managed-launcher.ps1"),
      { code: "ENOENT" },
    );
    await assert.rejects(
      readFile("dist/runtime/execution/windows-managed-launcher.ps1"),
      { code: "ENOENT" },
    );
    assert.match(packagedVerifier, /installedManagedLauncherNative[\s\S]*?reviewedManagedLauncherNativeProvenance/u);
    assert.match(packagedVerifier, /requirePathAbsent[\s\S]*?Retired installed PowerShell launcher/u);
    const supervisorSource = await readFile("src/runtime/execution/supervisor.ts", "utf8");
    const runtimeBinding = supervisorSource.match(
      /WINDOWS_MANAGED_LAUNCHER_BYTES\s*=\s*([0-9_]+);[\s\S]*?WINDOWS_MANAGED_LAUNCHER_SHA256\s*=\s*"([0-9a-f]{64})"/u,
    );
    assert.ok(runtimeBinding, "supervisor must bind the native launcher size and SHA-256 before spawning it");
    assert.equal(Number(runtimeBinding[1].replaceAll("_", "")), managedLauncherNativeProvenance.binary.byteLength);
    assert.equal(runtimeBinding[2], managedLauncherNativeProvenance.binary.sha256);
    assert.match(supervisorSource, /assertWindowsManagedLauncherIntegrity[\s\S]*?lstat[\s\S]*?realpath[\s\S]*?open[\s\S]*?handle\.stat[\s\S]*?handle\.readFile[\s\S]*?WINDOWS_MANAGED_LAUNCHER_SHA256/u);
    // Source conformance is supporting evidence; native rejection/ownership
    // behavior is exercised in process-ownership.test.js, not proved by a regex.
    assert.match(supervisorSource, /verifyWindowsManagedLauncherIntegrity[\s\S]*?withProcessControlDeadline[\s\S]*?createWindowsManagedLaunchState[\s\S]*?await\s+verifyWindowsManagedLauncherIntegrity\(\s*windowsManagedLaunchState\.launcherExecutable\s*,?\s*\);\s*child\s*=\s*managedProcessSpawner\(\s*windowsManagedLaunchState\.launcherExecutable\s*,/u);
    assert.match(supervisorSource, /isWindowsLoaderSensitiveEnvironmentName[\s\S]*?COR_[\s\S]*?CORECLR_[\s\S]*?COMPLUS_[\s\S]*?APPDOMAIN_MANAGER[\s\S]*?targetEnvironmentOverrides/u);
    assert.doesNotMatch(supervisorSource, /windows-managed-launcher\.ps1|WindowsPowerShell[\s\S]*?WINDOWS_MANAGED_LAUNCHER_PATH/u);
    const assetCopySource = await readFile("scripts/copy-runtime-assets.mjs", "utf8");
    assert.match(assetCopySource, /runtime\/process\/windows-process-inspector\.exe/u);
    assert.match(assetCopySource, /runtime\/process\/windows-process-inspector\.provenance\.json/u);
    assert.match(assetCopySource, /runtime\/security\/windows-dpapi-helper\.exe/u);
    assert.match(assetCopySource, /runtime\/security\/windows-dpapi-helper\.provenance\.json/u);
    assert.match(assetCopySource, /runtime\/execution\/windows-managed-launcher-native\.exe/u);
    assert.match(assetCopySource, /runtime\/execution\/windows-managed-launcher-native\.provenance\.json/u);
    assert.match(assetCopySource, /runtime\/execution\/windows-managed-launcher-managed\.exe/u);
    assert.match(assetCopySource, /runtime\/execution\/windows-managed-launcher-managed\.provenance\.json/u);
    assert.match(assetCopySource, /retiredAssets[\s\S]*?runtime\/execution\/windows-managed-launcher\.ps1[\s\S]*?rm/u);
    const packageManifest = JSON.parse(await readFile("package.json", "utf8"));
    assert.match(packageManifest.scripts.build, /copy-runtime-assets\.mjs/u);
  } finally {
    const closed = once(server, "close");
    server.close();
    server.closeAllConnections?.();
    await closed;
  }
});
