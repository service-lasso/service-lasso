import { assertDevelopIdentity, assertPolicyEnvironment, parseScopedJson, readSourceScope, sourceIdentity } from "./ga-platform-scope-lib.mjs";
import { boundedProviderBody, readAuthenticatedArtifact } from "./scoped-provider-readback-lib.mjs";
import { requireScopedTechnicalAuthority } from "./scoped-technical-authority-lib.mjs";
assertDevelopIdentity(); assertPolicyEnvironment(); await readSourceScope();
const source = sourceIdentity(process.env.CANDIDATE_SHA), token = process.env.GITHUB_TOKEN;
if (process.env.GITHUB_REPOSITORY !== source.repository || !token) throw new Error("scoped technical provider context missing");
async function readMetadata(route) {
  if (!route.startsWith(`/repos/${source.repository}/`)) throw new Error("scoped technical metadata route differs");
  const response = await fetch(`https://api.github.com${route}`, { redirect: "error", signal: AbortSignal.timeout(15_000), headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json" } });
  if (!response.ok) throw new Error("scoped technical metadata unavailable");
  return parseScopedJson(await boundedProviderBody(response, 4 * 1024 * 1024));
}
const result = await requireScopedTechnicalAuthority({ source, readMetadata, readArtifact: url => readAuthenticatedArtifact(url, source.repository, token) });
process.stdout.write(`${JSON.stringify({ run: result.evidence.run, artifactId: result.artifactId, artifactSha256: result.artifactSha256, terminalJobId: result.terminalJobId })}\n`);
