import { appendFile, lstat, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { assertDevelopIdentity, assertPolicyEnvironment, digest, parseScopedJson, readSourceScope, sourceIdentity } from "./ga-platform-scope-lib.mjs";
import { scopedReleaseAssetNames } from "./scoped-release-evidence-lib.mjs";
import { publishFullRelease, requireScopedPublisherCredential } from "./scoped-publication-lib.mjs";
import { verifyRetainedOperatorTools } from "./operator-tool-packaging-lib.mjs";
import { boundedProviderBody, readAuthenticatedArtifact } from "./scoped-provider-readback-lib.mjs";
import { requireScopedTechnicalAuthority } from "./scoped-technical-authority-lib.mjs";
assertDevelopIdentity(); assertPolicyEnvironment(); await readSourceScope();
const repo = "service-lasso/service-lasso", source = sourceIdentity(process.env.CANDIDATE_SHA);
if (process.env.GITHUB_REPOSITORY !== repo || !process.env.RUNNER_TEMP) throw new Error("scoped publisher fixed provider context missing");
const token = requireScopedPublisherCredential();
delete process.env.DEVELOPMENT_CANDIDATE_TOKEN;
const evidence = parseScopedJson(await readFile("artifacts/scoped-qualification/full-release-evidence.json"));
const held = new Map(), qualificationBytes = new Map();
async function originalFile(file) {
  const info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink() || info.size < 1 || info.size > 256 * 1024 * 1024) throw new Error("publisher original file invalid");
  const bytes = await readFile(file);
  if (bytes.length !== info.size) throw new Error("publisher original file changed");
  return bytes;
}
for (const name of scopedReleaseAssetNames(evidence.version)) held.set(name, await originalFile(path.join("artifacts", name)));
for (const ref of evidence.qualification) qualificationBytes.set(ref.name, await originalFile(path.join("artifacts/scoped-qualification", ref.name)));
const operatorManifest = (await verifyRetainedOperatorTools({ artifactRoot: path.join("artifacts", `service-lasso-${evidence.version}`), requireProtected: true })).manifest;
async function request(route, options = {}) {
  if (route !== `/repos/${repo}` && !route.startsWith(`/repos/${repo}/`)) throw new Error("publisher provider route outside fixed repository");
  const response = await fetch(`https://api.github.com${route}`, { ...options, redirect: "error", signal: AbortSignal.timeout(15_000), headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "content-type": "application/json", "x-github-api-version": "2026-03-10", ...options.headers } });
  if (!response.ok) throw new Error(`scoped publication provider operation failed (${response.status})`);
  return parseScopedJson(await boundedProviderBody(response, 4 * 1024 * 1024), "publisher metadata");
}
const readMetadata = route => request(route);
async function publicAsset(url) {
  if (!new RegExp(`^https://api\\.github\\.com/repos/${repo}/releases/assets/[1-9][0-9]*$`, "u").test(url)) throw new Error("publisher public readback URL differs");
  let current = url;
  for (let redirects = 0; redirects < 5; redirects++) {
    const response = await fetch(current, { headers: { accept: "application/octet-stream" }, redirect: "manual", signal: AbortSignal.timeout(15_000) });
    if (response.status >= 300 && response.status < 400) {
      const next = new URL(response.headers.get("location"), current);
      if (next.protocol !== "https:" || !["github.com", "release-assets.githubusercontent.com", "objects.githubusercontent.com"].includes(next.hostname)) throw new Error("publisher public redirect differs");
      current = next.href; continue;
    }
    if (!response.ok) throw new Error("publisher public body unavailable");
    return boundedProviderBody(response);
  }
  throw new Error("publisher public redirect budget exceeded");
}
const jobsResponse = await request(`/repos/${repo}/actions/runs/${process.env.GITHUB_RUN_ID}/attempts/${process.env.GITHUB_RUN_ATTEMPT}/jobs?per_page=100`);
if (jobsResponse.total_count !== jobsResponse.jobs?.length) throw new Error("publisher job inventory incomplete");
const journalRoot = path.join(process.env.RUNNER_TEMP, `scoped-release-private-${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT}`);
await mkdir(journalRoot, { mode: 0o700 });
const journalPath = path.join(journalRoot, "publication-journal.jsonl");
const provider = {
  readMetadata,
  readPublicAsset: publicAsset,
  async requireProtectedReleaseEnvironment() {
    await requireScopedTechnicalAuthority({ source, readMetadata, readArtifact: url => readAuthenticatedArtifact(url, repo, token) });
    const environment = await request(`/repos/${repo}/environments/release`);
    // Source-bound actual environment identity; reviewer configuration is not
    // an invented qualification requirement. The provider schedules this job.
    if (environment.id !== 20898438221 || environment.name !== "release" || environment.deployment_branch_policy?.protected_branches !== true || environment.deployment_branch_policy?.custom_branch_policies !== false) throw new Error("protected release environment identity differs");
    const protection = await request(`/repos/${repo}/branches/develop/protection`);
    if (protection.enforce_admins?.enabled !== true || protection.allow_force_pushes?.enabled !== false || protection.allow_deletions?.enabled !== false) throw new Error("protected develop publication controls differ");
    const immutable = await request(`/repos/${repo}/immutable-releases`);
    if (immutable.enabled !== true) throw new Error("immutable release enforcement is not established before publication");
  },
  createPrivateDraft({ tag, targetCommit }) { return request(`/repos/${repo}/releases`, { method: "POST", body: JSON.stringify({ tag_name: tag, name: tag, target_commitish: targetCommit, draft: true, prerelease: false }) }); },
  async uploadHeldAsset(id, name, bytes) {
    const response = await fetch(`https://uploads.github.com/repos/${repo}/releases/${id}/assets?name=${encodeURIComponent(name)}`, { method: "POST", redirect: "error", signal: AbortSignal.timeout(15_000), headers: { authorization: `Bearer ${token}`, "content-type": "application/octet-stream" }, body: bytes });
    if (!response.ok) throw new Error("private held-byte upload failed");
    const asset = parseScopedJson(await boundedProviderBody(response, 4 * 1024 * 1024));
    if (asset.name !== name || asset.size !== bytes.length || asset.digest !== `sha256:${digest(bytes)}` || asset.state !== "uploaded") throw new Error("private upload readback differs");
  },
  async verifyPrivateDraft(id, originals) {
    const draft = await request(`/repos/${repo}/releases/${id}`);
    if (draft.draft !== true || draft.tag_name !== evidence.version || draft.target_commitish !== source.commit || draft.assets?.length !== originals.size) throw new Error("private draft readback differs");
    const names = new Set(), ids = new Set();
    for (const row of draft.assets) {
      const bytes = originals.get(row.name);
      if (!bytes || names.has(row.name) || row.size !== bytes.length || row.digest !== `sha256:${digest(bytes)}`) throw new Error("private inventory readback differs");
      names.add(row.name);
      if (!Number.isSafeInteger(row.id) || row.id < 1 || ids.has(row.id) || row.state !== "uploaded" || row.url !== `https://api.github.com/repos/${repo}/releases/assets/${row.id}`) throw new Error("private asset identity differs");
      ids.add(row.id);
      const signal = AbortSignal.timeout(15_000);
      const response = await fetch(row.url, { headers: { authorization: `Bearer ${token}`, accept: "application/octet-stream" }, redirect: "manual", signal });
      let observed;
      if (response.status >= 300 && response.status < 400) {
        const location = new URL(response.headers.get("location"), row.url);
        if (location.protocol !== "https:" || !["release-assets.githubusercontent.com", "objects.githubusercontent.com"].includes(location.hostname)) throw new Error("private asset redirect differs");
        // The signed asset location is private custody. Never forward the API
        // credential, record the URL, or follow an unreviewed second redirect.
        const body = await fetch(location.href, { redirect: "error", signal });
        if (!body.ok) throw new Error("private asset body unavailable");
        observed = await boundedProviderBody(body);
      } else {
        if (!response.ok) throw new Error("private asset body unavailable");
        observed = await boundedProviderBody(response);
      }
      if (!observed.equals(bytes)) throw new Error("private held body readback differs");
    }
  },
  finalizeImmutable(id) { return request(`/repos/${repo}/releases/${id}`, { method: "PATCH", body: JSON.stringify({ draft: false }) }); },
};
await publishFullRelease({ evidence, source, held, operatorManifest, jobs: jobsResponse.jobs, qualificationBytes, provider, journal: row => appendFile(journalPath, `${JSON.stringify(row)}\n`, { mode: 0o600 }) });
