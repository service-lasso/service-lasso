import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { zipSync } from "fflate";
import { StagedServiceTransfer } from "../../dist/runtime/release/staged-service-transfer.js";
import { createStagedReleaseAssetImporter } from "../../dist/runtime/operator/remote-service-registration.js";

const [workspaceRoot, servicesRoot] = process.argv.slice(2);
if (!workspaceRoot || !servicesRoot) process.exit(64);

const archive = Buffer.from(zipSync({ "release.txt": Buffer.from("hard-exit fixture") }));
const digest = createHash("sha256").update(archive).digest("hex");
const manifest = JSON.stringify({
  id: "hard-exit-service", name: "Hard exit service", description: "fixture", executable: "node", args: ["fixture.js"], healthcheck: { type: "process" },
  artifact: { kind: "archive", source: { type: "github-release", repo: "service-lasso/lasso-node", tag: "v1" }, platforms: { win32: { assetName: "hard-exit.zip", archiveType: "zip", command: "fixture.js", checksum: { algorithm: "sha256", value: "b".repeat(64) } } } },
});
const manifestDigest = createHash("sha256").update(manifest).digest("hex");
const identity = {
  repo: "service-lasso/lasso-node", releaseTag: "v1", commitSha: "a".repeat(40), targetServiceId: "hard-exit-service", platform: "win32", archiveType: "zip", assetName: "hard-exit.zip", assetId: "asset-1", archiveBytes: archive.length, archiveSha256: digest, manifestSha256: manifestDigest, releaseId: "release-1", manifestAssetId: "manifest-1", checksumAssetId: "checksums-1", manifestBytes: Buffer.from(manifest).toString("base64"),
};
const actor = { id: "hard-exit-actor", workspaceId: "hard-exit-workspace", canConfigure: true };
const input = { targetServiceId: identity.targetServiceId, provenance: { repo: identity.repo, releaseTag: identity.releaseTag, commitSha: identity.commitSha }, platform: "win32", manifestSchemaVersion: "service-lasso.service-manifest/v1" };
const priorFetch = globalThis.fetch;
globalThis.fetch = async (url) => {
  if (String(url).includes("/git/ref/tags/v1")) return new Response(JSON.stringify({ object: { type: "commit", sha: "a".repeat(40) } }));
  if (String(url).includes("/releases/tags/v1")) return new Response(JSON.stringify({ tag_name: "v1", assets: [{ name: "service.json", browser_download_url: "https://github.com/service-lasso/lasso-node/releases/download/v1/service.json" }] }));
  if (String(url).endsWith("/service.json")) return new Response(manifest);
  throw new Error(`unexpected request: ${url}`);
};

await mkdir(servicesRoot, { recursive: true });
const direct = createStagedReleaseAssetImporter({ servicesRoot });
const transfer = new StagedServiceTransfer(workspaceRoot, { resolve: async () => identity }, {
  import: async (claimed) => {
    const outcome = await direct.import(claimed);
    if (outcome !== "completed") process.exit(65);
    // Deliberately abrupt: this is after the real direct child has retained
    // the exact bytes, before StagedServiceTransfer can record its outcome.
    process.exit(73);
  },
  reconcile: direct.reconcile,
});
try {
  const stage = await transfer.create(actor, input);
  await transfer.upload(actor, stage.stageId, 0, stage.uploadToken, digest, archive, { start: 0, end: archive.length - 1, total: archive.length });
  await transfer.finalize(actor, stage.stageId);
  const confirmation = await transfer.confirmation(actor, stage.stageId);
  await transfer.register(actor, stage.stageId, confirmation.confirmationId, "hard-exit-idempotency-0001");
  process.exit(66);
} finally {
  globalThis.fetch = priorFetch;
}
