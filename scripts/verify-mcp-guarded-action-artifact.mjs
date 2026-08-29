import { createHash } from "node:crypto";
import process from "node:process";
import AdmZip from "adm-zip";

const required = (name) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required ${name}.`);
  return value;
};

const repository = required("GITHUB_REPOSITORY");
const token = required("GH_TOKEN");
const runId = required("GITHUB_RUN_ID");
const artifactId = required("MCP_GUARDED_ACTION_ARTIFACT_ID");
const artifactName = required("MCP_GUARDED_ACTION_ARTIFACT_NAME");
const expectedDigest = required("MCP_GUARDED_ACTION_ARTIFACT_DIGEST").toLowerCase();
const candidateSha = required("CANDIDATE_SHA").toLowerCase();
const githubApiUrl = (process.env.GITHUB_API_URL?.trim() || "https://api.github.com").replace(/\/$/u, "");
const headers = {
  accept: "application/vnd.github+json",
  authorization: `Bearer ${token}`,
  "x-github-api-version": "2022-11-28",
  "user-agent": "service-lasso-mcp-artifact-verifier",
};

async function api(pathname, options = {}) {
  const response = await fetch(`${githubApiUrl}/repos/${repository}${pathname}`, { headers, ...options });
  if (!response.ok) throw new Error(`GitHub artifact readback failed with HTTP ${response.status}.`);
  return response;
}

const run = await (await api(`/actions/runs/${runId}`)).json();
if (String(run.head_sha).toLowerCase() !== candidateSha) {
  throw new Error("Workflow run head SHA does not match the tested candidate SHA.");
}

let artifact;
for (let attempt = 0; attempt < 10; attempt += 1) {
  artifact = await (async () => {
    try {
      return await (await api(`/actions/artifacts/${artifactId}`)).json();
    } catch {
      return null;
    }
  })();
  if (artifact) break;
  await new Promise((resolve) => setTimeout(resolve, 1_000));
}
if (!artifact) throw new Error("Uploaded guarded-action artifact was not readable through the artifact API.");
if (artifact.name !== artifactName || artifact.expired === true || Number(artifact.size_in_bytes) <= 0) {
  throw new Error("Guarded-action artifact identity, expiry, or size failed readback.");
}
if (String(artifact.workflow_run?.head_sha ?? "").toLowerCase() !== candidateSha) {
  throw new Error("Guarded-action artifact is not bound to the candidate SHA.");
}
if (String(artifact.digest ?? "").toLowerCase() !== expectedDigest) {
  throw new Error("Guarded-action artifact API digest does not match the upload digest.");
}
const retainedDays = (Date.parse(artifact.expires_at) - Date.parse(artifact.created_at)) / 86_400_000;
if (!Number.isFinite(retainedDays) || retainedDays < 89) {
  throw new Error("Guarded-action artifact retention is shorter than the required 90-day policy.");
}

const archiveBytes = Buffer.from(await (await api(`/actions/artifacts/${artifactId}/zip`)).arrayBuffer());
const archiveDigest = `sha256:${createHash("sha256").update(archiveBytes).digest("hex")}`;
if (archiveDigest !== expectedDigest) {
  throw new Error("Downloaded guarded-action artifact digest does not match the upload digest.");
}
const zip = new AdmZip(archiveBytes);
const entries = zip.getEntries().filter((entry) => !entry.isDirectory);
if (entries.length !== 1 || entries[0].entryName !== "mcp-guarded-actions.json") {
  throw new Error("Guarded-action artifact must contain exactly one metadata evidence file.");
}
const evidence = JSON.parse(entries[0].getData().toString("utf8"));
if (
  evidence.contractVersion !== "service-lasso.mcp-guarded-action-evidence.v1" ||
  evidence.issue !== 862 ||
  String(evidence.candidateSha).toLowerCase() !== candidateSha ||
  evidence.testCommand !== "npm test"
) {
  throw new Error("Guarded-action artifact content is not bound to the successful candidate test.");
}
const serialized = JSON.stringify(evidence);
if (/(?:bearer\s+|authorization|cookie|password|secret\s*[:=]|token\s*[:=]|private[_-]?key|[A-Za-z]:[\\/]|file:\/\/)/iu.test(serialized)) {
  throw new Error("Guarded-action artifact contains forbidden sensitive or path-like material.");
}

process.stdout.write(`${JSON.stringify({
  artifactId: String(artifact.id),
  name: artifact.name,
  digest: expectedDigest,
  candidateSha,
  expiresAt: artifact.expires_at,
  sizeInBytes: artifact.size_in_bytes,
})}\n`);
