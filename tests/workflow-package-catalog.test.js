import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import {
  assertWorkflowCatalogSecretSafe,
  exampleWorkflowPackageCatalog,
  listWorkflowPackagesSecretSafe,
  loadWorkflowCatalogFromDirectories,
  validateWorkflowCatalogEntries,
  validateWorkflowPackageMetadata,
  workflowCatalogNamespacePolicy,
  workflowPackageCatalogEndpoints,
} from "../dist/platform/workflowCatalog.js";

const repoRoot = process.cwd();

async function writeWorkflowPackage(root, packageDir, body) {
  const packageRoot = path.join(root, packageDir);
  await mkdir(packageRoot, { recursive: true });
  await writeFile(path.join(packageRoot, "workflow-package.json"), JSON.stringify(body, null, 2));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

test("workflow package catalog exposes list and validate endpoints plus namespace policy", () => {
  assert.deepEqual(workflowPackageCatalogEndpoints, {
    list: "GET /api/platform/workflow-packages",
    validate: "POST /api/platform/workflow-packages/validate",
  });
  assert.equal(workflowCatalogNamespacePolicy.official.idPrefix, "official.");
  assert.equal(workflowCatalogNamespacePolicy.custom.idPrefix, "custom.");
  assert.match(workflowCatalogNamespacePolicy.custom.overridePolicy, /additive overlays/i);
});

test("example catalog lists official and custom packages without raw secrets", () => {
  const listed = listWorkflowPackagesSecretSafe(exampleWorkflowPackageCatalog);
  assert.deepEqual(
    listed.map((pkg) => [pkg.id, pkg.source, pkg.repository.repo]),
    [
      ["official.core.maintenance", "official", "service-lasso/workflows-core"],
      ["custom.local.reporting", "custom", "file://./workflows/custom-reporting"],
    ],
  );
  assert.equal(listed[0].secrets?.[0].ref, "maintenance.API_TOKEN");
  assert.equal(JSON.stringify(listed).includes("raw-workflow-secret"), false);
  assert.doesNotThrow(() => assertWorkflowCatalogSecretSafe(listed));
});

test("workflow catalog loads official and custom package metadata from local directories", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "service-lasso-workflow-catalog-"));
  const officialRoot = path.join(tempRoot, "official");
  const customRoot = path.join(tempRoot, "custom");

  try {
    await writeWorkflowPackage(officialRoot, "core-maintenance", exampleWorkflowPackageCatalog[0].metadata);
    await writeWorkflowPackage(customRoot, "local-reporting", exampleWorkflowPackageCatalog[1].metadata);

    const result = await loadWorkflowCatalogFromDirectories([
      { root: officialRoot, source: "official" },
      { root: customRoot, source: "custom" },
    ]);

    assert.equal(result.ok, true);
    assert.equal(result.diagnostics.length, 0);
    assert.deepEqual(
      result.entries.map((entry) => entry.metadata.id).sort(),
      ["custom.local.reporting", "official.core.maintenance"],
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("workflow catalog validation rejects missing repository engine and source with diagnostics", () => {
  const missing = clone(exampleWorkflowPackageCatalog[0].metadata);
  delete missing.repository;
  delete missing.engine;
  const missingDiagnostics = validateWorkflowPackageMetadata(missing);
  assert.deepEqual(
    missingDiagnostics.map((diagnostic) => [diagnostic.code, diagnostic.field]).filter(([code]) => code === "missing-field"),
    [
      ["missing-field", "repository"],
      ["missing-field", "engine"],
    ],
  );

  const invalid = clone(exampleWorkflowPackageCatalog[0].metadata);
  delete invalid.source;
  invalid.repository = { repo: "", ref: "" };
  invalid.engine = { engine: "unknown", versionRange: "" };
  const invalidDiagnostics = validateWorkflowPackageMetadata(invalid);
  assert.deepEqual(
    invalidDiagnostics.map((diagnostic) => [diagnostic.code, diagnostic.field]).filter(([_, field]) => ["source", "repository.repo", "repository.ref", "engine.engine", "engine.versionRange"].includes(field)),
    [
      ["invalid-field", "source"],
      ["missing-field", "repository.repo"],
      ["missing-field", "repository.ref"],
      ["invalid-field", "engine.engine"],
      ["missing-field", "engine.versionRange"],
    ],
  );
  assert.ok(invalidDiagnostics.every((diagnostic) => diagnostic.action.length > 0));
});

test("workflow catalog validation rejects invalid namespaces and reports actionable diagnostics", () => {
  const invalid = clone(exampleWorkflowPackageCatalog[0].metadata);
  invalid.id = "core-maintenance";
  invalid.workflows = ["official.core.maintenance/backup-check"];
  invalid.configs = [{ path: "unsafe/defaults.yaml" }];
  invalid.tools = [{ id: "maintenance.tool", command: "echo" }];

  const diagnostics = validateWorkflowPackageMetadata(invalid);
  assert.equal(diagnostics.every((diagnostic) => diagnostic.severity === "error"), true);
  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.code),
    ["invalid-namespace", "invalid-namespace", "invalid-namespace", "invalid-namespace"],
  );
  assert.ok(diagnostics.every((diagnostic) => diagnostic.action.length > 0));
});

test("custom packages cannot collide with official workflow ids config paths or tools", () => {
  const official = clone(exampleWorkflowPackageCatalog[0]);
  const custom = clone(exampleWorkflowPackageCatalog[1]);
  custom.metadata.id = "custom.core.maintenance";
  custom.metadata.workflows = [official.metadata.workflows[0]];
  custom.metadata.configs = [{ path: official.metadata.configs[0].path }];
  custom.metadata.tools = [{ id: official.metadata.tools[0].id, command: "custom-tool" }];

  const result = validateWorkflowCatalogEntries([official, custom]);
  assert.equal(result.ok, false);
  const diagnosticCodes = result.diagnostics.map((diagnostic) => diagnostic.code);
  for (const expectedCode of [
    "config-path-collision",
    "invalid-namespace",
    "tool-collision",
    "workflow-collision",
  ]) {
    assert.ok(diagnosticCodes.includes(expectedCode), `Expected ${expectedCode}`);
  }
  assert.ok(result.diagnostics.every((diagnostic) => /Rename|Use/.test(diagnostic.action)));
});

test("workflow catalog rejects raw secrets while allowing broker secret refs", () => {
  const safe = clone(exampleWorkflowPackageCatalog[1].metadata);
  assert.equal(validateWorkflowPackageMetadata(safe).length, 0);

  const unsafe = clone(safe);
  unsafe.validation = [
    {
      name: "bad validation",
      command: "curl",
      args: ["--header", "Authorization: Bearer raw-workflow-secret"],
    },
  ];
  const diagnostics = validateWorkflowPackageMetadata(unsafe);
  assert.equal(diagnostics.some((diagnostic) => diagnostic.code === "secret-material"), true);
  assert.throws(() => assertWorkflowCatalogSecretSafe(unsafe), /secret-like material/);
});

test("workflow catalog docs cover official custom overrides support warnings and validation", async () => {
  const docs = await readFile(path.join(repoRoot, "docs", "reference", "workflow-package-catalog.md"), "utf8");
  for (const requiredText of [
    "official/core",
    "custom workflow repositories",
    "workflow-package.json",
    "id, version, repo/ref, owner",
    "engine requirements",
    "validation commands",
    "additive custom packages",
    "Invalid/colliding workflow packages fail validation",
    "raw secrets",
  ]) {
    assert.ok(docs.includes(requiredText), `Expected docs to include ${requiredText}`);
  }
});
