import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseDocument } from "yaml";
import { ADMIN_HARNESS_REVISION, ADMIN_RELEASE, BROKER_RELEASE } from "../scripts/published-package-qualification-lib.mjs";

const workflowUrl = new URL(
  "../.github/workflows/packaged-admin-lifecycle.yml",
  import.meta.url,
);
const candidateExpression = "${{ github.event_name == 'pull_request' && github.event.pull_request.head.sha || github.sha }}";
const eventExpression = "${{ github.sha }}";

function assertCandidateProjection(source) {
  const document = parseDocument(source, { uniqueKeys: true });
  assert.equal(document.errors.length, 0, document.errors.map(String).join("\n"));
  const workflow = document.toJS();
  assert.deepEqual(workflow.env, {
    QUALIFICATION_CANDIDATE_SHA: candidateExpression,
    QUALIFICATION_EVENT_SHA: eventExpression,
  });
  const lifecycleCheckout = workflow.jobs["packaged-admin-lifecycle"].steps.find((step) => step.name === "Check out candidate Core");
  const aggregateCheckout = workflow.jobs["require-packaged-admin-lifecycle"].steps.find((step) => step.name === "Check out exact aggregate verifier");
  assert.equal(lifecycleCheckout.with.ref, "${{ env.QUALIFICATION_CANDIDATE_SHA }}");
  assert.equal(aggregateCheckout.with.ref, "${{ env.QUALIFICATION_CANDIDATE_SHA }}");
  const custody = workflow.jobs["require-packaged-admin-lifecycle"].steps.find((step) => step.name === "Validate current-run receipt custody");
  assert.deepEqual(custody.env, {
    PACKAGED_ARTIFACTS_ROOT: "${{ runner.temp }}/packaged-admin-lifecycle-artifacts",
    QUALIFICATION_CANDIDATE_SHA: "${{ env.QUALIFICATION_CANDIDATE_SHA }}",
    QUALIFICATION_EVENT_SHA: "${{ env.QUALIFICATION_EVENT_SHA }}",
  });
}

