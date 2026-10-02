import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { strictJson } from "../scripts/consume-admin-trusted-unlock-receipt.mjs";

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

function run(command, args, environment) {
  return spawnSync(command, args, { encoding: "utf8", env: environment, shell: false });
}

function initialReceiptPath(root, platform) {
  return path.join(root, `published-package-qualification-431-published-package-qualification-2-${platform}`, "evidence", "initial-receipt.json");
}

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
    /ADMIN_HARNESS_REVISION: 90caf8cf0f8e3c599a1a5022936813ac8bf0983b/,
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
  assert.match(workflow, /consume-admin-trusted-unlock-receipt\.mjs/);
  assert.match(
    workflow,
    /consume-admin-trusted-unlock-receipt\.mjs[\s\S]*?--receipt[\s\S]*?-- "\$ADMIN_PNPM_NODE" "\$ADMIN_PNPM_ENTRYPOINT" test:secrets:real-browser/,
  );
  assert.match(workflow, /id: pnpm-action-pinned-entrypoint[\s\S]*?dest: \$\{\{ runner\.temp \}\}\/pnpm-action-pinned-entrypoint/);
  assert.match(workflow, /PNPM_ACTION_BIN_DEST: \$\{\{ steps\.pnpm-action-pinned-entrypoint\.outputs\.bin_dest \}\}/);
  assert.match(workflow, /QUALIFICATION_PLATFORM: \$\{\{ matrix\.platform \}\}/);
  assert.match(workflow, /node "\$GITHUB_WORKSPACE\/scripts\/establish-admin-trusted-unlock-receipt-caller\.mjs"/);
  assert.doesNotMatch(workflow, /PNPM_HOME\/pnpm\.cjs|node_modules\/pnpm\/bin\/pnpm\.cjs/);
  assert.doesNotMatch(workflow, /npm install --prefix "\$ADMIN_PNPM_PREFIX"/);
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
  const matrixJob = workflow.slice(matrixJobStart, matrixStepsStart);
  for (const marker of [
    "SERVICE_LASSO_INSTANCE_REGISTRY_PATH",
    "SERVICE_LASSO_HOST_PORT_REGISTRY_PATH",
    "QUALIFICATION_EVIDENCE_ROOT",
    "QUALIFICATION_INITIAL_RECEIPT_PATH",
  ]) assert.doesNotMatch(matrixJob, new RegExp(`${marker}:`));
  assert.doesNotMatch(
    workflow.slice(aggregateJobStart, aggregateStepsStart),
    /runner\.temp/,
  );
  assert.match(
    workflow,
    /Establish unique qualification custody before dependencies[\s\S]*?qualification_root="\$RUNNER_TEMP\/published-package-qualification-\$GITHUB_RUN_ID-\$GITHUB_JOB-\$GITHUB_RUN_ATTEMPT-\$QUALIFICATION_PLATFORM"[\s\S]*?QUALIFICATION_WORKSPACE_ROOT=\$SERVICE_LASSO_WORKSPACE_ROOT[\s\S]*?SERVICE_LASSO_INSTANCE_REGISTRY_PATH=\$SERVICE_LASSO_INSTANCE_REGISTRY_PATH[\s\S]*?SERVICE_LASSO_HOST_PORT_REGISTRY_PATH=\$SERVICE_LASSO_HOST_PORT_REGISTRY_PATH[\s\S]*?record-packaged-admin-first-custody\.mjs[\s\S]*?test -s "\$QUALIFICATION_INITIAL_RECEIPT_PATH"/,
  );

  for (const command of [
    "pnpm test:secrets:real-first-run-browser",
    "pnpm test:secrets:real-stopped-lifecycle-browser",
    "pnpm test:secrets:real-lockout-browser",
  ]) {
    assert.equal(
      (workflow.match(new RegExp(command.replaceAll(":", "\\:"), "g")) ?? [])
        .length,
      1,
    );
  }
  assert.doesNotMatch(workflow, /-- pnpm test:secrets:real-browser/);
  assert.match(
    workflow,
    /id: cleanup[\s\S]*?if: always\(\)[\s\S]*?cleanup-published-package-qualification\.mjs/,
  );
  assert.match(
    workflow,
    /actions\/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a[\s\S]*?if-no-files-found: error[\s\S]*?retention-days: 90/,
  );
  assert.match(workflow, /ADMIN_TRUSTED_UNLOCK_RECEIPT_PATH: \$\{\{ runner\.temp \}\}\/admin-trusted-unlock-receipt\.json/);
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

