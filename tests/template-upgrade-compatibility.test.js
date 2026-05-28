import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { execFile as execFileCallback } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { discoverServices } from "../dist/runtime/discovery/discoverServices.js";
import { runTemplateCliAction } from "../dist/runtime/cli/template.js";
import { buildTemplateUpgradeCompatibilityReport } from "../dist/runtime/template/upgrade-compatibility.js";

const execFile = promisify(execFileCallback);

async function makeTempInventory(prefix = "service-lasso-template-upgrade-") {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix));
  const currentRoot = path.join(root, "core-services");
  const targetRoot = path.join(root, "target-services");
  await mkdir(currentRoot, { recursive: true });
  await mkdir(targetRoot, { recursive: true });
  return { root, currentRoot, targetRoot };
}

async function writeManifest(servicesRoot, serviceId, body) {
  const serviceRoot = path.join(servicesRoot, serviceId);
  await mkdir(serviceRoot, { recursive: true });
  await writeFile(path.join(serviceRoot, "service.json"), JSON.stringify(body, null, 2));
}

function providerManifest(serviceId, tag, overrides = {}) {
  return {
    id: serviceId,
    name: serviceId + " Provider",
    description: "Provider fixture.",
    role: "provider",
    version: "1.0.0",
    artifact: {
      kind: "archive",
      source: {
        type: "github-release",
        repo: "service-lasso/" + serviceId.replace(/^@/, "lasso-"),
        tag,
      },
      platforms: {
        default: {
          assetName: serviceId.replace(/^@/, "") + ".zip",
          archiveType: "zip",
        },
        linux: {
          assetName: serviceId.replace(/^@/, "") + "-linux.zip",
          archiveType: "zip",
        },
      },
    },
    ...overrides,
  };
}

async function buildReport(currentRoot, targetRoot) {
  const [currentServices, targetServices] = await Promise.all([
    discoverServices(currentRoot),
    discoverServices(targetRoot),
  ]);

  return buildTemplateUpgradeCompatibilityReport({
    currentCoreRoot: currentRoot,
    targetServicesRoot: targetRoot,
    currentServices,
    targetServices,
  });
}

async function runCli(args, cwd = path.resolve(".")) {
  const cliPath = path.join(cwd, "dist", "cli.js");
  const result = await execFile(process.execPath, [cliPath, ...args], {
    cwd,
    env: {
      ...process.env,
      npm_package_version: "0.1.0-test",
    },
  });

  return result.stdout.trim();
}

