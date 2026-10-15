import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { validInitialProjection } from "../scripts/public-first-custody-projection-lib.mjs";
import { recordPrebrowserFailure } from "../scripts/record-admin-trusted-unlock-prebrowser-failure.mjs";
const head = "a".repeat(40);
const canonical = platform => ({ schema: "service-lasso.qualification-first-custody-projection.v2", privateVersion: "v3", platform, candidate: { head, tree: "b".repeat(40) }, run: { id: "42", attempt: "1" }, privateInitialReceiptSha256: "c".repeat(64), privateJournalSha256: "d".repeat(64), localValidatorAttestation: { schema: "service-lasso.qualification-local-validator-attestation.v2", validated: true } });
const mutations = [
  value => value.localValidatorAttestation.nativeBirthCustody = "HELD_NATIVE_V1",
  value => value.localValidatorAttestation.extra = true,
  value => delete value.localValidatorAttestation.validated,
  value => value.localValidatorAttestation.validated = false,
  value => value.localValidatorAttestation.schema = "service-lasso.qualification-local-validator-attestation.v3",
  value => value.localValidatorAttestation = null,
  value => value.localValidatorAttestation = [],
  value => value.localValidatorAttestation = "validated",
  value => value.candidate.extra = true,
  value => value.run.extra = true
];
test("BR008 all public consumers share the exact canonical two-key v2 contract", async () => {
  for (const platform of ["linux", "win32", "darwin"]) {
    assert.equal(validInitialProjection(canonical(platform), platform, "42", "1", head), true);
    for (const mutate of mutations) { const value = canonical(platform); mutate(value); assert.equal(validInitialProjection(value, platform, "42", "1", head), false); }
  }
  for (const name of ["verify-packaged-admin-lifecycle-artifacts.mjs", "verify-published-package-qualification-artifacts.mjs", "record-published-package-qualification.mjs"]) {
    const source = await readFile(new URL("../scripts/" + name, import.meta.url), "utf8");
    assert.match(source, /import \{ validInitialProjection \} from "\.\/public-first-custody-projection-lib\.mjs"/u);
    assert.match(source, /(?:return|if \(!) validInitialProjection|if \(!validInitialProjection/u);
    assert.equal(source.includes("nativeBirthCustody"), false);
  }
});
test("BR008 published recorder accepts canonical projection and rejects expanded/malformed attestations before retention", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "public-custody-recorder-"));
  try {
    const projection = path.join(root, "initial-projection.json"), failure = path.join(root, "failure.json");
    await recordPrebrowserFailure({ output: failure, platform: "win32", stage: "package_identity", runId: "42", runAttempt: "1" });
    const run = () => spawnSync(process.execPath, [fileURLToPath(new URL("../scripts/record-published-package-qualification.mjs", import.meta.url))], { encoding: "utf8", env: { ...process.env, QUALIFICATION_PLATFORM: "win32", QUALIFICATION_EVIDENCE_ROOT: path.join(root, "evidence"), GITHUB_RUN_ID: "42", GITHUB_RUN_ATTEMPT: "1", QUALIFICATION_INITIAL_PROJECTION_PATH: projection, QUALIFICATION_CANDIDATE_SHA: head, ADMIN_TRUSTED_UNLOCK_PREBROWSER_FAILURE_PATH: failure } });
    await writeFile(projection, JSON.stringify(canonical("win32")));
    const valid = run(); assert.equal(valid.status, 0, valid.stderr);
    for (const mutate of mutations) {
      await rm(path.join(root, "evidence"), { recursive: true, force: true });
      const value = canonical("win32"); mutate(value); await writeFile(projection, JSON.stringify(value));
      const rejected = run(); assert.notEqual(rejected.status, 0); assert.match(rejected.stderr, /Initial qualification projection custody is invalid/u);
      await assert.rejects(readFile(path.join(root, "evidence", "admin-trusted-unlock-prebrowser-failure.json")), { code: "ENOENT" });
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});
