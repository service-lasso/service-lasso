import { createProtectedCliFixture } from "./fixtures/protected-operator-cli.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { assertExactCliRelease, assertExactToolRelease, CURRENT_CLI_RELEASE, CURRENT_TUI_RELEASE, bootstrapReleaseMetadataToken, consumeReleaseMetadataToken, operatorToolFailureDiagnostic, takeBootstrappedReleaseMetadataToken, stageOperatorTools, verifyRetainedOperatorTools } from "../scripts/operator-tool-packaging-lib.mjs";

const hash = (value) => createHash("sha256").update(value).digest("hex");
const assets = ["darwin-amd64", "darwin-arm64", "linux-amd64", "win32-amd64"].map(platform => ({ platform, name: `service-lasso-tui-2026.9.30-9ac25a1-${platform}.${platform === "win32-amd64" ? "zip" : "tar.gz"}`, sha256: hash(platform) }));
const tuiSums = Buffer.from(assets.map(asset => `${asset.sha256}  ${asset.name}`).join("\n") + "\n");
const tuiCandidate = Buffer.from(JSON.stringify({ schemaVersion: 2, kind: "develop-prerelease-candidate", version: "2026.9.30-9ac25a1", corePackagingIssue: "service-lasso/service-lasso#1461", source: { repository: "service-lasso/service-lasso-tui", ref: "refs/heads/develop", commit: "9ac25a1bb8c63d9f564743e7ee0c8956304b1db3" }, release: { tag: "candidate-2026.9.30-9ac25a1", prerelease: true, draft: false, immutable: true }, checksumManifest: { name: "SHA256SUMS.txt", sha256: hash(tuiSums) }, assets: assets.map(asset => ({ ...asset, executable: asset.platform === "win32-amd64" ? "service-lasso-tui.exe" : "service-lasso-tui" })) }));
const release = { repository: "service-lasso/service-lasso-tui", tag: "candidate-2026.9.30-9ac25a1", targetCommit: "9ac25a1bb8c63d9f564743e7ee0c8956304b1db3", checksumManifest: { name: "SHA256SUMS.txt", sha256: hash(tuiSums) }, candidateManifest: { name: "candidate-manifest.json", sha256: hash(tuiCandidate) }, assets };
const { cliRelease, held: cliHeld } = createProtectedCliFixture();
const cliCandidate = cliHeld.get("candidate.json"), cliSums = cliHeld.get("SHA256SUMS.txt");
function projectCompleteSuiteEnvironment(workflow, githubToken) {
  const productsJob = workflow.match(/^  qualify-products:\r?\n([\s\S]*?)(?=^  [a-z][a-z-]*:\r?$)/mu)?.[1];
  assert.ok(productsJob, "Release Qualification must retain qualify-products");
  const completeSuiteStart = productsJob.indexOf("      - name: Run complete test suite\n");
  assert.notEqual(completeSuiteStart, -1, "Release Qualification must retain the complete-suite step");
  const nextStep = productsJob.indexOf("\n      - name:", completeSuiteStart + 1);
  const completeSuiteStep = productsJob.slice(completeSuiteStart, nextStep === -1 ? undefined : nextStep);
  assert.ok(completeSuiteStep, "Release Qualification must retain the complete-suite step");
  const tokenProjection = completeSuiteStep.match(/^          SERVICE_LASSO_RELEASE_METADATA_TOKEN: (.+)$/mu)?.[1];
  assert.equal(tokenProjection, "${{ github.token }}");
  assert.match(completeSuiteStep, /^        run: npm run build && node --test /mu);
  assert.doesNotMatch(completeSuiteStep, /(?:echo|printf|Out-File).*SERVICE_LASSO_RELEASE_METADATA_TOKEN/u);
  return { SERVICE_LASSO_RELEASE_METADATA_TOKEN: githubToken };
}

