import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { startApiServer } from "../dist/server/index.js";
import { discoverServices } from "../dist/runtime/discovery/discoverServices.js";
import { resolveActivatedOperatorExecutable } from "../dist/runtime/updates/pinned-operator-release.js";
import { makeTempServicesRoot, writeManifest } from "./test-helpers.js";

const digest = bytes => createHash("sha256").update(bytes).digest("hex");

test("pinned operator release confirms an exact artifact, preserves the source pin, and rejects tampering", {
  skip: process.platform !== "linux",
}, async t => {
  const { tempRoot, servicesRoot, workspaceRoot } = await makeTempServicesRoot("pinned-release-");
  t.after(() => rm(tempRoot, { recursive: true, force: true }));
  const repo = "service-lasso/service-lasso-tui";
  const baseTag = "candidate-2026.11.27-aaaaaaa";
  const tag = "candidate-2026.11.28-bbbbbbb";
  const name = "service-lasso-tui-linux-amd64.tar.gz";
  const command = "./service-lasso-tui";
  const assetRoot = `https://github.com/${repo}/releases/download/${tag}/`;
  await mkdir(path.join(tempRoot, "package"));
  await writeFile(path.join(tempRoot, "package", "service-lasso-tui"), "#!/bin/sh\nprintf 'test release\\n'\n", { mode: 0o700 });
  const archive = execFileSync("tar", ["-cz", "-C", path.join(tempRoot, "package"), "service-lasso-tui"]);
  const manifest = releaseTag => ({
    id: "@tui", name: "TUI", description: "Pinned client fixture", enabled: true, version: "1.0.0",
    role: "provider", autostart: false,
    artifact: {
      kind: "archive", source: { type: "github-release", repo, tag: releaseTag },
      platforms: { [`linux-${process.arch}`]: { assetName: name, archiveType: "tar.gz", command, sha256: digest(archive) } },
    },
  });
  const old = manifest(baseTag);
  old.artifact.platforms[`linux-${process.arch}`].assetUrl = "https://github.com/service-lasso-fixture/base.tgz";
  await writeManifest(servicesRoot, "@tui", old);
  await writeManifest(servicesRoot, "unrelated", { id: "unrelated", name: "Unrelated", description: "Unrelated fixture" });
  const manifestPath = path.join(servicesRoot, "@tui", "service.json");
  const original = await readFile(manifestPath);
  const published = Buffer.from(JSON.stringify(manifest(tag)));
  const asset = (assetName, bytes) => ({ name: assetName, size: bytes.length,
    digest: "sha256:" + digest(bytes), browser_download_url: assetRoot + assetName });
  const baseRelease = { tag_name: baseTag, immutable: true, draft: false, published_at: "2026-11-27T00:00:00Z" };
  const release = { tag_name: tag, immutable: true, draft: false, published_at: "2026-11-28T00:00:00Z",
    assets: [asset("service.json", published), asset(name, archive)] };
  const originalFetch = globalThis.fetch;
  let downloads = 0;
  let badArchive = false;
  t.mock.method(globalThis, "fetch", async (input, init) => {
    const url = String(input);
    if (url === old.artifact.platforms[`linux-${process.arch}`].assetUrl) return new Response(archive);
    if (url === `https://api.github.com/repos/${repo}/releases/tags/${baseTag}`) return Response.json(baseRelease);
    if (url === `https://api.github.com/repos/${repo}/releases/tags/${tag}`) return Response.json(release);
    if (url === `https://api.github.com/repos/${repo}/releases?per_page=30`) return Response.json([release, baseRelease]);
    if (url === assetRoot + "service.json") return new Response(published);
    if (url === assetRoot + name) {
      downloads++;
      return new Response(badArchive ? Buffer.alloc(archive.length) : archive);
    }
    return await originalFetch(input, init);
  });
  const runtime = await startApiServer({ port: 0, servicesRoot, workspaceRoot, baselineBootstrap: { serviceIds: ["@tui"] } });
  try {
    const post = (action, data, id = "@tui") => originalFetch(`${runtime.url}/api/services/${encodeURIComponent(id)}/pinned-release/${action}`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data),
    });
    const check = await post("check", {});
    assert.equal(check.status, 200, await check.clone().text());
    assert.deepEqual(await check.json(), { serviceId: "@tui", currentTag: baseTag, status: "update_available", candidateTag: tag });
    assert.equal((await post("check", {}, "unrelated")).status, 404);
    assert.equal((await post("install", { tag })).status, 409);
    assert.equal((await post("install", { tag: baseTag, confirm: true })).status, 409);
    assert.equal(downloads, 0);

    badArchive = true;
    assert.equal((await post("install", { tag, confirm: true })).status, 502);
    const service = (await discoverServices(servicesRoot)).find(service => service.manifest.id === "@tui");
    assert.equal(await resolveActivatedOperatorExecutable(service), null);

    badArchive = false;
    const installed = await post("install", { tag, confirm: true });
    assert.equal(installed.status, 200, await installed.clone().text());
    assert.deepEqual(await installed.json(), { serviceId: "@tui", installedTag: tag });
    assert.equal((await post("install", { tag, confirm: true })).status, 200);
    assert.equal(downloads, 2);
    assert.deepEqual(await readFile(manifestPath), original);

    const executable = await resolveActivatedOperatorExecutable(service);
    assert.equal(execFileSync(executable, { encoding: "utf8" }), "test release\n");
    await writeFile(executable, "modified");
    await assert.rejects(resolveActivatedOperatorExecutable(service));
    const repair = await post("check", {});
    assert.equal((await repair.json()).candidateTag, tag);
    assert.equal((await post("install", { tag, confirm: true })).status, 200);
    assert.equal(execFileSync(await resolveActivatedOperatorExecutable(service), { encoding: "utf8" }), "test release\n");
    await writeManifest(servicesRoot, "@tui", { ...old, description: "Changed base pin" });
    const changed = (await discoverServices(servicesRoot)).find(service => service.manifest.id === "@tui");
    assert.equal(await resolveActivatedOperatorExecutable(changed), null);
  } finally {
    await runtime.stop();
  }
});
