import { createHash } from "node:crypto";
import process from "node:process";

const required = (name) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required ${name}.`);
  return value;
};

const repository = required("GITHUB_REPOSITORY");
const token = required("GH_TOKEN");
const runId = required("GITHUB_RUN_ID");
const candidateSha = required("CANDIDATE_SHA").toLowerCase();
const artifactId = required("DEVELOPMENT_CANDIDATE_ARTIFACT_ID");
const artifactName = required("DEVELOPMENT_CANDIDATE_ARTIFACT_NAME");
const uploadDigest = required("DEVELOPMENT_CANDIDATE_ARTIFACT_DIGEST").replace(/^sha256:/u, "").toLowerCase();
if (!/^[a-f0-9]{40}$/u.test(candidateSha) || !/^[a-f0-9]{64}$/u.test(uploadDigest)) throw new Error("Candidate artifact identity is malformed.");

const apiBase = (process.env.GITHUB_API_URL?.trim() || "https://api.github.com").replace(/\/$/u, "");
const headers = { accept: "application/vnd.github+json", authorization: `Bearer ${token}`, "x-github-api-version": "2022-11-28" };
const api = async (pathname) => {
  const response = await fetch(`${apiBase}/repos/${repository}${pathname}`, { headers });
  if (!response.ok) throw new Error(`Development candidate artifact API readback failed with HTTP ${response.status}.`);
  return response;
};

const run = await (await api(`/actions/runs/${runId}`)).json();
if (String(run.head_sha).toLowerCase() !== candidateSha) throw new Error("Workflow run is not bound to the candidate SHA.");
const artifact = await (await api(`/actions/artifacts/${artifactId}`)).json();
if (artifact.name !== artifactName || artifact.expired === true || Number(artifact.size_in_bytes) <= 0) throw new Error("Candidate artifact API identity is invalid.");
if (String(artifact.workflow_run?.head_sha ?? "").toLowerCase() !== candidateSha) throw new Error("Candidate artifact API source binding is invalid.");
if (String(artifact.digest ?? "").replace(/^sha256:/u, "").toLowerCase() !== uploadDigest) throw new Error("Candidate artifact API digest differs from upload digest.");
const bytes = Buffer.from(await (await api(`/actions/artifacts/${artifactId}/zip`)).arrayBuffer());
if (createHash("sha256").update(bytes).digest("hex") !== uploadDigest) throw new Error("Downloaded candidate artifact digest differs from upload digest.");
process.stdout.write(`${JSON.stringify({ candidateSha, artifactId, artifactName, downloadDigestVerified: true })}\n`);