function projectWorkflowStepEnvironment(workflow, stepName, githubToken) {
  const stepStart = workflow.indexOf(`      - name: ${stepName}\n`);
  assert.notEqual(stepStart, -1, `workflow must retain ${stepName}`);
  const nextStep = workflow.indexOf("\n      - name:", stepStart + 1);
  const step = workflow.slice(stepStart, nextStep === -1 ? undefined : nextStep);
  const tokenProjection = step.match(/^          SERVICE_LASSO_RELEASE_METADATA_TOKEN: (.+)$/mu)?.[1];
  assert.equal(tokenProjection, "${{ github.token }}", `${stepName} must project only the existing GitHub token under the staging contract`);
  assert.doesNotMatch(step, /(?:echo|printf|Out-File).*SERVICE_LASSO_RELEASE_METADATA_TOKEN/u);
  return { SERVICE_LASSO_RELEASE_METADATA_TOKEN: githubToken };
}

function fixtureOperatorToolModule() {
  return [
    `export const CURRENT_TUI_RELEASE = ${JSON.stringify(release)};`,
    `export const CURRENT_CLI_RELEASE = ${JSON.stringify(cliRelease)};`,
  ].join("\n");
}

async function importFixtureStagers(root) {
  const scriptsRoot = path.resolve("scripts");
  const operatorSource = await readFile(path.join(scriptsRoot, "operator-tool-packaging-lib.mjs"), "utf8");
  const operatorModulePath = path.join(root, "operator-tool-packaging-lib.mjs");
  const releaseModulePath = path.join(root, "release-artifact-lib.mjs");
  const publishModulePath = path.join(root, "publish-package-lib.mjs");
  const operatorModuleUrl = pathToFileURL(operatorModulePath).href;
  const releaseModuleUrl = pathToFileURL(releaseModulePath).href;
  const npmCommandModuleUrl = pathToFileURL(path.join(scriptsRoot, "npm-command-lib.mjs")).href;
  const originalOperatorRecords = operatorSource.slice(
    operatorSource.indexOf("export const CURRENT_TUI_RELEASE ="),
    operatorSource.indexOf("export function assertExactToolRelease"),
  );
  assert.ok(originalOperatorRecords.startsWith("export const CURRENT_TUI_RELEASE"));
  await writeFile(operatorModulePath, operatorSource.replace(originalOperatorRecords, fixtureOperatorToolModule()).replace("./ga-platform-scope-lib.mjs", pathToFileURL(path.join(scriptsRoot, "ga-platform-scope-lib.mjs")).href).replace("./scoped-provider-readback-lib.mjs", pathToFileURL(path.join(scriptsRoot, "scoped-provider-readback-lib.mjs")).href).replace("./operator-tool-cli-contract.mjs", pathToFileURL(path.join(scriptsRoot, "operator-tool-cli-contract.mjs")).href));

  const releaseSource = await readFile(path.join(scriptsRoot, "release-artifact-lib.mjs"), "utf8");
  await writeFile(releaseModulePath, releaseSource
    .replace("./ga-platform-scope-lib.mjs", pathToFileURL(path.join(scriptsRoot, "ga-platform-scope-lib.mjs")).href)
    .replace("../dist/runtime/files/safe-zip.js", pathToFileURL(path.join(path.resolve(), "dist", "runtime", "files", "safe-zip.js")).href)
    .replace("./release-asset-policy.mjs", pathToFileURL(path.join(scriptsRoot, "release-asset-policy.mjs")).href)
    .replace("./release-version-lib.mjs", pathToFileURL(path.join(scriptsRoot, "release-version-lib.mjs")).href)
    .replace("./npm-command-lib.mjs", npmCommandModuleUrl)
    .replace("./operator-tool-packaging-lib.mjs", operatorModuleUrl));

  const publishSource = await readFile(path.join(scriptsRoot, "publish-package-lib.mjs"), "utf8");
  await writeFile(publishModulePath, publishSource
    .replace("./ga-platform-scope-lib.mjs", pathToFileURL(path.join(scriptsRoot, "ga-platform-scope-lib.mjs")).href)
    .replace("./release-artifact-lib.mjs", releaseModuleUrl)
    .replace("./release-version-lib.mjs", pathToFileURL(path.join(scriptsRoot, "release-version-lib.mjs")).href)
    .replace("./npm-command-lib.mjs", npmCommandModuleUrl)
    .replace("./operator-tool-packaging-lib.mjs", operatorModuleUrl));

  return {
    ...(await import(`${releaseModuleUrl}?fixture=${Date.now()}`)),
    ...(await import(`${pathToFileURL(publishModulePath).href}?fixture=${Date.now()}`)),
  };
}

