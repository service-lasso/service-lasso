import { lstat, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { assertDevelopIdentity, assertPolicyEnvironment, digest, parseScopedJson, readSourceScope, sourceIdentity } from "./ga-platform-scope-lib.mjs";
import { scopedArchiveNames, validateTechnicalQualification, verifyFullReleaseBytes } from "./scoped-release-evidence-lib.mjs";
assertDevelopIdentity(); assertPolicyEnvironment();
const source = sourceIdentity(process.env.CANDIDATE_SHA), scope = await readSourceScope();
const version = process.env.SERVICE_LASSO_RELEASE_VERSION;
const qualification = parseScopedJson(await readFile("artifacts/scoped-qualification/qualification.json"));
validateTechnicalQualification(qualification, source);
const held = new Map();
async function byteRef(name) {
  const file = path.join("artifacts", name), info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink() || info.size < 1 || info.size > 256 * 1024 * 1024) throw new Error("scoped release evidence requires original bounded regular held file");
  const bytes = await readFile(file); held.set(name, bytes);
  if (bytes.length !== info.size) throw new Error("scoped release evidence file changed");
  return { name, sha256: digest(bytes), size: bytes.length };
}
const archives = [];
for (const name of scopedArchiveNames(version)) archives.push({ ...await byteRef(name), sbom: await byteRef(`${name}.cdx.json`) });
const checksumManifest = await byteRef("SHA256SUMS.txt");
const evidence = { schema: "service-lasso.full-release-evidence.v1", scope, source, version, archives, checksumManifest, qualification: qualification.receipts };
verifyFullReleaseBytes(evidence, source, held);
await writeFile("artifacts/scoped-qualification/full-release-evidence.json", `${JSON.stringify(evidence, null, 2)}\n`, { flag: "wx" });
