import { lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { assertDevelopIdentity, assertPolicyEnvironment, digest, parseScopedJson, readSourceScope, sourceIdentity } from "./ga-platform-scope-lib.mjs";
import { validateTechnicalQualification } from "./scoped-release-evidence-lib.mjs";
import { verifyNpmPublication } from "./scoped-publication-lib.mjs";
import { verifyRetainedOperatorTools } from "./operator-tool-packaging-lib.mjs";
import { verifyNpmOriginalToolBytes } from "./scoped-npm-original-bytes-lib.mjs";
import { boundedProviderBody } from "./scoped-provider-readback-lib.mjs";
assertDevelopIdentity(); assertPolicyEnvironment();
const scope = await readSourceScope(), source = sourceIdentity(process.env.CANDIDATE_SHA), version = process.env.SERVICE_LASSO_RELEASE_VERSION;
const root = path.join("artifacts/npm", `service-lasso-package-${version}`);
const operatorManifest = (await verifyRetainedOperatorTools({ artifactRoot: root, requireProtected: true })).manifest;
const manifestBytes = await readFile(path.join(root, "operator-tools/manifest.json"));
const qualification = parseScopedJson(await readFile("artifacts/scoped-qualification/qualification.json"));
validateTechnicalQualification(qualification, source);
async function registry(url) {
  const location = new URL(url);
  if (location.protocol !== "https:" || location.hostname !== "registry.npmjs.org" || location.username || location.password) throw new Error("scoped npm registry source differs");
  const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error("scoped npm public registry readback failed");
  return boundedProviderBody(response);
}
const metadata = parseScopedJson(await registry(`https://registry.npmjs.org/%40service-lasso%2Fservice-lasso/${encodeURIComponent(version)}`));
const distTags = parseScopedJson(await registry("https://registry.npmjs.org/-/package/%40service-lasso%2Fservice-lasso/dist-tags"));
const tarball = await registry(metadata.dist?.tarball);
const assets = [], originalToolBytes = new Map();
for (const tool of operatorManifest.tools) {
  const directory = path.join(root, "operator-tools", tool.command);
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isFile() || entry.isSymbolicLink()) throw new Error("scoped npm original tool inventory differs");
    const name = `operator-tools/${tool.command}/${entry.name}`, file = path.join(root, name), info = await lstat(file), bytes = await readFile(file);
    if (bytes.length !== info.size || bytes.length < 1) throw new Error("scoped npm original tool file changed");
    originalToolBytes.set(name, bytes);
    assets.push({ name, sha256: digest(bytes), size: bytes.length });
  }
}
assets.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
const evidence = { schema: "service-lasso.npm-publication-evidence.v1", scope, source, version,
  package: { name: "@service-lasso/service-lasso", version, gitHead: source.commit, integrity: `sha512-${createHash("sha512").update(tarball).digest("base64")}`, distTag: "latest", tarballSha256: digest(tarball), size: tarball.length },
  operatorTools: { schemaVersion: operatorManifest.schemaVersion, manifestSha256: digest(manifestBytes), assets }, qualification: qualification.receipts };
verifyNpmPublication({ evidence, source, metadata, distTags, tarball, operatorManifest, manifestBytes, originalToolBytes });
await verifyNpmOriginalToolBytes(tarball, manifestBytes, originalToolBytes);
await mkdir("artifacts/scoped-qualification", { recursive: true });
await writeFile("artifacts/scoped-qualification/npm-publication-evidence.json", `${JSON.stringify(evidence, null, 2)}\n`, { flag: "wx" });