test("AC-4BZ.1 executes v2 first custody before dependencies for every published platform", { skip: process.platform === "win32" }, async () => {
  const workflow = await readFile(workflowUrl, "utf8");
  const start = workflow.indexOf("      - name: Establish unique qualification custody before dependencies");
  const end = workflow.indexOf("\n      - name: Set up Node", start);
  const step = workflow.slice(start, end);
  const script = step.slice(step.indexOf("run: |") + "run: |".length).replace(/^          /gm, "");
  const root = await mkdtemp(path.join(tmpdir(), "published-first-custody-"));
  try {
    for (const platform of ["linux", "win32", "darwin"]) {
      const environment = {
        PATH: process.env.PATH,
        RUNNER_TEMP: root,
        GITHUB_RUN_ID: "431",
        GITHUB_JOB: "published-package-qualification",
        GITHUB_RUN_ATTEMPT: "2",
        QUALIFICATION_PLATFORM: platform,
        GITHUB_ENV: path.join(root, `${platform}.github-env`),
        GITHUB_WORKSPACE: process.cwd(),
        QUALIFICATION_CANDIDATE_SHA: run("git", ["rev-parse", "HEAD"], { PATH: process.env.PATH }).stdout.trim(),
      };
      const result = run("bash", ["-c", script], environment);
      assert.equal(result.status, 0, result.stderr);
      const receipt = JSON.parse(await readFile(initialReceiptPath(root, platform), "utf8"));
      assert.equal(receipt.schema, "service-lasso.qualification-initial-receipt.v2");
      assert.equal(receipt.platform, platform);
      assert.equal(receipt.private, true);
      assert.equal(receipt.ownedPaths.length, 12);
      assert.deepEqual(receipt.registries.map(({ state }) => state), ["ABSENT", "ABSENT"]);
      const exported = await readFile(environment.GITHUB_ENV, "utf8");
      for (const name of ["SERVICE_LASSO_WORKSPACE_ROOT", "SERVICE_LASSO_INSTANCE_REGISTRY_PATH", "SERVICE_LASSO_HOST_PORT_REGISTRY_PATH", "QUALIFICATION_INITIAL_RECEIPT_PATH"]) assert.match(exported, new RegExp(`^${name}=.+`, "m"));
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
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
  assert.match(source, /npm_consumer_cli_failed/);
  assert.match(source, /npm_consumer_runtime_probe_failed/);
  assert.doesNotMatch(source, /safeState\.[^;\n]*(?:stdout|stderr)|(?:stdout|stderr)[^;\n]*safeState\./u);
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
  assert.match(source, /entries\.length !== 3/);
  assert.match(source, /admin-trusted-unlock-receipt\.json/);
  assert.match(source, /initial-receipt\.json/);
  assert.match(source, /validateTerminalJobMetadata\(matchingJobs\[0\]/);
  assert.match(source, /requireTerminalPrebrowserJob\(jobs, platform, runId, runAttempt\)/);
  assert.match(source, /validateRetainedEvidence\(evidence/);
  assert.match(source, /parseStrictJson\(/);
  assert.match(source, /parseStrictJson\([\s\S]*?retained trusted-unlock receipt/);
});

test("AC-4BZ.1 downloaded aggregate JSON rejects raw and escaped duplicate keys before closed-shape validation", () => {
  for (const source of [
    '{"platform":"linux","platform":"linux"}',
    '{"platform":"linux","plat\\u0066orm":"linux"}',
    '{"trustedUnlock":{"classification":"closed","receipt":{"status":"observed","status":"observed"}}}',
  ]) assert.equal(strictJson(source), null);
  // These are syntactically strict, but must still be rejected by the aggregate's
  // exact closed-shape and metadata-only validators after decoding.
  assert.ok(strictJson('{"platform":"linux","private":true}'));
  assert.ok(strictJson('{"platform":"linux","retained":{"extra":true}}'));
});
