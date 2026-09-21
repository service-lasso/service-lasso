import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, realpath } from "node:fs/promises";
import path from "node:path";

export async function installedArtifactEvidence(servicesRoot, ids) {
  const root = await realpath(servicesRoot);
  const results = [];
  for (const id of ids) {
    if (!/^@?[a-zA-Z0-9_-]+$/.test(id)) throw new Error("Invalid evidence service ID.");
    const state = JSON.parse(await readFile(path.join(root, id, ".state/install.json"), "utf8"));
    const artifact = state.artifact;
    if (state.installed !== true || !artifact?.archivePath) throw new Error("Missing installed artifact evidence.");
    const archive = await realpath(artifact.archivePath);
    const relative = path.relative(root, archive);
    if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error("Artifact is outside the owned services root.");
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(archive)) hash.update(chunk);
    const sha256 = hash.digest("hex");
    const checksum = artifact.checksum;
    if (checksum && (checksum.algorithm !== "sha256" || checksum.actual !== sha256 || checksum.expected !== sha256)) throw new Error("Installed artifact checksum mismatched.");
    // Whitelist public release identity. Never copy URLs, commands, arguments,
    // extracted paths, raw install state or arbitrary diagnostic fields.
    results.push({ serviceId: id, sourceType: artifact.sourceType, repository: artifact.repo, tag: artifact.tag, assetName: artifact.assetName, sha256, releaseChecksumVerified: Boolean(checksum) });
  }
  return results;
}
