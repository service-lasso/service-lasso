import { createHash } from "node:crypto";
import process from "node:process";
import AdmZip from "adm-zip";
import { validateMcpProductEvidence } from "./mcp-product-acceptance-lib.mjs";

const required = (name) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required ${name}.`);
  return value;
};

const repository = required("GITHUB_REPOSITORY");
const token = required("GH_TOKEN");
const runId = required("GITHUB_RUN_ID");
const artifactId = required("MCP_PRODUCT_ARTIFACT_ID");
const artifactName = required("MCP_PRODUCT_ARTIFACT_NAME");
const platform = required("MCP_PRODUCT_PLATFORM");
if (!["win32", "linux", "darwin"].includes(platform)) throw new Error("Unsupported MCP product evidence platform.");
const uploadDigest = required("MCP_PRODUCT_ARTIFACT_DIGEST").toLowerCase();
if (!/^(?:sha256:)?[0-9a-f]{64}$/u.test(uploadDigest)) {
  throw new Error("MCP product upload digest must be a SHA-256 digest.");
}
const expectedDigest = uploadDigest.startsWith("sha256:") ? uploadDigest : `sha256:${uploadDigest}`;
const candidateSha = required("CANDIDATE_SHA").toLowerCase();
const githubApiUrl = (process.env.GITHUB_API_URL?.trim() || "https://api.github.com").replace(/\/$/u, "");
const headers = {
  accept: "application/vnd.github+json",
  authorization: `Bearer ${token}`,
  "x-github-api-version": "2022-11-28",
  "user-agent": "service-lasso-mcp-product-artifact-verifier",
};

async function api(pathname) {
  const response = await fetch(`${githubApiUrl}/repos/${repository}${pathname}`, { headers });
  if (!response.ok) throw new Error(`GitHub MCP product artifact readback failed with HTTP ${response.status}.`);
  return response;
}

const run = await (await api(`/actions/runs/${runId}`)).json();
if (String(run.head_sha).toLowerCase() !== candidateSha) {
  throw new Error("Workflow run head SHA does not match the MCP product candidate SHA.");
}

let artifact;
for (let attempt = 0; attempt < 10; attempt += 1) {
  artifact = await api(`/actions/artifacts/${artifactId}`).then((response) => response.json()).catch(() => null);
  if (artifact) break;
  await new Promise((resolve) => setTimeout(resolve, 1_000));
}
if (!artifact) throw new Error("Uploaded MCP product artifact was not readable through the artifact API.");
if (artifact.name !== artifactName || artifact.expired === true || Number(artifact.size_in_bytes) <= 0) {
  throw new Error("MCP product artifact identity, expiry, or size failed readback.");
}
if (String(artifact.workflow_run?.head_sha ?? "").toLowerCase() !== candidateSha) {
  throw new Error("MCP product artifact is not bound to the candidate SHA.");
}
if (String(artifact.digest ?? "").toLowerCase() !== expectedDigest) {
  throw new Error("MCP product artifact API digest does not match the upload digest.");
}
const retainedDays = (Date.parse(artifact.expires_at) - Date.parse(artifact.created_at)) / 86_400_000;
if (!Number.isFinite(retainedDays) || retainedDays < 89) {
  throw new Error("MCP product artifact retention is shorter than the required 90-day policy.");
}

const archiveBytes = Buffer.from(await (await api(`/actions/artifacts/${artifactId}/zip`)).arrayBuffer());
const archiveDigest = `sha256:${createHash("sha256").update(archiveBytes).digest("hex")}`;
if (archiveDigest !== expectedDigest) {
  throw new Error("Downloaded MCP product artifact digest does not match the upload digest.");
}
const zip = new AdmZip(archiveBytes);
const entries = zip.getEntries().filter((entry) => !entry.isDirectory);
const expectedFile = `mcp-product-${platform}.json`;
if (entries.length !== 1 || entries[0].entryName !== expectedFile) {
  throw new Error("MCP product artifact must contain exactly its platform metadata evidence file.");
}
const evidence = JSON.parse(entries[0].getData().toString("utf8"));
validateMcpProductEvidence(evidence, { candidateSha, platform });

process.stdout.write(`${JSON.stringify({
  artifactId: String(artifact.id),
  name: artifact.name,
  digest: expectedDigest,
  candidateSha,
  platform,
  expiresAt: artifact.expires_at,
  sizeInBytes: artifact.size_in_bytes,
  downloadedContentValidated: true,
})}\n`);
