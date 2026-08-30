import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { once } from "node:events";
import { promisify } from "node:util";
import AdmZip from "adm-zip";
import {
  MCP_PACKAGED_COVERAGE_KEYS,
  MCP_PRODUCT_EVIDENCE_CONTRACT,
  validateMcpProductEvidence,
} from "../scripts/mcp-product-acceptance-lib.mjs";

const execFileAsync = promisify(execFile);

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
      version: "1.30.0",
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
    assert.match(workflow, /scripts\/mcp-packaged-consumer-runner\.mjs/u);
    for (const governedRuntimePath of [
      ".gitattributes",
      "scripts/copy-runtime-assets.mjs",
      "scripts/verify-windows-process-inspector.ps1",
      "docs/reference/process-ownership-registry.md",
      "src/runtime/execution/supervisor.ts",
      "src/runtime/execution/windows-managed-launcher.ps1",
      "src/runtime/lifecycle/actions.ts",
      "src/runtime/process/identity.ts",
      "src/runtime/process/registry.ts",
      "src/runtime/process/tree.ts",
      "src/runtime/process/windows-process-inspector.cs",
      "src/runtime/process/windows-process-inspector.exe",
      "src/runtime/process/windows-process-inspector.provenance.json",
      "src/runtime/setup/definition-revision.ts",
      "tests/process-ownership.test.js",
    ]) {
      assert.equal(workflow.split(`- ${governedRuntimePath}`).length - 1, 2);
    }
    const gitAttributes = await readFile(".gitattributes", "utf8");
    assert.match(gitAttributes, /windows-process-inspector\.cs text eol=lf/u);
    assert.match(gitAttributes, /windows-process-inspector\.provenance\.json text eol=lf/u);
    assert.match(gitAttributes, /windows-process-inspector\.ps1 text eol=lf/u);
    assert.match(gitAttributes, /windows-process-inspector\.exe binary/u);

    const releaseWorkflow = await readFile(".github/workflows/release-qualification.yml", "utf8");
    assert.match(releaseWorkflow, /qualify-mcp-product:[\s\S]*?npm run test:mcp:product/u);
    assert.match(releaseWorkflow, /qualify-mcp-packaged:[\s\S]*?platform: win32[\s\S]*?platform: linux[\s\S]*?platform: darwin/u);
    assert.match(releaseWorkflow, /qualify-mcp-packaged:[\s\S]*?npm run verify:mcp:packaged/u);
    assert.match(releaseWorkflow, /MCP_PRODUCT_EVIDENCE_PATH: artifacts\/mcp-product-\$\{\{ matrix\.platform \}\}\.json[\s\S]*?path: artifacts\/mcp-product-\$\{\{ matrix\.platform \}\}\.json/u);
    assert.match(releaseWorkflow, /qualify-release:[\s\S]*?needs:[\s\S]*?- qualify-mcp-product[\s\S]*?- qualify-mcp-packaged/u);

    for (const workflowPath of [".github/workflows/publish-package.yml", ".github/workflows/release-artifact.yml"]) {
      const publicationWorkflow = await readFile(workflowPath, "utf8");
      assert.match(publicationWorkflow, /qualify-mcp-packaged:[\s\S]*?platform: win32[\s\S]*?platform: linux[\s\S]*?platform: darwin/u);
      assert.match(publicationWorkflow, /qualify-mcp-packaged:[\s\S]*?npm run verify:mcp:packaged/u);
      assert.match(publicationWorkflow, /MCP_PRODUCT_EVIDENCE_PATH: artifacts\/mcp-product-\$\{\{ matrix\.platform \}\}\.json[\s\S]*?path: artifacts\/mcp-product-\$\{\{ matrix\.platform \}\}\.json/u);
      assert.match(publicationWorkflow, /needs:[\s\S]*?- qualify-mcp-packaged/u);
      assert.match(publicationWorkflow, /retention-days: 90/u);
      assert.match(publicationWorkflow, /node scripts\/verify-mcp-product-artifact\.mjs/u);
    }

    const packagedVerifier = await readFile("scripts/verify-mcp-packaged.mjs", "utf8");
    assert.match(packagedVerifier, /const tempRoot = await realpath\(await mkdtemp/u);
    assert.match(packagedVerifier, /PSModulePath: path\.join\(process\.env\.SystemRoot, "System32", "WindowsPowerShell", "v1\.0", "Modules"\)/u);
    assert.match(packagedVerifier, /verifyWindowsProcessInspectorProvenance[\s\S]*?verify-windows-process-inspector\.ps1/u);
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
    const identitySource = await readFile("src/runtime/process/identity.ts", "utf8");
    assert.match(identitySource, /windows-process-inspector\.exe/u);
    assert.doesNotMatch(identitySource, /windows-process-inspector\.ps1|powershell\.exe/u);
    assert.doesNotMatch(identitySource, /setWindowsProcessInspectionTimeoutForTests|System\.Management\.ManagementObjectSearcher/u);
    assert.doesNotMatch(identitySource, /Get-CimInstance Win32_Process/u);
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
    const managedLauncherSource = await readFile("src/runtime/execution/windows-managed-launcher.ps1", "utf8");
    assert.match(managedLauncherSource, /CreateJobObjectW[\s\S]*?SetInformationJobObject[\s\S]*?CreateProcessW[\s\S]*?AssignProcessToJobObject[\s\S]*?ResumeThread/u);
    assert.match(managedLauncherSource, /0x2000[\s\S]*?0x00000004/u);
    assert.match(managedLauncherSource, /FileShare\]::Read/u);
    assert.match(managedLauncherSource, /SHA256/u);
    assert.match(managedLauncherSource, /GetFinalPathNameByHandleW[\s\S]*?requireExecutableBinding/u);
    assert.match(managedLauncherSource, /releaseToken[\s\S]*?filesBoundToken[\s\S]*?continueToken[\s\S]*?ackToken/u);
    assert.match(managedLauncherSource, /Test-ServiceLassoGateToken[\s\S]*?ConvertTo-Json -Compress/u);
    assert.doesNotMatch(managedLauncherSource, /Add-Type|Get-CimInstance|Win32_Process/u);
    assert.equal(
      await readFile("dist/runtime/execution/windows-managed-launcher.ps1", "utf8"),
      managedLauncherSource,
    );
    const assetCopySource = await readFile("scripts/copy-runtime-assets.mjs", "utf8");
    assert.match(assetCopySource, /runtime\/process\/windows-process-inspector\.exe/u);
    assert.match(assetCopySource, /runtime\/process\/windows-process-inspector\.provenance\.json/u);
    assert.match(assetCopySource, /runtime\/execution\/windows-managed-launcher\.ps1/u);
    const packageManifest = JSON.parse(await readFile("package.json", "utf8"));
    assert.match(packageManifest.scripts.build, /copy-runtime-assets\.mjs/u);
  } finally {
    const closed = once(server, "close");
    server.close();
    server.closeAllConnections?.();
    await closed;
  }
});