function fixtureReleaseFetch({ metadataAuthorization, assetAuthorization }) {
  const fixtureAssets = new Map([
    ...assets.map((asset) => [asset.name, Buffer.from(asset.platform)]),
    ...cliHeld,
  ]);
  const candidateAssets = (candidate, includesCli) => {
    const listed = includesCli
      ? [...cliRelease.assets, cliRelease.developmentManifest, cliRelease.checksumManifest]
      : [...assets, release.checksumManifest, release.candidateManifest];
    return listed.map((asset, index) => ({
      name: asset.name,
      digest: `sha256:${asset.sha256}`,
      url: `https://api.github.com/repos/${candidate.repository}/releases/assets/${index + 1}`,
    }));
  };
  return async (url, options = {}) => {
    const parsed = new URL(url);
    assert.equal(
      process.env.SERVICE_LASSO_RELEASE_METADATA_TOKEN,
      undefined,
      "child staging must not retain the metadata token in process environment",
    );
    if (parsed.hostname === "api.github.com") {
      metadataAuthorization.push(options.headers?.authorization);
      const isCli = parsed.pathname.includes("service-lasso-cli");
      const candidate = isCli ? cliRelease : release;
      if (parsed.pathname === `/repos/${candidate.repository}/git/ref/tags/${candidate.tag}`) return Response.json({ ref: `refs/tags/${candidate.tag}`, object: { type: "commit", sha: candidate.targetCommit } });
      assert.equal(parsed.pathname, `/repos/${candidate.repository}/releases/tags/${candidate.tag}`);
      return Response.json({ tag_name: candidate.tag, target_commitish: candidate.targetCommit, prerelease: true, draft: false, immutable: true, assets: candidateAssets(candidate, isCli) });
    }
    assetAuthorization.push(options.headers?.authorization);
    assert.equal(parsed.hostname, "github.com");
    const isCli = parsed.pathname.includes("service-lasso-cli");
    const name = parsed.pathname.split("/").at(-1);
    const bytes = name === "SHA256SUMS.txt"
      ? (isCli ? cliSums : tuiSums)
      : name === "candidate-manifest.json"
        ? tuiCandidate
        : name === "candidate.json"
          ? cliCandidate
          : fixtureAssets.get(name);
    assert.ok(bytes, `closed fixture must contain ${parsed.pathname}`);
    return new Response(bytes, { status: 200 });
  };
}

test("every release stage that can retain operator tools projects the restricted metadata token", async () => {
  const qualification = await readFile(".github/workflows/release-qualification.yml", "utf8");
  const packagePublication = await readFile(".github/workflows/publish-package.yml", "utf8");
  const artifactPublication = await readFile(".github/workflows/release-artifact.yml", "utf8");

  for (const [workflow, stepName] of [
    [qualification, "Run complete test suite"],
    [qualification, "Verify release artifacts"],
    [qualification, "Verify publishable package"],
    [packagePublication, "Run tests"],
    [packagePublication, "Verify bounded runtime artifact"],
    [packagePublication, "Verify publishable package"],
    [artifactPublication, "Run tests"],
    [artifactPublication, "Verify bounded release artifact"],
  ]) {
    assert.deepEqual(projectWorkflowStepEnvironment(workflow, stepName, "projected-read-token"), {
      SERVICE_LASSO_RELEASE_METADATA_TOKEN: "projected-read-token",
    });
  }

  for (const entrypoint of ["scripts/release-artifact.mjs", "scripts/release-verify.mjs"]) {
    const source = await readFile(entrypoint, "utf8");
    assert.match(source, /import \{ consumeReleaseMetadataToken \} from "\.\/operator-tool-packaging-lib\.mjs";/u);
    assert.match(source, /const releaseMetadataToken = consumeReleaseMetadataToken\(\);/u);
    assert.match(source, /stageReleaseArtifact\(\{ repoRoot, releaseMetadataToken \}\)/u);
    assert.match(source, /stageBundledReleaseArtifact\(\{ repoRoot, releaseMetadataToken \}\)/u);
    assert.doesNotMatch(source, /process\.env\.SERVICE_LASSO_RELEASE_METADATA_TOKEN\s*=/u);
  }
});

