import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { ZipArchive } from "./helpers/zip-fixture.mjs";
import { selectArtifactPlatform } from "../dist/runtime/setup/artifact-platform.js";
import { serviceArtifactSupportsHostPlatform } from "../dist/runtime/cli/bootstrap.js";
import { getExpectedServiceLockfileEntry } from "../dist/runtime/lockfile/service-lockfile.js";
import { buildServiceCompatibilityReport } from "../dist/runtime/operator/catalog-compatibility.js";
import { ServiceRegistry } from "../dist/runtime/manager/ServiceRegistry.js";
import { acquireInstallArtifact } from "../dist/runtime/setup/acquire.js";
import { downloadServiceUpdateCandidate, installServiceUpdateCandidate } from "../dist/runtime/updates/actions.js";
import { checkServiceUpdate } from "../dist/runtime/updates/check.js";

const definition = (assetName) => ({ archiveType: "zip", assetName });
const service = (platforms, serviceRoot = "/unused/artifact") => ({ serviceRoot, manifestPath: path.join(serviceRoot, "service.json"), manifest: {
  id: "architecture-fixture", name: "Architecture fixture", version: "2026.1.1-old",
  artifact: { kind: "archive", source: { type: "github-release", repo: "fixture/architecture", tag: "2026.1.1-old" }, platforms },
} });

test("AC-1993-1/2 exact architecture wins, legacy OS/default remain, wrong architecture is rejected", () => {
  for (const [platform, arch] of [["linux", "x64"], ["win32", "x64"], ["darwin", "arm64"], ["darwin", "x64"]]) {
    const key = `${platform}-${arch}`;
    const platforms = { [key]: definition(key), [platform]: definition("os"), default: definition("default") };
    assert.equal(selectArtifactPlatform(platforms, platform, arch).platformKey, key);
    delete platforms[key];
    assert.equal(selectArtifactPlatform(platforms, platform, arch).platformKey, platform);
    delete platforms[platform];
    assert.equal(selectArtifactPlatform(platforms, platform, arch).platformKey, "default");
    assert.equal(selectArtifactPlatform({ [key]: definition(key) }, platform, "s390x"), null);
  }
  assert.equal(selectArtifactPlatform(undefined), null);
  assert.equal(selectArtifactPlatform({}, "linux", "x64"), null);
  assert.equal(selectArtifactPlatform(Object.create({ "linux-x64": definition("inherited") }), "linux", "x64"), null);
});

test("AC-1993-3/4 baseline, lockfile and catalog agree without changing public OS fields", () => {
  for (const [platform, arch] of [["linux", "x64"], ["win32", "x64"], ["darwin", "arm64"]]) {
    const key = `${platform}-${arch}`;
    const item = service({ [key]: definition(key) });
    assert.equal(serviceArtifactSupportsHostPlatform(item, platform, arch), true);
    assert.equal(getExpectedServiceLockfileEntry(item, platform, arch).platform, key);
    const report = buildServiceCompatibilityReport(item, new ServiceRegistry([item]), { hostPlatform: platform, hostArch: arch });
    assert.equal(report.status, "compatible");
    assert.equal(report.hostPlatform, platform);
    assert.deepEqual(report.supportedPlatforms, [key]);
    assert.equal(serviceArtifactSupportsHostPlatform(item, platform, "s390x"), false);
    assert.equal(getExpectedServiceLockfileEntry(item, platform, "s390x"), null);
    assert.equal(buildServiceCompatibilityReport(item, new ServiceRegistry([item]), { hostPlatform: platform, hostArch: "s390x" }).status, "unsupported");
    const old = service({ [platform]: definition("legacy") });
    assert.equal(getExpectedServiceLockfileEntry(old, platform, arch).platform, platform);
  }
});

test("AC-1993-3 actual archive acquisition and moving update discovery choose exact architecture and reject wrong architecture", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "core-1993-"));
  const serviceRoot = path.join(root, "services", "architecture-fixture");
  await mkdir(serviceRoot, { recursive: true });
  const zip = new ZipArchive(); zip.addFile("selected.txt", Buffer.from("exact archive"));
  const bytes = zip.toBuffer();
  const requests = [];
  const server = createServer((request, response) => {
    requests.push(request.url);
    if (request.url === "/exact.zip") { response.end(bytes); return; }
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ tag_name: "2026.2.1-new", assets: [{ name: "exact.zip", browser_download_url: `http://127.0.0.1:${server.address().port}/exact.zip` }] }));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const item = service({ [`${process.platform}-${process.arch}`]: definition("exact.zip"), [process.platform]: { ...definition("wrong-os.zip"), archiveType: "tar.gz" }, default: { ...definition("wrong-default.zip"), archiveType: "tar.gz" } }, serviceRoot);
    item.manifest.artifact.source.api_base_url = `http://127.0.0.1:${server.address().port}`;
    const acquired = await acquireInstallArtifact(item);
    assert.equal(acquired.assetName, "exact.zip");
    assert.ok(requests.includes("/exact.zip"));
    item.manifest.updates = { mode: "manual", track: "latest" };
    const update = await checkServiceUpdate(item);
    assert.equal(update.available?.matchedAssetName, "exact.zip");
    await writeFile(path.join(serviceRoot, ".state", "install.json"), JSON.stringify({ installed: true, artifact: { ...acquired, tag: "2026.1.1-old" } }));
    await downloadServiceUpdateCandidate(item);
    const installed = await installServiceUpdateCandidate(item, { force: true });
    assert.ok(installed);
    const before = requests.length;
    item.manifest.artifact.platforms = { [`${process.platform}-s390x`]: definition("wrong.zip") };
    await assert.rejects(acquireInstallArtifact(item), /not configured/);
    assert.equal((await checkServiceUpdate(item)).status, "unavailable");
    assert.equal(requests.length, before);
  } finally { await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true, force: true }); }
});
