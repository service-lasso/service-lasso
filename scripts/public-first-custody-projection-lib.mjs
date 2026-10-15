// Closed public v2 contract. Native lifetime proof belongs only to private v3.
const exact = (value, keys) => !!value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).sort().join(",") === [...keys].sort().join(",");
export function validInitialProjection(value, platform, runId, runAttempt, candidateSha) {
  return exact(value, ["schema", "privateVersion", "candidate", "platform", "run", "privateInitialReceiptSha256", "privateJournalSha256", "localValidatorAttestation"])
    && value.schema === "service-lasso.qualification-first-custody-projection.v2" && value.privateVersion === "v3"
    && value.platform === platform
    && exact(value.run, ["id", "attempt"]) && String(value.run.id) === String(runId) && String(value.run.attempt) === String(runAttempt)
    && exact(value.candidate, ["head", "tree"]) && value.candidate.head === candidateSha && /^[0-9a-f]{40}$/u.test(value.candidate.tree)
    && /^[0-9a-f]{64}$/u.test(value.privateInitialReceiptSha256) && /^[0-9a-f]{64}$/u.test(value.privateJournalSha256)
    && exact(value.localValidatorAttestation, ["schema", "validated"])
    && value.localValidatorAttestation.schema === "service-lasso.qualification-local-validator-attestation.v2" && value.localValidatorAttestation.validated === true;
}
