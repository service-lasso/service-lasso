import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const workflowUrl = new URL(
  "../.github/workflows/packaged-admin-lifecycle.yml",
  import.meta.url,
);

test("AC-4BY.2 packaged Admin workflow binds exact checksum releases to three-OS browser acceptance", async () => {
  const workflow = await readFile(workflowUrl, "utf8");

  assert.match(workflow, /^name: Packaged Admin Lifecycle Acceptance$/m);
  assert.match(workflow, /pull_request:\s*\n\s+branches:\s*\n\s+- develop/);
  assert.match(workflow, /push:\s*\n\s+branches:\s*\n\s+- develop/);
  assert.match(
    workflow,
    /os: ubuntu-latest[\s\S]*?os: windows-latest[\s\S]*?os: macos-latest/,
  );

  assert.match(workflow, /repository: service-lasso\/lasso-serviceadmin/);
  assert.match(
    workflow,
    /Check out candidate Core[\s\S]*?ref: \$\{\{ github\.event_name == 'pull_request' && github\.event\.pull_request\.head\.sha \|\| github\.sha \}\}/,
  );
  assert.match(workflow, /ref: f015b4445b0526546a309301270186a697588166/);
  assert.match(workflow, /ADMIN_RELEASE_TAG: "2026\.8\.31-f015b44"/);
  assert.match(workflow, /BROKER_RELEASE_TAG: "2026\.8\.31-f340883"/);
  assert.match(
    workflow,
    /BROKER_REVISION: "f340883056ec3cf74b535fb46490b39382e8c823"/,
  );

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
  assert.match(workflow, /SERVICE_LASSO_REQUIRE_TEST_BROKER_BINARY: "1"/);
  assert.match(workflow, /& chmod \+x \$brokerBinary\.FullName/);
  assert.doesNotMatch(workflow, /& chmod \+x --/);

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
    /if \[ "\$RUNNER_OS" = "Windows" \]; then[\s\S]*?real-lockout-browser/,
  );

  assert.match(workflow, /retainedContent = 'metadata_only'/);
  assert.match(
    workflow,
    /uses: actions\/upload-artifact@b7c566a772e6b6bfb58ed0dc250532a479d7789f[\s\S]*?if-no-files-found: error[\s\S]*?retention-days: 90/,
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