test("workflow-projected metadata token stages package, normal, and bundled artifacts through closed fixture routes", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "operator-tool-stagers-"));
  const metadataAuthorization = [];
  const assetAuthorization = [];
  const originalFetch = globalThis.fetch;
  const originalToken = process.env.SERVICE_LASSO_RELEASE_METADATA_TOKEN;
  const originalOffline = process.env.npm_config_offline;
  const expectedToken = "projected-read-token";
  try {
    globalThis.fetch = fixtureReleaseFetch({ metadataAuthorization, assetAuthorization });
    process.env.npm_config_offline = "true";
    const { stagePublishedPackage, stageReleaseArtifact, stageBundledReleaseArtifact } = await importFixtureStagers(root);

    process.env.SERVICE_LASSO_RELEASE_METADATA_TOKEN = expectedToken;
    const published = stagePublishedPackage({
      repoRoot: path.resolve(),
      outputRoot: path.join(root, "package"),
      version: "0.1.0-stage.fixture",
    });
    assert.equal(process.env.SERVICE_LASSO_RELEASE_METADATA_TOKEN, undefined);
    const stagedPackage = await published;
    assert.equal(stagedPackage.manifest.operatorToolsManifest, "operator-tools/manifest.json");

    process.env.SERVICE_LASSO_RELEASE_METADATA_TOKEN = ` ${expectedToken} `;
    const releaseMetadataToken = consumeReleaseMetadataToken();
    assert.equal(releaseMetadataToken, expectedToken);
    assert.equal(process.env.SERVICE_LASSO_RELEASE_METADATA_TOKEN, undefined);
    const released = stageReleaseArtifact({
      repoRoot: path.resolve(),
      outputRoot: path.join(root, "release"),
      version: "0.1.0-stage.fixture",
      releaseMetadataToken,
    });
    assert.equal(process.env.SERVICE_LASSO_RELEASE_METADATA_TOKEN, undefined);
    const stagedRelease = await released;
    assert.equal(stagedRelease.manifest.operatorToolsManifest, "operator-tools/manifest.json");

    const bundled = stageBundledReleaseArtifact({
      repoRoot: path.resolve(),
      outputRoot: path.join(root, "bundled-release"),
      version: "0.1.0-stage.fixture",
      serviceIds: [],
      releaseMetadataToken,
    });
    assert.equal(process.env.SERVICE_LASSO_RELEASE_METADATA_TOKEN, undefined);
    const stagedBundled = await bundled;
    assert.equal(stagedBundled.manifest.operatorToolsManifest, "operator-tools/manifest.json");

    assert.deepEqual(metadataAuthorization, Array(12).fill("Bearer projected-read-token"));
    assert.ok(assetAuthorization.length > 0);
    assert.ok(assetAuthorization.every((authorization) => authorization === undefined));
  } finally {
    globalThis.fetch = originalFetch;
    if (originalToken === undefined) delete process.env.SERVICE_LASSO_RELEASE_METADATA_TOKEN;
    else process.env.SERVICE_LASSO_RELEASE_METADATA_TOKEN = originalToken;
    if (originalOffline === undefined) delete process.env.npm_config_offline;
    else process.env.npm_config_offline = originalOffline;
    await rm(root, { recursive: true, force: true });
  }
});

