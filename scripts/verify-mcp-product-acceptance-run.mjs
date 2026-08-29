import process from "node:process";

const required = (name) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required ${name}.`);
  return value;
};

const repository = required("GITHUB_REPOSITORY");
const token = required("GH_TOKEN");
const runId = required("GITHUB_RUN_ID");
const runAttempt = required("GITHUB_RUN_ATTEMPT");
const candidateSha = required("CANDIDATE_SHA").toLowerCase();
const githubApiUrl = (process.env.GITHUB_API_URL?.trim() || "https://api.github.com").replace(/\/$/u, "");
const headers = {
  accept: "application/vnd.github+json",
  authorization: `Bearer ${token}`,
  "x-github-api-version": "2022-11-28",
  "user-agent": "service-lasso-mcp-product-run-verifier",
};

async function api(pathname) {
  const response = await fetch(`${githubApiUrl}/repos/${repository}${pathname}`, { headers });
  if (!response.ok) throw new Error(`GitHub MCP product run readback failed with HTTP ${response.status}.`);
  return response;
}

const run = await (await api(`/actions/runs/${runId}`)).json();
if (String(run.head_sha).toLowerCase() !== candidateSha) {
  throw new Error("MCP product aggregate run is not bound to the candidate SHA.");
}
const expectedNames = new Map(
  ["win32", "linux", "darwin"].map((platform) => [
    `mcp-product-acceptance-${platform}-${runId}-${runAttempt}`,
    platform,
  ]),
);
let artifacts = [];
for (let attempt = 0; attempt < 12; attempt += 1) {
  const payload = await (await api(`/actions/runs/${runId}/artifacts?per_page=100`)).json();
  artifacts = (payload.artifacts ?? []).filter((artifact) => expectedNames.has(artifact.name));
  if (artifacts.length === expectedNames.size) break;
  await new Promise((resolve) => setTimeout(resolve, 1_000));
}
if (artifacts.length !== expectedNames.size || new Set(artifacts.map((artifact) => artifact.name)).size !== expectedNames.size) {
  throw new Error("MCP product aggregate did not retain exactly one artifact for each operating system.");
}
for (const artifact of artifacts) {
  if (
    artifact.expired === true ||
    Number(artifact.size_in_bytes) <= 0 ||
    !/^sha256:[0-9a-f]{64}$/iu.test(String(artifact.digest ?? "")) ||
    String(artifact.workflow_run?.head_sha ?? "").toLowerCase() !== candidateSha
  ) {
    throw new Error("MCP product aggregate artifact identity, digest, size, expiry, or SHA binding failed.");
  }
  const retainedDays = (Date.parse(artifact.expires_at) - Date.parse(artifact.created_at)) / 86_400_000;
  if (!Number.isFinite(retainedDays) || retainedDays < 89) {
    throw new Error("MCP product aggregate artifact retention is shorter than 90 days.");
  }
}

process.stdout.write(`${JSON.stringify({
  candidateSha,
  runId,
  runAttempt,
  artifacts: artifacts
    .map((artifact) => ({
      id: String(artifact.id),
      name: artifact.name,
      platform: expectedNames.get(artifact.name),
      sizeInBytes: artifact.size_in_bytes,
      digest: artifact.digest,
      expiresAt: artifact.expires_at,
    }))
    .sort((left, right) => left.platform.localeCompare(right.platform)),
})}\n`);
