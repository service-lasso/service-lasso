import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const workflowUrl = new URL("../.github/workflows/packaged-admin-lifecycle.yml", import.meta.url);

test("AC-4BY.2 packaged Admin workflow binds exact checksum releases to three-OS browser acceptance", async () => {
  const workflow = await readFile(workflowUrl, "utf8");

  assert.match(workflow, /^name: Packaged Admin Lifecycle Acceptance$/m);
  assert.match(workflow, /pull_request:\s*\n\s+branches:\s*\n\s+- develop/);
  assert.match(workflow, /push:\s*\n\s+branches:\s*\n\s+- develop/);
  assert.match(workflow, /os: ubuntu-latest[\s\S]*?os: windows-latest[\s\S]*?os: macos-latest/);

  assert.match(workflow, /repository: service-lasso\/lasso-serviceadmin/);
  assert.match(
    workflow,
    /Check out candidate Core[\s\S]*?ref: \$\{\{ github\.event_name == 'pull_request' && github\.event\.pull_request\.head\.sha \|\| github\.sha \}\}/,
  );
  assert.match(workflow, /ref: b393c70ba834d0da6c1cdb0039f304dd14bf9e79/);
  assert.match(workflow, /ADMIN_RELEASE_TAG: "2026\.8\.27-b393c70"/);
  assert.match(workflow, /BROKER_RELEASE_TAG: "2026\.8\.25-41f7206"/);
  assert.match(workflow, /BROKER_REVISION: "41f7206f90a624582fa53397304b8d6c3536b24b"/);

  for (const digest of [
    "839729e1818f9ff4c0ed33e44c580c2f19582f204b4e003ef0fde9456280e31d",
    "9cf43a9ee2a7881834bb3d1141cba148d02ccb8d6e69e0cb1e1ade4941e1bd71",
    "7bdb7ca27488265e5ff00bdae3e23b53679f5423cece8495de6943ee66a781c1",
    "1bb86e6b03026e535c24b1dd00368022334f67d66d6f3af118251d29b5db7b8b",
    "952856d8b4d82772de2e3aa2b66708a2f154565a13941f4c723216f3a2765807",
    "735fb84fb6139ff36f25907f1f56d00cd731375b338cea1657c4944f899cf3c6",
  ]) {
    assert.match(workflow, new RegExp(digest));
  }

  assert.equal((workflow.match(/& node dist\/cli\.js install \$serviceId/g) ?? []).length, 1);
  assert.match(workflow, /Invoke-CoreInstall '@serviceadmin' \$servicesRoot \$workspaceRoot/);
  assert.match(workflow, /Invoke-CoreInstall '@secretsbroker' \$servicesRoot \$workspaceRoot/);
  assert.match(workflow, /checksum\.source -ne 'release-asset'/);
  assert.match(workflow, /checksum\.expected\.ToLowerInvariant\(\) -ne \$expectedSha/);
  assert.match(workflow, /checksum\.actual\.ToLowerInvariant\(\) -ne \$expectedSha/);
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
    assert.equal((workflow.match(new RegExp(command.replaceAll(":", "\\:"), "g")) ?? []).length, 1);
  }
  assert.match(workflow, /if \[ "\$RUNNER_OS" = "Windows" \]; then[\s\S]*?real-lockout-browser/);

  assert.match(workflow, /retainedContent = 'metadata_only'/);
  assert.match(workflow, /uses: actions\/upload-artifact@v6[\s\S]*?if-no-files-found: error[\s\S]*?retention-days: 90/);
  assert.match(workflow, /mutationRetry = \$false/);
  assert.match(workflow, /comprehensive_lifecycle/);
  assert.doesNotMatch(workflow, /continue-on-error:\s*true|--force|Start-Sleep|screenshots|videos/i);
  assert.match(workflow, /test '\$\{\{ needs\.packaged-admin-lifecycle\.result \}\}' = 'success'/);
});