test("one consumed metadata credential survives artifact then package staging without environment reacquisition", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "operator-tool-versioning-"));
  const metadataAuthorization = [];
  const assetAuthorization = [];
  const originalFetch = globalThis.fetch;
  const originalToken = process.env.SERVICE_LASSO_RELEASE_METADATA_TOKEN;
  const originalOffline = process.env.npm_config_offline;
  const expectedToken = "versioning-fixture-token";
  try {
    const fixtureFetch = fixtureReleaseFetch({ metadataAuthorization, assetAuthorization });
    globalThis.fetch = async (url, options = {}) => {
      if (new URL(url).hostname === "api.github.com") {
        assert.ok(options.headers?.authorization === `Bearer ${expectedToken}`, "both stagers must authenticate every metadata read with the retained local");
      } else {
        assert.equal(options.headers?.authorization, undefined);
      }
      return fixtureFetch(url, options);
    };
    process.env.npm_config_offline = "true";
    const { stageReleaseArtifact, stagePublishedPackage } = await importFixtureStagers(root);
    process.env.SERVICE_LASSO_RELEASE_METADATA_TOKEN = ` ${expectedToken} `;
    const releaseMetadataToken = consumeReleaseMetadataToken();
    assert.equal(process.env.SERVICE_LASSO_RELEASE_METADATA_TOKEN, undefined);

    const released = stageReleaseArtifact({
      repoRoot: path.resolve(),
      outputRoot: path.join(root, "release"),
      version: "0.1.0-versioning.fixture",
      releaseMetadataToken,
    });
    assert.equal(process.env.SERVICE_LASSO_RELEASE_METADATA_TOKEN, undefined);
    const stagedRelease = await released;
    assert.equal(stagedRelease.manifest.operatorToolsManifest, "operator-tools/manifest.json");
    const firstStageMetadataCount = metadataAuthorization.length;
    assert.equal(firstStageMetadataCount, 4);

    const published = stagePublishedPackage({
      repoRoot: path.resolve(),
      outputRoot: path.join(root, "package"),
      version: "0.1.0-versioning.fixture",
      releaseMetadataToken,
    });
    assert.equal(process.env.SERVICE_LASSO_RELEASE_METADATA_TOKEN, undefined);
    const stagedPackage = await published;
    assert.equal(stagedPackage.manifest.operatorToolsManifest, "operator-tools/manifest.json");
    assert.equal(metadataAuthorization.length - firstStageMetadataCount, 4);
    assert.ok(assetAuthorization.length > 0);
    assert.ok(assetAuthorization.every(authorization => authorization === undefined));
    assert.equal(process.env.SERVICE_LASSO_RELEASE_METADATA_TOKEN, undefined);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalToken === undefined) delete process.env.SERVICE_LASSO_RELEASE_METADATA_TOKEN;
    else process.env.SERVICE_LASSO_RELEASE_METADATA_TOKEN = originalToken;
    if (originalOffline === undefined) delete process.env.npm_config_offline;
    else process.env.npm_config_offline = originalOffline;
    await rm(root, { recursive: true, force: true });
  }
});