test("AC-4BY.2 packaged Admin workflow binds exact checksum releases to three-OS browser acceptance", async () => {
  const workflow = await readFile(workflowUrl, "utf8");
  const document = parseDocument(workflow, { uniqueKeys: true });
  assert.equal(document.errors.length, 0, document.errors.map(String).join("\n"));
  const parsed = document.toJS();
  assertCandidateProjection(workflow);
  const expectedPaths = [
    ".github/workflows/packaged-admin-lifecycle.yml",
    "services/@serviceadmin/service.json",
    "services/@secretsbroker/service.json",
    "src/runtime/**",
    "src/server/**",
    "scripts/consume-admin-trusted-unlock-receipt.mjs",
    "scripts/admin-receipt-provider-observer.mjs",
    "scripts/admin-receipt-provider-bootstrap.mjs",
    "scripts/record-packaged-admin-first-custody.mjs",
    "scripts/project-packaged-admin-first-custody.mjs",
    "scripts/private-first-custody-v3-lib.mjs",
    "scripts/native-tool-journal-v4-lib.mjs",
    "scripts/exact-native-file-identity-lib.mjs",
    "scripts/first-custody-git-replay-lib.mjs",
    "scripts/public-first-custody-projection-lib.mjs",
    "scripts/resolve-pnpm-action-entrypoint.mjs",
    "scripts/establish-admin-trusted-unlock-receipt-caller.mjs",
    "scripts/record-admin-trusted-unlock-prebrowser-failure.mjs",
    "scripts/retain-packaged-admin-lifecycle-receipt.mjs",
    "scripts/verify-packaged-admin-lifecycle-artifacts.mjs",
    "scripts/published-package-qualification-lib.mjs",
    "tests/fixtures/real-admin-browser-runner.mjs",
    "tests/consume-admin-trusted-unlock-receipt.test.js",
    "tests/admin-receipt-provider-observer.test.js",
    "tests/resolve-pnpm-action-entrypoint.test.js",
    "tests/packaged-admin-lifecycle-receipt-custody.test.js",
    "tests/packaged-admin-lifecycle-first-custody-execution.test.js",
    "tests/private-first-custody-v3.test.js",
    "tests/public-first-custody-projection.test.js",
    "tests/packaged-admin-lifecycle-workflow.test.js",
    "tests/prebrowser-failure-execution.test.js",
    "package.json",
    "package-lock.json",
  ];

  assert.match(workflow, /^name: Packaged Admin Lifecycle Acceptance$/m);
  assert.deepEqual(Object.keys(parsed.on).sort(), ["pull_request", "push", "workflow_dispatch"]);
  for (const trigger of ["pull_request", "push"]) {
    assert.deepEqual(parsed.on[trigger].branches, ["develop"]);
    assert.deepEqual(parsed.on[trigger].paths, expectedPaths);
  }
  assert.match(
    workflow,
    /os: ubuntu-latest[\s\S]*?os: windows-latest[\s\S]*?os: macos-latest/,
  );
  assert.match(workflow, /record-packaged-admin-first-custody\.mjs[\s\S]*?Set up Node/);

  assert.match(workflow, /repository: service-lasso\/lasso-serviceadmin/);
  assert.match(
    workflow,
    /ADMIN_REVISION: "f015b4445b0526546a309301270186a697588166"/,
  );
  assert.match(
    workflow,
    /ADMIN_HARNESS_REVISION: "90caf8cf0f8e3c599a1a5022936813ac8bf0983b"/,
  );
  assert.match(workflow, /ref: \$\{\{ env\.ADMIN_HARNESS_REVISION \}\}/);
  assert.match(workflow, /timeout-minutes: 60/);
  assert.equal(
    parsed.jobs["packaged-admin-lifecycle"].env.ADMIN_PLATFORM,
    "${{ matrix.admin_platform }}",
  );
  for (const marker of [
    "SERVICE_LASSO_INSTANCE_REGISTRY_PATH",
    "SERVICE_LASSO_HOST_PORT_REGISTRY_PATH",
    "QUALIFICATION_EVIDENCE_ROOT",
    "QUALIFICATION_INITIAL_RECEIPT_PATH",
  ]) assert.doesNotMatch(workflow.slice(workflow.indexOf("    env:"), workflow.indexOf("\n    steps:")), new RegExp(`${marker}:`));
  assert.match(
    workflow,
    /Establish unique qualification custody before dependencies[\s\S]*?qualification_root="\$RUNNER_TEMP\/packaged-admin-lifecycle-\$GITHUB_RUN_ID-\$GITHUB_JOB-\$GITHUB_RUN_ATTEMPT-\$ADMIN_PLATFORM"[\s\S]*?QUALIFICATION_WORKSPACE_ROOT=\$QUALIFICATION_WORKSPACE_ROOT[\s\S]*?SERVICE_LASSO_INSTANCE_REGISTRY_PATH=\$SERVICE_LASSO_INSTANCE_REGISTRY_PATH[\s\S]*?SERVICE_LASSO_HOST_PORT_REGISTRY_PATH=\$SERVICE_LASSO_HOST_PORT_REGISTRY_PATH[\s\S]*?record-packaged-admin-first-custody\.mjs[\s\S]*?test -s "\$QUALIFICATION_INITIAL_RECEIPT_PATH"/,
  );
  const custody=parsed.jobs["packaged-admin-lifecycle"].steps.find(step=>step.name==="Establish unique qualification custody before dependencies");assert.doesNotMatch(custody.run,/mkdir -p/u);assert.equal(parsed.jobs["packaged-admin-lifecycle"].env.QUALIFICATION_PLATFORM,"${{ matrix.admin_platform }}");
  assert.doesNotMatch(workflow, /(?:timeout|deadline)[^\n]*?(?:real-browser|consume-admin-trusted-unlock-receipt)/iu);
  assert.match(
    workflow,
    /test "\$admin_revision" = "\$ADMIN_HARNESS_REVISION"/,
  );
  assert.match(workflow, /ADMIN_RELEASE_TAG: "2026\.8\.31-f015b44"/);
  assert.match(workflow, /BROKER_RELEASE_TAG: "2026\.8\.31-f340883"/);
  assert.match(
    workflow,
    /BROKER_REVISION: "f340883056ec3cf74b535fb46490b39382e8c823"/,
  );
  assert.equal(ADMIN_RELEASE.id, "380051618");
  assert.equal(ADMIN_RELEASE.revision, "f015b4445b0526546a309301270186a697588166");
  assert.equal(ADMIN_HARNESS_REVISION, "90caf8cf0f8e3c599a1a5022936813ac8bf0983b");
  assert.equal(BROKER_RELEASE.revision, "f340883056ec3cf74b535fb46490b39382e8c823");

  for (const digest of [
    "fe5e5fe01d1202f3874097e6223652d634c94677c765c5f82d20e6d274c0161c",
    "8f80b124967fa1e0efe9fa4c6c0d3aaa9f4f64ffdd15d1180359d2c6185d3e71",
    "2b5cdd80861819a7eb6f92ed5743c208baae8b35e7f4232fd3df928f34bfcb81",
    "e64ee6a85c053c6dd68e2713477dae0620a458496bbd41077b55cc4c2df3f966",
    "3466c9adf01d14b202fd084705bfda11fef627206587a0ad1f62dbb6a6a4f295",
    "567b40bbd42881c5a4e12c2b8984ece9b5225d221ecf2d776fb541e330365ce5",
  ]) {
    assert.match(workflow, new RegExp(digest));
  }

  assert.equal(
    (workflow.match(/& node dist\/cli\.js install \$serviceId/g) ?? []).length,
    1,
  );
  assert.match(
    workflow,
    /Invoke-CoreInstall '@serviceadmin' \$servicesRoot \$workspaceRoot/,
  );
  assert.match(
    workflow,
    /Invoke-CoreInstall '@secretsbroker' \$servicesRoot \$workspaceRoot/,
  );
  assert.match(workflow, /checksum\.source -ne 'release-asset'/);
  assert.match(
    workflow,
    /checksum\.expected\.ToLowerInvariant\(\) -ne \$expectedSha/,
  );
  assert.match(
    workflow,
    /checksum\.actual\.ToLowerInvariant\(\) -ne \$expectedSha/,
  );
  assert.match(workflow, /SERVICE_LASSO_TEST_ADMIN_ROOT/);
  assert.match(workflow, /consume-admin-trusted-unlock-receipt\.mjs/);
  assert.match(
    workflow,
    /consume-admin-trusted-unlock-receipt\.mjs[\s\S]*?--receipt[\s\S]*?-- "\$ADMIN_PNPM_NODE" "\$ADMIN_PNPM_ENTRYPOINT" test:secrets:real-browser/,
  );
  assert.match(workflow, /id: pnpm-action-pinned-entrypoint[\s\S]*?dest: \$\{\{ runner\.temp \}\}\/pnpm-action-pinned-entrypoint/);
  assert.match(workflow, /PNPM_ACTION_BIN_DEST: \$\{\{ steps\.pnpm-action-pinned-entrypoint\.outputs\.bin_dest \}\}/);
  assert.match(workflow, /ADMIN_PLATFORM: \$\{\{ matrix\.admin_platform \}\}/);
  assert.doesNotMatch(workflow, /PNPM_HOME\/pnpm\.cjs|node_modules\/pnpm\/bin\/pnpm\.cjs/);
  assert.match(workflow, /node "\$GITHUB_WORKSPACE\/scripts\/establish-admin-trusted-unlock-receipt-caller\.mjs"/);
  assert.match(workflow, /SERVICE_LASSO_REQUIRE_TEST_BROKER_BINARY: "1"/);
  assert.match(workflow, /& chmod \+x \$brokerBinary\.FullName/);
  assert.doesNotMatch(workflow, /& chmod \+x --/);

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
    /if \[ "\$RUNNER_OS" = "Windows" \]; then[\s\S]*?real-lockout-browser/,
  );

  assert.match(workflow, /retainedContent = 'metadata_only'/);
  assert.match(workflow, /adminHarness = \[ordered\]@\{/);
  assert.match(workflow, /revision = \$env:ADMIN_HARNESS_REVISION/);
  assert.match(
    workflow,
    /uses: actions\/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a[\s\S]*?if-no-files-found: error[\s\S]*?retention-days: 90/,
  );
  assert.match(workflow, /mutationRetry = \$false/);
  assert.match(workflow, /comprehensive_lifecycle/);
  assert.doesNotMatch(
    workflow,
    /continue-on-error:\s*true|--force|Start-Sleep|screenshots|videos/i,
  );
  assert.match(
    workflow,
    /test '\$\{\{ needs\.packaged-admin-lifecycle\.result \}\}' = 'success'/,
  );
});

