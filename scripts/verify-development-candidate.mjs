import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
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
const platforms = ["win32", "linux", "darwin"];
const artifactKinds = ["bundled", "unbundled"];
const isSafeName = (value) => typeof value === "string" && /^[A-Za-z0-9._-]+$/u.test(value);
const expectedPairs = new Set(artifactKinds.flatMap((artifact) => platforms.map((candidatePlatform) => `${artifact}:${candidatePlatform}`)));
if (!Array.isArray(manifest.archives) || manifest.archives.length !== expectedPairs.size) throw new Error("Candidate manifest must list exactly six archives.");
const manifestNames = new Set();
const manifestPairs = new Set();
for (const archive of manifest.archives) {
  if (!isSafeName(archive?.name) || !artifactKinds.includes(archive?.artifact) || !platforms.includes(archive?.platform) || !/^[a-f0-9]{64}$/u.test(archive?.sha256 ?? "")) {
    throw new Error("Candidate manifest archive entry is malformed.");
  }
  const pair = `${archive.artifact}:${archive.platform}`;
  const requiredExtension = archive.platform === "win32" ? ".zip" : ".tar.gz";
  if (!archive.name.endsWith(`-${archive.platform}${requiredExtension}`) || manifestNames.has(archive.name) || manifestPairs.has(pair)) {
    throw new Error("Candidate manifest archive inventory is not unique.");
  }
  manifestNames.add(archive.name);
  manifestPairs.add(pair);
}
if (manifestPairs.size !== expectedPairs.size || [...expectedPairs].some((pair) => !manifestPairs.has(pair))) throw new Error("Candidate manifest does not cover every bundled and unbundled platform archive.");
const sumEntries = (await readFile(sumsPath, "utf8")).trim().split("\n").map((line) => {
  const match = line.match(/^([a-f0-9]{64})  ([A-Za-z0-9._-]+)$/u);
  if (!match) throw new Error("Candidate checksum manifest is malformed.");
  return [match[2], match[1]];
});
const sums = new Map(sumEntries);
if (sums.size !== sumEntries.length) throw new Error("Candidate checksum manifest contains duplicate entries.");
const expectedFiles = new Set(["candidate-manifest.json", "SHA256SUMS.txt", ...manifestNames]);
if (sums.size !== manifestNames.size + 1 || [...sums.keys()].some((name) => name === "SHA256SUMS.txt" || !expectedFiles.has(name))) {
  throw new Error("Candidate checksum manifest has missing or unexpected entries.");
}
const rootEntries = await readdir(root);
if (rootEntries.length !== expectedFiles.size || rootEntries.some((name) => !expectedFiles.has(name))) throw new Error("Candidate artifact contains unexpected files.");
for (const name of rootEntries) if (!(await stat(path.join(root, name))).isFile()) throw new Error("Candidate artifact entries must be regular files.");
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
const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "service-lasso-development-candidate-"));
const extractionRoot = path.join(workspaceRoot, "extracted");
await mkdir(extractionRoot, { recursive: true });
await execFileAsync("tar", ["-xf", path.join(root, archive.name), "-C", extractionRoot]);
const extractedRoot = path.join(extractionRoot, artifactName);
if (!(await stat(extractedRoot)).isDirectory()) throw new Error("Candidate archive did not contain its expected package root.");
const servicesRoot = path.join(workspaceRoot, "services");
await mkdir(servicesRoot, { recursive: true });
const port = 19000 + Math.floor(Math.random() * 1000);
const child = (await import("node:child_process")).spawn(process.execPath, [path.join(extractedRoot, "dist", "index.js"), "--noautostart"], {
  cwd: extractedRoot,
  env: { ...process.env, SERVICE_LASSO_PORT: String(port), SERVICE_LASSO_SERVICES_ROOT: servicesRoot, SERVICE_LASSO_WORKSPACE_ROOT: workspaceRoot },
  stdio: ["ignore", "ignore", "pipe"],
});
let childExited = false;
const childExit = new Promise((resolve) => child.once("exit", () => { childExited = true; resolve(); }));
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
  await stat(path.join(extractedRoot, "packages", "core", "cli.js"));
  process.stdout.write(`${JSON.stringify({ candidateSha, platform, consumerSmoke: "passed" })}\n`);
} finally {
  if (!childExited) {
    child.kill("SIGTERM");
    await Promise.race([childExit, new Promise((_, reject) => setTimeout(() => reject(new Error("Owned candidate Core did not exit before cleanup.")), 15_000))]);
  }
  await rm(workspaceRoot, { recursive: true, force: true });
}