test("operator tools stage only checksum-verified release bytes", async () => {
  const sums = tuiSums;
  const root = await mkdtemp(path.join(os.tmpdir(), "operator-tools-"));
  const downloadHosts = [];
  const metadataAuthorization = [];
  const assetAuthorization = [];
  try {
    const workflow = await readFile(".github/workflows/release-qualification.yml", "utf8");
    const completeSuiteEnvironment = projectCompleteSuiteEnvironment(workflow, "test-read-token");
    const releaseMetadataToken = consumeReleaseMetadataToken(completeSuiteEnvironment);
    assert.equal("SERVICE_LASSO_RELEASE_METADATA_TOKEN" in completeSuiteEnvironment, false);
    const fetchImpl = async (url, options = {}) => {
		const parsed = new URL(url);
		if (parsed.hostname === "api.github.com" && parsed.pathname.includes("/releases/assets/")) {
      assetAuthorization.push(options.headers?.authorization);

			const cli = parsed.pathname.includes("service-lasso-cli");
			const listed = cli ? [...cliRelease.assets, cliRelease.developmentManifest, cliRelease.checksumManifest] : [...assets, release.checksumManifest, release.candidateManifest];
			const asset = listed[Number(parsed.pathname.split("/").at(-1)) - 1];
			const body = asset.name === "SHA256SUMS.txt" ? (cli ? cliSums : sums) : Buffer.from(assets.find((candidate) => candidate.name === asset.name)?.platform ?? (cliHeld.has(asset.name) ? cliHeld.get(asset.name) : asset.name === "candidate-manifest.json" ? tuiCandidate : asset.name === "candidate.json" ? cliCandidate : ""));
			return new Response(body, { status: 200 });
		}
		if (parsed.hostname === "api.github.com") {
      metadataAuthorization.push(options.headers?.authorization);
			const cli = parsed.pathname.includes("service-lasso-cli");
			const listed = cli ? [...cliRelease.assets, cliRelease.developmentManifest, cliRelease.checksumManifest] : [...assets, release.checksumManifest, release.candidateManifest];
      const candidate = cli ? cliRelease : release;
      if (parsed.pathname === `/repos/${candidate.repository}/git/ref/tags/${candidate.tag}`) return Response.json({ ref: `refs/tags/${candidate.tag}`, object: { type: "commit", sha: candidate.targetCommit } });
      return Response.json({ tag_name: cli ? cliRelease.tag : release.tag, target_commitish: cli ? cliRelease.targetCommit : release.targetCommit, prerelease: true, draft: false, immutable: true, assets: listed.map((asset, index) => ({ name: asset.name, digest: `sha256:${asset.sha256}`, url: `https://api.github.com/repos/service-lasso/${cli ? "service-lasso-cli" : "service-lasso-tui"}/releases/assets/${index + 1}` })) });
		}
		const cli = parsed.pathname.includes("service-lasso-cli");
    assetAuthorization.push(options.headers?.authorization);
		downloadHosts.push(parsed.hostname);
		const name = parsed.pathname.split("/").at(-1);
		const body = name === "SHA256SUMS.txt" ? (cli ? cliSums : sums) : Buffer.from(assets.find((asset) => asset.name === name)?.platform ?? (cliHeld.has(name) ? cliHeld.get(name) : name === "candidate-manifest.json" ? tuiCandidate : name === "candidate.json" ? cliCandidate : ""));
		return new Response(body, { status: 200 });
    };
    const manifest = await stageOperatorTools({ artifactRoot: root, fetchImpl, release, cliRelease, releaseMetadataToken });
    assert.equal(manifest.tools[0].command, "service-lassoctl");
    assert.equal(manifest.tools[0].status, "available");
    assert.equal(manifest.tools[0].candidateManifest.relativePath, "operator-tools/service-lassoctl/candidate.json");
    assert.deepEqual(manifest.tools[0].supportedPlatforms, ["win32", "linux", "darwin"]);
    assert.equal(manifest.tools[1].assets.length, 4);
    assert.equal(manifest.tools[1].candidateManifest.relativePath, "operator-tools/service-lasso-tui/candidate-manifest.json");
    assert.equal(await readFile(path.join(root, "operator-tools", "service-lasso-tui", assets[0].name), "utf8"), assets[0].platform);
    const retained = await verifyRetainedOperatorTools({ artifactRoot: root });
    assert.deepEqual(retained.manifest.tools[0].supportedPlatforms, ["win32", "linux", "darwin"]);
    assert.deepEqual([...new Set(downloadHosts)], ["github.com"]);
    assert.deepEqual(metadataAuthorization, Array(4).fill("Bearer test-read-token"));
    assert.ok(assetAuthorization.every((authorization) => authorization === undefined));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("operator tool identity rejects incomplete platform inventory", () => {
  assertExactToolRelease(CURRENT_TUI_RELEASE);
  assertExactCliRelease(CURRENT_CLI_RELEASE);
  assert.deepEqual(
    { tag: CURRENT_TUI_RELEASE.tag, targetCommit: CURRENT_TUI_RELEASE.targetCommit, assets: CURRENT_TUI_RELEASE.assets.map((asset) => asset.name) },
    { tag: "candidate-2026.9.30-0fa84ce", targetCommit: "0fa84ce38630e7f5b0066d2aaa103c55b0485c06", assets: ["service-lasso-tui-2026.9.30-0fa84ce-win32-amd64.zip", "service-lasso-tui-2026.9.30-0fa84ce-linux-amd64.tar.gz", "service-lasso-tui-2026.9.30-0fa84ce-darwin-amd64.tar.gz", "service-lasso-tui-2026.9.30-0fa84ce-darwin-arm64.tar.gz"] },
  );
  assert.deepEqual(
    { tag: CURRENT_CLI_RELEASE.tag, version: CURRENT_CLI_RELEASE.version, targetCommit: CURRENT_CLI_RELEASE.targetCommit, asset: CURRENT_CLI_RELEASE.asset, checksumManifest: CURRENT_CLI_RELEASE.checksumManifest, candidateManifest: CURRENT_CLI_RELEASE.candidateManifest },
    {
      tag: "cli-v0.1.0-dev.24d756e-candidate-24d756e",
      version: "0.1.0-dev.24d756e",
      targetCommit: "24d756e3706ae06cb4858562ddd6824b1e21d886",
      asset: { name: "service-lassoctl-0.1.0-dev.24d756e.tgz", sha256: "2e9f675b1399e5f97c284ca61d508b2f70304de7aa211afcf588e9420dc47e26" },
      checksumManifest: { name: "SHA256SUMS.txt", sha256: "d8f79fa36307e5369bb452026d2b555de72c4b4121d98a0f5ff1a56d2e74f261" },
      candidateManifest: { name: "candidate.json", sha256: "6bfd8c776fb936b0bee3921fbbbe7ea7c820a3201f9361d8f64957f3f5ba1530" },
    },
  );
  assert.throws(() => assertExactToolRelease({ ...release, assets: release.assets.slice(1) }), /incomplete/u);
  assert.throws(() => assertExactCliRelease({ ...cliRelease, repository: "other/cli" }), /identity/u);
  assert.throws(() => assertExactCliRelease({ ...cliRelease, tag: "latest" }), /identity/u);
});

test("release metadata token is consumed and removed before child work", () => {
  const environment = { SERVICE_LASSO_RELEASE_METADATA_TOKEN: " test-read-token " };
  assert.equal(consumeReleaseMetadataToken(environment), "test-read-token");
  assert.equal("SERVICE_LASSO_RELEASE_METADATA_TOKEN" in environment, false);
  const bootstrapEnvironment = { SERVICE_LASSO_RELEASE_METADATA_TOKEN: "bootstrap-token" };
  bootstrapReleaseMetadataToken(bootstrapEnvironment);
  assert.equal("SERVICE_LASSO_RELEASE_METADATA_TOKEN" in bootstrapEnvironment, false);
  assert.equal(takeBootstrappedReleaseMetadataToken(), "bootstrap-token");
  assert.equal(takeBootstrappedReleaseMetadataToken(), undefined);
});

test("operator tools expose only a fixed release-metadata failure class", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "operator-tools-metadata-"));
  try {
    await assert.rejects(stageOperatorTools({ artifactRoot: root, fetchImpl: async () => new Response(null, { status: 403 }), release, cliRelease: null, releaseMetadataToken: "denied-read-token" }), (error) => {
      assert.deepEqual(operatorToolFailureDiagnostic(error), { boundary: "github_release_metadata", httpStatus: 403 });
      return true;
    });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("operator tools reject a release whose mutability state changes", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "operator-tools-mutability-"));
  try {
    const frozenFetch = async () => Response.json({ tag_name: release.tag, target_commitish: release.targetCommit, prerelease: true, draft: false, immutable: false, assets: [] });
    await assert.rejects(stageOperatorTools({ artifactRoot: root, fetchImpl: frozenFetch, release, cliRelease: null }), /immutable candidate identity/u);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("operator tools reject duplicate or mismatched GitHub release inventory", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "operator-tools-duplicate-"));
  try {
    const duplicateFetch = async () => Response.json({ tag_name: release.tag, target_commitish: release.targetCommit, prerelease: true, draft: false, immutable: true, assets: [{ name: assets[0].name, digest: `sha256:${assets[0].sha256}`, url: "https://api.github.com/repos/service-lasso/service-lasso-tui/releases/assets/1" }, { name: assets[0].name, digest: `sha256:${assets[0].sha256}`, url: "https://api.github.com/repos/service-lasso/service-lasso-tui/releases/assets/2" }, ...assets.slice(1).map((asset, index) => ({ name: asset.name, digest: `sha256:${asset.sha256}`, url: `https://api.github.com/repos/service-lasso/service-lasso-tui/releases/assets/${index + 3}` })), { name: release.checksumManifest.name, digest: `sha256:${release.checksumManifest.sha256}`, url: "https://api.github.com/repos/service-lasso/service-lasso-tui/releases/assets/7" }, { name: release.candidateManifest.name, digest: `sha256:${release.candidateManifest.sha256}`, url: "https://api.github.com/repos/service-lasso/service-lasso-tui/releases/assets/8" }] });
    await assert.rejects(stageOperatorTools({ artifactRoot: root, fetchImpl: duplicateFetch, release }), /duplicate|inventory/u);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("operator tools reject a pinned candidate manifest with mismatched source identity", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "operator-tools-candidate-"));
  const sums = tuiSums;
  const mismatchedRelease = { ...release, targetCommit: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" };
  try {
    const fetchImpl = async (url) => {
      const parsed = new URL(url);
      if (parsed.pathname.includes("/releases/tags/")) return Response.json({ tag_name: mismatchedRelease.tag, target_commitish: mismatchedRelease.targetCommit, prerelease: true, draft: false, immutable: true, assets: [...assets, mismatchedRelease.checksumManifest, mismatchedRelease.candidateManifest].map((asset, index) => ({ name: asset.name, digest: `sha256:${asset.sha256}`, url: `https://api.github.com/repos/service-lasso/service-lasso-tui/releases/assets/${index + 1}` })) });
      const name = parsed.pathname.split("/").at(-1);
      const body = name === "SHA256SUMS.txt" ? sums : name === "candidate-manifest.json" ? tuiCandidate : Buffer.from(assets.find((asset) => asset.name === name)?.platform ?? "");
      return new Response(body);
    };
    await assert.rejects(stageOperatorTools({ artifactRoot: root, fetchImpl, release: mismatchedRelease, cliRelease: null }), /candidate manifest|release identity/u);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("operator tools retry only a transient 5xx asset response before checksum verification", async () => {
  const retryAssets = assets;
  const retrySums = tuiSums;
  const retryCandidate = tuiCandidate;
  const retryRelease = release;
  const root = await mkdtemp(path.join(os.tmpdir(), "operator-tools-retry-"));
  let checksumAttempts = 0;
  try {
    const fetchImpl = async (url) => {
      const parsed = new URL(url);
      if (parsed.pathname.includes("/git/ref/tags/")) return Response.json({ ref: `refs/tags/${retryRelease.tag}`, object: { type: "commit", sha: retryRelease.targetCommit } });
      if (parsed.pathname.includes("/releases/tags/")) return Response.json({ tag_name: retryRelease.tag, target_commitish: retryRelease.targetCommit, prerelease: true, draft: false, immutable: true, assets: [...retryAssets, retryRelease.checksumManifest, retryRelease.candidateManifest].map((asset, index) => ({ name: asset.name, digest: `sha256:${asset.sha256}`, url: `https://api.github.com/repos/service-lasso/service-lasso-tui/releases/assets/${index + 1}` })) });
      const asset = parsed.hostname === "github.com" ? [...retryAssets, retryRelease.checksumManifest, retryRelease.candidateManifest].find((candidate) => candidate.name === parsed.pathname.split("/").at(-1)) : [...retryAssets, retryRelease.checksumManifest, retryRelease.candidateManifest][Number(parsed.pathname.split("/").at(-1)) - 1];
      if (asset.name === "SHA256SUMS.txt" && checksumAttempts++ === 0) return new Response("temporary upstream failure", { status: 500 });
      const body = asset.name === "SHA256SUMS.txt" ? retrySums : asset.name === "candidate-manifest.json" ? retryCandidate : Buffer.from(asset.platform);
      return new Response(body, { status: 200 });
    };
    const manifest = await stageOperatorTools({ artifactRoot: root, fetchImpl, release: retryRelease, cliRelease: null });
    assert.equal(checksumAttempts, 2);
    assert.equal(manifest.tools[1].status, "available");
  } finally { await rm(root, { recursive: true, force: true }); }
});
