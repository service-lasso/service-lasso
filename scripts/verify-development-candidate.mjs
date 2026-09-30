import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { extractPlatformReleaseArchive } from "./release-artifact-lib.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const root = path.resolve(process.env.DEVELOPMENT_CANDIDATE_ROOT ?? "");
const candidateSha = process.env.CANDIDATE_SHA?.trim().toLowerCase();
const platform = process.env.DEVELOPMENT_CANDIDATE_PLATFORM?.trim();
if (!root || !/^[a-f0-9]{40}$/u.test(candidateSha ?? "") || !["win32", "linux", "darwin"].includes(platform)) {
  throw new Error("Candidate root, full SHA, and supported platform are required.");
}

const hash = async (filePath) => createHash("sha256").update(await readFile(filePath)).digest("hex");
const manifestPath = path.join(root, "candidate-manifest.json");
const sumsPath = path.join(root, "SHA256SUMS.txt");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
if (manifest?.kind !== "core-development-candidate" || manifest?.source?.commit !== candidateSha || manifest?.source?.ref !== "develop") {
  throw new Error("Candidate manifest source binding is invalid.");
}
if (!Array.isArray(manifest.archives) || manifest.archives.length !== 6) throw new Error("Candidate manifest must list six archives.");
const sums = new Map((await readFile(sumsPath, "utf8")).trim().split("\n").map((line) => {
  const match = line.match(/^([a-f0-9]{64})  ([A-Za-z0-9._-]+)$/u);
  if (!match) throw new Error("Candidate checksum manifest is malformed.");
  return [match[2], match[1]];
}));
for (const archive of manifest.archives) {
  const archivePath = path.join(root, archive.name);
  if (sums.get(archive.name) !== archive.sha256 || await hash(archivePath) !== archive.sha256) {
    throw new Error(`Candidate checksum verification failed for ${archive.name}.`);
  }
}
if (sums.get("candidate-manifest.json") !== await hash(manifestPath)) throw new Error("Candidate manifest checksum verification failed.");

const archive = manifest.archives.find((entry) => entry.platform === platform && entry.artifact === "unbundled");
if (!archive) throw new Error("Candidate lacks the requested unbundled platform archive.");
const artifactName = archive.name.replace(platform === "win32" ? /-win32\.zip$/u : new RegExp(`-${platform}\\.tar\\.gz$`, "u"), "");
const extracted = await extractPlatformReleaseArchive({ archivePath: path.join(root, archive.name), artifactName, platform });
const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "service-lasso-development-candidate-"));
const port = 19000 + Math.floor(Math.random() * 1000);
const child = (await import("node:child_process")).spawn(process.execPath, [path.join(extracted.extractedRoot, "dist", "index.js"), "--noautostart"], {
  cwd: extracted.extractedRoot,
  env: { ...process.env, SERVICE_LASSO_PORT: String(port), SERVICE_LASSO_SERVICES_ROOT: path.join(repoRoot, "services"), SERVICE_LASSO_WORKSPACE_ROOT: workspaceRoot },
  stdio: ["ignore", "ignore", "pipe"],
});
try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Candidate Core did not become healthy within 60 seconds.")), 60_000);
    const probe = async () => {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/api/health`);
        const health = await response.json();
        if (response.ok && health?.api?.version) { clearTimeout(timer); resolve(health); return; }
      } catch {}
      setTimeout(probe, 250);
    };
    child.once("error", reject);
    child.once("exit", (code) => reject(new Error(`Candidate Core exited before health with code ${code}.`)));
    void probe();
  });
  await stat(path.join(extracted.extractedRoot, "packages", "core", "cli.js"));
  process.stdout.write(`${JSON.stringify({ candidateSha, platform, consumerSmoke: "passed" })}\n`);
} finally {
  child.kill("SIGTERM");
  await extracted.cleanup();
  await rm(workspaceRoot, { recursive: true, force: true });
}