test("template upgrade report accepts matching provider inventory", async () => {
  const { root, currentRoot, targetRoot } = await makeTempInventory("service-lasso-template-upgrade-ok-");

  try {
    await writeManifest(currentRoot, "@node", providerManifest("@node", "2026.5.20-current"));
    await writeManifest(targetRoot, "@node", providerManifest("@node", "2026.5.20-current"));
    await writeManifest(targetRoot, "reference-app", {
      id: "reference-app",
      name: "Reference App",
      description: "Template-style app using the node provider.",
      execservice: "@node",
    });

    const report = await buildReport(currentRoot, targetRoot);

    assert.equal(report.ok, true);
    assert.equal(report.status, "compatible");
    assert.equal(report.checkedProviders, 1);
    assert.deepEqual(report.findings, []);
    assert.deepEqual(report.providers, [{
      serviceId: "@node",
      currentReleaseTag: "2026.5.20-current",
      targetReleaseTag: "2026.5.20-current",
      status: "current",
    }]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("template upgrade report warns for missing optional providers and stale pins", async () => {
  const { root, currentRoot, targetRoot } = await makeTempInventory("service-lasso-template-upgrade-warn-");

  try {
    await writeManifest(currentRoot, "@node", providerManifest("@node", "2026.5.20-current"));
    await writeManifest(currentRoot, "@python", providerManifest("@python", "2026.5.20-current"));
    await writeManifest(targetRoot, "@node", providerManifest("@node", "2026.5.10-old"));
    await writeManifest(targetRoot, "reference-app", {
      id: "reference-app",
      name: "Reference App",
      description: "Template-style app using the node provider.",
      execservice: "@node",
    });

    const report = await buildReport(currentRoot, targetRoot);

    assert.equal(report.ok, true);
    assert.equal(report.status, "upgrade-advised");
    assert.equal(report.summary.errors, 0);
    assert.equal(report.summary.missingOptionalProviders, 1);
    assert.equal(report.summary.stalePins, 1);
    assert.ok(report.findings.some((finding) =>
      finding.kind === "missing-optional-provider" &&
      finding.serviceId === "@python" &&
      finding.severity === "warning"
    ));
    assert.ok(report.findings.some((finding) =>
      finding.kind === "provider-release-stale" &&
      finding.serviceId === "@node" &&
      finding.target.releaseTag === "2026.5.10-old" &&
      finding.current.releaseTag === "2026.5.20-current"
    ));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("template upgrade report blocks when referenced provider is missing or incompatible", async () => {
  const { root, currentRoot, targetRoot } = await makeTempInventory("service-lasso-template-upgrade-block-");

  try {
    await writeManifest(currentRoot, "@node", providerManifest("@node", "2026.5.20-current"));
    await writeManifest(currentRoot, "@python", providerManifest("@python", "2026.5.20-current"));
    await writeManifest(targetRoot, "@node", providerManifest("@node", "2026.5.20-current", {
      role: "service",
      artifact: {
        kind: "archive",
        source: {
          type: "github-release",
          repo: "service-lasso/forked-node",
          tag: "2026.5.20-current",
        },
        platforms: {
          win32: {
            assetName: "node-win32.zip",
            archiveType: "zip",
          },
        },
      },
    }));
    await writeManifest(targetRoot, "reference-app", {
      id: "reference-app",
      name: "Reference App",
      description: "Template-style app using missing provider.",
      execservice: "@python",
      setup: {
        steps: {
          seed: {
            execservice: "@unknown",
            args: ["seed.js"],
          },
        },
      },
      env: {
        API_TOKEN: "should-not-appear",
      },
    });

    const report = await buildReport(currentRoot, targetRoot);
    const serialized = JSON.stringify(report);

    assert.equal(report.ok, false);
    assert.equal(report.status, "blocked");
    assert.ok(report.findings.some((finding) =>
      finding.kind === "missing-required-provider" &&
      finding.serviceId === "@python" &&
      finding.severity === "error"
    ));
    assert.ok(report.findings.some((finding) =>
      finding.kind === "provider-role-mismatch" &&
      finding.serviceId === "@node" &&
      finding.severity === "error"
    ));
    assert.ok(report.findings.some((finding) =>
      finding.kind === "provider-source-mismatch" &&
      finding.serviceId === "@node" &&
      finding.severity === "error"
    ));
    assert.ok(report.findings.some((finding) =>
      finding.kind === "provider-platform-gap" &&
      finding.serviceId === "@node" &&
      finding.severity === "warning"
    ));
    assert.ok(report.findings.some((finding) =>
      finding.kind === "unknown-provider-reference" &&
      finding.serviceId === "@unknown" &&
      finding.severity === "warning"
    ));
    assert.equal(serialized.includes("should-not-appear"), false);
    assert.equal(serialized.includes("API_TOKEN"), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("template check-upgrade CLI emits machine-readable compatibility report", async () => {
  const { root, currentRoot, targetRoot } = await makeTempInventory("service-lasso-template-upgrade-cli-");

  try {
    await writeManifest(currentRoot, "@node", providerManifest("@node", "2026.5.20-current"));
    await writeManifest(targetRoot, "@node", providerManifest("@node", "2026.5.10-old"));

    const direct = await runTemplateCliAction({
      action: "check-upgrade",
      coreServicesRoot: currentRoot,
      targetServicesRoot: targetRoot,
    });
    const cli = JSON.parse(await runCli([
      "template",
      "check-upgrade",
      targetRoot,
      "--core-services-root",
      currentRoot,
      "--json",
    ]));

    assert.equal(direct.action, "check-upgrade");
    assert.equal(cli.action, "check-upgrade");
    assert.equal(cli.status, "upgrade-advised");
    assert.equal(cli.summary.stalePins, 1);
    assert.equal(cli.currentCoreRoot, path.resolve(currentRoot));
    assert.equal(cli.targetServicesRoot, path.resolve(targetRoot));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
