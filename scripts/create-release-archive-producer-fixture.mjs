import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const output = path.resolve(process.env.RELEASE_ARCHIVE_FIXTURE_OUTPUT ?? "artifacts/release-archive-producer-fixture");
const sourceRevision = process.env.RELEASE_ARCHIVE_SOURCE_REVISION;
const releaseId = process.env.RELEASE_ARCHIVE_RELEASE_ID;
const assetId = process.env.RELEASE_ARCHIVE_ASSET_ID;
const repository = process.env.GITHUB_REPOSITORY;
if (!sourceRevision || !/^[0-9a-f]{40}$/iu.test(sourceRevision) || !/^\d+$/u.test(releaseId ?? "") || !/^\d+$/u.test(assetId ?? "") || !repository) {
  throw new Error("A full source revision plus server-resolved release and asset IDs are required for a producer receipt.");
}

function commandVersion() {
  for (const args of [["--version"], ["-version"]]) {
    try { return execFileSync("tar", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { /* try BSD spelling */ }
  }
  throw new Error("The native tar producer did not return a version.");
}

const source = path.join(output, "source", "bundle");
await mkdir(path.join(source, "nested"), { recursive: true });
await writeFile(path.join(source, "service.json"), '{"id":"release-archive-fixture"}\n', "utf8");
await writeFile(path.join(source, "nested", "payload.txt"), "producer fixture\n", "utf8");
const archive = path.join(output, "release-archive-profile-v1.tar.gz");
execFileSync("tar", ["-czf", archive, "-C", path.dirname(source), "bundle"], { stdio: "inherit" });
const archiveBytes = await (await import("node:fs/promises")).readFile(archive);
const release = JSON.parse(execFileSync("gh", ["api", `repos/${repository}/releases/${releaseId}`], { encoding: "utf8" }));
const asset = JSON.parse(execFileSync("gh", ["api", `repos/${repository}/releases/assets/${assetId}`], { encoding: "utf8" }));
const releaseTarget = execFileSync("git", ["rev-parse", `${release.tag_name}^{commit}`], { encoding: "utf8" }).trim();
if (release.draft || release.prerelease || releaseTarget.toLowerCase() !== sourceRevision.toLowerCase() || String(asset.id) !== assetId || String(asset.url ?? "").includes(`/releases/${releaseId}/assets/`) === false) {
  throw new Error("The supplied release and asset IDs did not resolve to one release asset.");
}
const receipt = {
  schema: "release-archive-producer-receipt-v1",
  producer: { command: "tar -czf <archive> -C <source-parent> bundle", version: commandVersion(), platform: process.platform },
  sourceRevision: sourceRevision.toLowerCase(),
  serverResolved: { releaseId, assetId, releaseTag: release.tag_name, assetName: asset.name, assetDigest: asset.digest ?? null, assetByteLength: asset.size },
  archive: { name: path.basename(archive), sha256: createHash("sha256").update(archiveBytes).digest("hex"), byteLength: archiveBytes.length },
  qualification: "fixture-parser-proof-only",
  tarRuntimeAdmission: "disabled pending independent T1-T5 gates",
};
await writeFile(path.join(output, "receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