test("AC-4BY.2 producer retains each finite pre-browser failure with the matrix platform before record, upload, and aggregate", async () => {
  const workflow = await readFile(workflowUrl, "utf8");
  assert.match(workflow, /node "\$GITHUB_WORKSPACE\/scripts\/establish-admin-trusted-unlock-receipt-caller\.mjs"/);
  assert.match(workflow, /ADMIN_PLATFORM: \$\{\{ matrix\.admin_platform \}\}[\s\S]*?establish-admin-trusted-unlock-receipt-caller\.mjs/);
  assert.match(workflow, /if: always\(\)[\s\S]*?admin-trusted-unlock-prebrowser-failure\.json[\s\S]*?if-no-files-found: error/);
  assert.match(workflow, /require-packaged-admin-lifecycle:[\s\S]*?if: always\(\)[\s\S]*?test '\$\{\{ needs\.packaged-admin-lifecycle\.result \}\}' = 'success'/);
});

test("AC-4BY.2 rejects YAML scalar continuations that silently remove receipt-custody triggers", async () => {
  const workflow = await readFile(workflowUrl, "utf8");
  const malformed = workflow.replace(
    "\n      - scripts/retain-packaged-admin-lifecycle-receipt.mjs",
    "\n       - scripts/retain-packaged-admin-lifecycle-receipt.mjs",
  );
  const document = parseDocument(malformed, { uniqueKeys: true });
  assert.equal(document.errors.length, 0, document.errors.map(String).join("\n"));
  const paths = document.toJS().on.pull_request.paths;
  assert.ok(!paths.includes("scripts/retain-packaged-admin-lifecycle-receipt.mjs"));
});

test("AC-4BY.2 rejects parsed PR-head and synthetic-merge identity regressions", async () => {
  const workflow = await readFile(workflowUrl, "utf8");
  for (const [label, invalid] of [
    ["candidate projection", workflow.replace("QUALIFICATION_CANDIDATE_SHA: ${{ github.event_name == 'pull_request' && github.event.pull_request.head.sha || github.sha }}", "QUALIFICATION_CANDIDATE_SHA: ${{ github.sha }}")],
    ["candidate checkout", workflow.replace("ref: ${{ env.QUALIFICATION_CANDIDATE_SHA }}", "ref: ${{ github.sha }}")],
    ["aggregate event projection", workflow.split("\n").map((line) => line.trim() === "QUALIFICATION_EVENT_SHA: ${{ env.QUALIFICATION_EVENT_SHA }}" ? line.replace("QUALIFICATION_EVENT_SHA", "QUALIFICATION_CANDIDATE_SHA") : line).join("\n")],
  ]) assert.throws(() => assertCandidateProjection(invalid), label);
});
