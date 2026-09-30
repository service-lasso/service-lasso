import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const candidateSha = "a".repeat(40);
const hash = (value) => createHash("sha256").update(value).digest("hex");

async function run(script, environment) {
  const child = spawn(process.execPath, [path.join(repoRoot, script)], { env: { ...process.env, ...environment }, stdio: ["ignore", "pipe", "pipe"] });
  const output = [];
  child.stdout.on("data", (chunk) => output.push(chunk));
  child.stderr.on("data", (chunk) => output.push(chunk));
  const [code] = await once(child, "exit");
  if (code !== 0) throw new Error(Buffer.concat(output).toString("utf8"));
}

async function writeCandidate({ sourceSha = candidateSha, badChecksum = false } = {}) {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "development-candidate-verifier-"));
  const root = path.join(temporaryRoot, "candidate");
  await mkdir(root);
  const archives = [];
  for (const artifact of ["bundled", "unbundled"]) for (const platform of ["win32", "linux", "darwin"]) {
    const name = `core-${artifact}-${platform}${platform === "win32" ? ".zip" : ".tar.gz"}`;
    const body = Buffer.from(`${artifact}-${platform}`);
    await writeFile(path.join(root, name), body);
    archives.push({ artifact, platform, name, sha256: hash(body) });
  }
  const manifest = { schemaVersion: 1, kind: "core-development-candidate", source: { repository: "owner/repo", commit: sourceSha, ref: "develop" }, archives };
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest)}\n`);
  await writeFile(path.join(root, "candidate-manifest.json"), manifestBytes);
  const sums = [...archives.map((archive, index) => `${badChecksum && index === 0 ? "0".repeat(64) : archive.sha256}  ${archive.name}`), `${hash(manifestBytes)}  candidate-manifest.json`].join("\n");
  await writeFile(path.join(root, "SHA256SUMS.txt"), `${sums}\n`);
  return { root, temporaryRoot };
}

test("AC-4BZ.3 consumer behavior rejects a candidate with the wrong source SHA before extraction", async () => {
  const fixture = await writeCandidate({ sourceSha: "b".repeat(40) });
  try {
    await assert.rejects(run("scripts/verify-development-candidate.mjs", { CANDIDATE_SHA: candidateSha, DEVELOPMENT_CANDIDATE_ROOT: fixture.root, DEVELOPMENT_CANDIDATE_PLATFORM: "linux" }), /Candidate manifest source binding is invalid/u);
  } finally { await rm(fixture.temporaryRoot, { recursive: true, force: true }); }
});

test("AC-4BZ.3 consumer behavior rejects a checksum mismatch before extraction", async () => {
  const fixture = await writeCandidate({ badChecksum: true });
  try {
    await assert.rejects(run("scripts/verify-development-candidate.mjs", { CANDIDATE_SHA: candidateSha, DEVELOPMENT_CANDIDATE_ROOT: fixture.root, DEVELOPMENT_CANDIDATE_PLATFORM: "linux" }), /Candidate checksum verification failed/u);
  } finally { await rm(fixture.temporaryRoot, { recursive: true, force: true }); }
});

test("AC-4BZ.3 consumer behavior rejects an artifact with extra files before extraction", async () => {
  const fixture = await writeCandidate();
  try {
    await writeFile(path.join(fixture.root, "unexpected.txt"), "unexpected");
    await assert.rejects(run("scripts/verify-development-candidate.mjs", { CANDIDATE_SHA: candidateSha, DEVELOPMENT_CANDIDATE_ROOT: fixture.root, DEVELOPMENT_CANDIDATE_PLATFORM: "linux" }), /Candidate artifact contains unexpected files/u);
  } finally { await rm(fixture.temporaryRoot, { recursive: true, force: true }); }
});

test("AC-4BZ.3 artifact readback behavior rejects an API artifact with the wrong source SHA", async () => {
  const archive = Buffer.from("candidate-archive");
  const server = createServer((request, response) => {
    const payload = request.url.endsWith("/actions/runs/77")
      ? { head_sha: candidateSha }
      : request.url.endsWith("/actions/artifacts/101")
        ? { id: 101, name: `core-development-candidate-${candidateSha}`, expired: false, size_in_bytes: archive.length, digest: `sha256:${hash(archive)}`, workflow_run: { head_sha: "b".repeat(40) } }
        : null;
    if (request.url.endsWith("/zip")) { response.end(archive); return; }
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify(payload));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  try {
    await assert.rejects(run("scripts/verify-development-candidate-artifact.mjs", {
      GITHUB_REPOSITORY: "owner/repo", GH_TOKEN: "test-token", GITHUB_RUN_ID: "77", CANDIDATE_SHA: candidateSha,
      DEVELOPMENT_CANDIDATE_ARTIFACT_ID: "101", DEVELOPMENT_CANDIDATE_ARTIFACT_NAME: `core-development-candidate-${candidateSha}`,
      DEVELOPMENT_CANDIDATE_ARTIFACT_DIGEST: `sha256:${hash(archive)}`, GITHUB_API_URL: `http://127.0.0.1:${address.port}`,
    }), /Candidate artifact API source binding is invalid/u);
  } finally {
    server.close();
    await once(server, "close");
  }
});
