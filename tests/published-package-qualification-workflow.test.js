import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const workflowUrl = new URL(
  "../.github/workflows/published-package-qualification.yml",
  import.meta.url,
);
const prepareUrl = new URL(
  "../scripts/prepare-published-package-qualification.mjs",
  import.meta.url,
);
const aggregateUrl = new URL(
  "../scripts/verify-published-package-qualification-artifacts.mjs",
  import.meta.url,
);
const browserRunnerUrl = new URL(
  "./fixtures/real-admin-browser-runner.mjs",
  import.meta.url,
);

test("AC-4BZ.1 workflow qualifies only exact downloaded publications on all three terminal OS jobs", async () => {
  const workflow = await readFile(workflowUrl, "utf8");
  assert.match(workflow, /^name: Published Package Three-OS Qualification$/m);
  assert.match(workflow, /^on:\s*\n\s+workflow_dispatch:/m);
  assert.doesNotMatch(workflow, /\n\s+(?:pull_request|push|schedule):/u);
  for (const input of [
    "core_release_id",
    "core_release_tag",
    "core_revision",
    "core_npm_version",
    "core_win32_sha256",
    "core_linux_sha256",
    "core_darwin_sha256",
    "core_npm_integrity",
  ]) {
    assert.match(workflow, new RegExp(`^      ${input}:$`, "m"));
  }
  assert.match(
    workflow,
    /os: ubuntu-latest[\s\S]*?platform: linux[\s\S]*?os: windows-latest[\s\S]*?platform: win32[\s\S]*?os: macos-latest[\s\S]*?platform: darwin/,
  );
  assert.match(workflow, /ref: \$\{\{ github\.sha \}\}/);
  assert.match(
    workflow,
    /ADMIN_HARNESS_REVISION: f7abf981f8f0bbbbd7fdf352237fd84950d95ca3/,
  );
  assert.match(
    workflow,
    /repository: service-lasso\/lasso-serviceadmin[\s\S]*?ref: \$\{\{ env\.ADMIN_HARNESS_REVISION \}\}/,
  );
  assert.match(
    workflow,
    /test "\$\(git -C qualification\/admin rev-parse HEAD\)" = "\$ADMIN_HARNESS_REVISION"/,
  );
  assert.match(
    workflow,
    /node scripts\/prepare-published-package-qualification\.mjs/,
  );
  assert.doesNotMatch(
    workflow,
    /\bnpm ci\b|\bnpm run build\b|\bcontinue-on-error\b|\bmain\b|--force|screenshots|videos/iu,
  );
  const matrixJobStart = workflow.indexOf("  published-package-qualification:");
  const matrixStepsStart = workflow.indexOf("\n    steps:", matrixJobStart);
  const aggregateJobStart = workflow.indexOf(
    "  require-published-package-qualification:",
  );
  const aggregateStepsStart = workflow.indexOf(
    "\n    steps:",
    aggregateJobStart,
  );
  assert.doesNotMatch(
    workflow.slice(matrixJobStart, matrixStepsStart),
    /runner\.temp/,
  );
  assert.doesNotMatch(
    workflow.slice(aggregateJobStart, aggregateStepsStart),
    /runner\.temp/,
  );
  assert.equal((workflow.match(/\$\{\{ runner\.temp \}\}/g) ?? []).length, 4);

  for (const command of [
    "pnpm test:secrets:real-first-run-browser",
    "pnpm test:secrets:real-browser",
    "pnpm test:secrets:real-stopped-lifecycle-browser",
    "pnpm test:secrets:real-lockout-browser",
  ]) {
    assert.equal(
      (workflow.match(new RegExp(command.replaceAll(":", "\\:"), "g")) ?? [])
        .length,
      1,
    );
  }
  assert.match(
    workflow,
    /id: cleanup[\s\S]*?if: always\(\)[\s\S]*?cleanup-published-package-qualification\.mjs/,
  );
  assert.match(
    workflow,
    /actions\/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a[\s\S]*?if-no-files-found: error[\s\S]*?retention-days: 90/,
  );
  assert.equal(
    (
      workflow.match(
        /uses: actions\/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a/g,
      ) ?? []
    ).length,
    1,
  );
  assert.match(workflow, /gh run download "\$GITHUB_RUN_ID"/);
  assert.match(
    workflow,
    /verify-published-package-qualification-artifacts\.mjs/,
  );
  assert.match(
    workflow,
    /test '\$\{\{ needs\.published-package-qualification\.result \}\}' = 'success'/,
  );
  assert.match(workflow, /timeout-minutes: 90/);
  assert.doesNotMatch(workflow, /timeout-minutes: (?:1[0-9]{2}|[2-9][0-9]{2,})/);
});

test("AC-4BZ.1 preparation verifies every downloaded identity before creating the mutation root", async () => {
  const source = await readFile(prepareUrl, "utf8");
  const mutation = source.lastIndexOf(
    "await mkdir(mutationRoot, { recursive: true })",
  );
  assert.ok(mutation > 0);
  for (const marker of [
    "validateRelease(",
    "validateNpmMetadata(",
    "verifyNpmTarballIntegrity(",
    "parseChecksumManifest(",
    "runNegativeGuards({",
    "await assertMutationRootAbsent(mutationRoot)",
  ]) {
    assert.ok(
      source.lastIndexOf(marker, mutation) > 0,
      `${marker} must run before mutation`,
    );
  }
  assert.match(source, /for \(const relativePath of CORE_HARNESS_FILES\)/);
  assert.match(
    source,
    /extractPublishedPackageArchive\(files\.core, coreExtraction, platform\)/,
  );
  assert.doesNotMatch(source, /runCommand\("tar"/u);
  assert.match(source, /published_core_replaced_by_harness/);
  assert.match(source, /invokeCoreInstall\(coreRoot, "@serviceadmin"/);
  assert.match(source, /invokeCoreInstall\(coreRoot, "@secretsbroker"/);
  assert.match(source, /runNpmInstallWithRetry\(/);
  assert.match(source, /timeoutMs = 30_000/);
  assert.match(source, /classifyReadinessSample\(/);
  assert.doesNotMatch(source, /npm ci|npm run build/iu);
});

test("AC-4BZ.1 copied browser runner has no development-only TLS dependency", async () => {
  const source = await readFile(browserRunnerUrl, "utf8");
  assert.match(source, /generateLocalhostCertificate/u);
  assert.doesNotMatch(source, /from ["']selfsigned["']/u);
});

test("AC-4BZ.1 aggregate verifies current-attempt artifacts and retains prior-attempt failures", async () => {
  const source = await readFile(aggregateUrl, "utf8");
  assert.match(source, /selectCurrentAttemptArtifacts\(artifacts, runId, runAttempt\)/);
  assert.match(source, /validateRetainedArtifactMetadata\(artifact/);
  assert.match(source, /entries\.length !== 1/);
  assert.match(source, /validateTerminalJobMetadata\(matchingJobs\[0\]/);
  assert.match(source, /validateRetainedEvidence\(evidence/);
});
