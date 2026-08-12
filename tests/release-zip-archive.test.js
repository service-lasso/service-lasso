import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  createReleaseZipArchive,
  verifyReleaseZipArchive,
} from "../scripts/release-artifact-lib.mjs";

test("release ZIP preserves canonical entrypoints when a workspace link aliases the core package", async () => {
  const outputRoot = await mkdtemp(path.join(tmpdir(), "service-lasso-release-zip-alias-"));
  const artifactName = "service-lasso-zip-alias-fixture";
  const artifactRoot = path.join(outputRoot, artifactName);
  const coreRoot = path.join(artifactRoot, "packages", "core");

  try {
    await mkdir(path.join(artifactRoot, "dist"), { recursive: true });
    await mkdir(coreRoot, { recursive: true });
    await mkdir(path.join(artifactRoot, "node_modules", "@service-lasso"), { recursive: true });
    await writeFile(path.join(artifactRoot, "dist", "index.js"), "export const runtime = true;\n", "utf8");
    await writeFile(path.join(artifactRoot, "dist", "cli.js"), 'console.log("release-zip-cli-ok");\n', "utf8");
    await writeFile(path.join(coreRoot, "index.js"), "export const wrapper = true;\n", "utf8");
    await writeFile(path.join(coreRoot, "index.d.ts"), "export declare const wrapper: true;\n", "utf8");
    await writeFile(path.join(coreRoot, "cli.js"), '#!/usr/bin/env node\nawait import("../../dist/cli.js");\n', "utf8");
    await writeFile(path.join(coreRoot, "package.json"), '{"name":"@service-lasso/service-lasso","type":"module"}\n', "utf8");
    await writeFile(path.join(coreRoot, "README.md"), "# Core wrapper\n", "utf8");
    await symlink(
      coreRoot,
      path.join(artifactRoot, "node_modules", "@service-lasso", "service-lasso"),
      process.platform === "win32" ? "junction" : "dir",
    );
    await writeFile(
      path.join(artifactRoot, "release-artifact.json"),
      `${JSON.stringify({
        artifactName,
        entrypoints: {
          runtime: "dist/index.js",
          corePackage: "packages/core/index.js",
          cli: "packages/core/cli.js",
        },
      })}\n`,
      "utf8",
    );

    const archivePath = await createReleaseZipArchive(outputRoot, artifactName);
    const verified = await verifyReleaseZipArchive({ archivePath, artifactName });

    assert.deepEqual(verified.verifiedEntrypoints, verified.manifest.entrypoints);
    assert.deepEqual(verified.verifiedCorePackageFiles, ["README.md", "package.json", "index.js", "index.d.ts", "cli.js"]);
    assert.match(verified.cli.stdout, /release-zip-cli-ok/u);
  } finally {
    await rm(outputRoot, { recursive: true, force: true });
  }
});

test("release ZIP rejects unsupported top-level symbolic links", async () => {
  const outputRoot = await mkdtemp(path.join(tmpdir(), "service-lasso-release-zip-link-"));
  const artifactName = "service-lasso-zip-link-fixture";
  const artifactRoot = path.join(outputRoot, artifactName);
  const outsideDirectory = path.join(outputRoot, "outside");

  try {
    await mkdir(artifactRoot, { recursive: true });
    await mkdir(outsideDirectory, { recursive: true });
    await writeFile(path.join(outsideDirectory, "outside.txt"), "outside release payload\n", "utf8");
    await symlink(outsideDirectory, path.join(artifactRoot, "redirected"), process.platform === "win32" ? "junction" : "dir");

    await assert.rejects(
      createReleaseZipArchive(outputRoot, artifactName),
      /Unsupported top-level release artifact entry: redirected/u,
    );
  } finally {
    await rm(outputRoot, { recursive: true, force: true });
  }
});
