import { readFile } from "node:fs/promises";

const ledgerUrl = new URL("../docs/reference/secrets-capability-ledger.json", import.meta.url);
const maturities = new Set(["planned", "read-only", "dry-run", "executable", "validated", "excluded"]);
const releaseWaves = new Set(["release-1", "release-2", "release-3", "release-4", "enterprise"]);
const expectedCapabilityIds = new Set([
  "vault-bootstrap-root-custody",
  "pgp-bootstrap-option",
  "local-encrypted-store-policy",
  "generated-credentials",
  "secret-inventory-search-reveal",
  "local-secret-lifecycle",
  "linked-secret-rotation",
  "backup-restore-master-key-recovery",
  "audit-telemetry-diagnostics",
  "events-lockouts-filtering",
  "service-secret-provider-topology",
  "routes-and-traefik-view",
  "provider-status-configuration",
  "external-secret-read-reveal",
  "remote-secret-mutation-migration",
  "bulk-rotation-campaigns",
  "headless-cli-secrets",
  "core-mcp-read-tools",
  "broker-mcp-management",
  "secrets-sync-github",
  "scheduled-automated-rotation",
  "vault-openbao-aws-provider-tracks",
  "enterprise-mfa-hsm-fips",
  "admin-navigation-page-split-tables",
  "admin-product-decisions"
]);

const errors = [];

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function requireString(value, path) {
  if (!isNonEmptyString(value)) {
    errors.push(`${path} must be a non-empty string`);
  }
}

function requireStringArray(value, path) {
  if (!Array.isArray(value) || value.length === 0) {
    errors.push(`${path} must be a non-empty array`);
    return;
  }

  value.forEach((entry, index) => requireString(entry, `${path}[${index}]`));
}

function isIsoTimestamp(value) {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) &&
    !Number.isNaN(Date.parse(value))
  );
}

function requireHttpsUrl(value, path) {
  if (!isNonEmptyString(value)) {
    errors.push(`${path} must be a non-empty HTTPS URL`);
    return;
  }

  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:") {
      errors.push(`${path} must use HTTPS`);
    }
  } catch {
    errors.push(`${path} must be a valid URL`);
  }
}

let ledger;
try {
  ledger = JSON.parse(await readFile(ledgerUrl, "utf8"));
} catch (error) {
  console.error(`Secrets capability ledger is not valid JSON: ${error.message}`);
  process.exit(1);
}

if (ledger.schema !== "service-lasso.secrets-capability-ledger.v1") {
  errors.push("schema must be service-lasso.secrets-capability-ledger.v1");
}
if (!isIsoTimestamp(ledger.observedAt)) {
  errors.push("observedAt must be an ISO-8601 UTC timestamp");
}
requireStringArray(ledger.programmeSources, "programmeSources");
ledger.programmeSources?.forEach((url, index) => requireHttpsUrl(url, `programmeSources[${index}]`));

if (typeof ledger.maturityDefinitions !== "object" || ledger.maturityDefinitions === null) {
  errors.push("maturityDefinitions must be an object");
} else {
  for (const maturity of maturities) {
    requireString(ledger.maturityDefinitions[maturity], `maturityDefinitions.${maturity}`);
  }
}

if (typeof ledger.releaseWaves !== "object" || ledger.releaseWaves === null) {
  errors.push("releaseWaves must be an object");
} else {
  for (const releaseWave of releaseWaves) {
    requireString(ledger.releaseWaves[releaseWave], `releaseWaves.${releaseWave}`);
  }
}

if (!Array.isArray(ledger.capabilities) || ledger.capabilities.length === 0) {
  errors.push("capabilities must be a non-empty array");
} else {
  const seenIds = new Set();

  ledger.capabilities.forEach((entry, index) => {
    const path = `capabilities[${index}]`;
    ["id", "family", "capability", "operation", "adminSurface", "maturity", "releaseWave", "nextAction"].forEach(
      (field) => requireString(entry[field], `${path}.${field}`)
    );

    if (seenIds.has(entry.id)) {
      errors.push(`${path}.id duplicates ${entry.id}`);
    }
    seenIds.add(entry.id);

    if (!maturities.has(entry.maturity)) {
      errors.push(`${path}.maturity is unsupported: ${entry.maturity}`);
    }
    if (!releaseWaves.has(entry.releaseWave)) {
      errors.push(`${path}.releaseWave is unsupported: ${entry.releaseWave}`);
    }
    if (entry.blocker !== null && !isNonEmptyString(entry.blocker)) {
      errors.push(`${path}.blocker must be null or a non-empty string`);
    }

    if (typeof entry.owner !== "object" || entry.owner === null) {
      errors.push(`${path}.owner must be an object`);
    } else {
      requireString(entry.owner.repository, `${path}.owner.repository`);
      requireHttpsUrl(entry.owner.issueUrl, `${path}.owner.issueUrl`);
      if (
        isNonEmptyString(entry.owner.repository) &&
        isNonEmptyString(entry.owner.issueUrl) &&
        !entry.owner.issueUrl.startsWith(`https://github.com/${entry.owner.repository}/issues/`)
      ) {
        errors.push(`${path}.owner.issueUrl must identify an issue in ${entry.owner.repository}`);
      }
    }

    requireStringArray(entry.endpointSchema, `${path}.endpointSchema`);
    requireStringArray(entry.providerBackend, `${path}.providerBackend`);
    requireStringArray(entry.securityPermissionAudit, `${path}.securityPermissionAudit`);
    requireStringArray(entry.automatedValidation, `${path}.automatedValidation`);

    if (!Array.isArray(entry.evidence) || entry.evidence.length === 0) {
      errors.push(`${path}.evidence must be a non-empty array`);
    } else {
      entry.evidence.forEach((evidence, evidenceIndex) => {
        const evidencePath = `${path}.evidence[${evidenceIndex}]`;
        requireString(evidence.kind, `${evidencePath}.kind`);
        requireHttpsUrl(evidence.url, `${evidencePath}.url`);
        requireString(evidence.claim, `${evidencePath}.claim`);
        if (!isIsoTimestamp(evidence.observedAt)) {
          errors.push(`${evidencePath}.observedAt must be an ISO-8601 UTC timestamp`);
        }
      });
    }

    if (entry.maturity === "validated") {
      const hasRealProcessEvidence = entry.evidence?.some((evidence) =>
        evidence.kind.toLowerCase().includes("real-process")
      );
      if (!hasRealProcessEvidence) {
        errors.push(`${path} claims validated maturity without real-process evidence`);
      }
    }

    if (entry.maturity === "excluded") {
      const hasDecisionEvidence = entry.evidence?.some((evidence) => evidence.kind === "release-decision");
      if (!hasDecisionEvidence) {
        errors.push(`${path} claims excluded maturity without release-decision evidence`);
      }
      if (entry.blocker !== null) {
        errors.push(`${path} excluded maturity must not carry an implementation blocker`);
      }
    }
  });

  for (const expectedId of expectedCapabilityIds) {
    if (!seenIds.has(expectedId)) {
      errors.push(`required programme capability is missing: ${expectedId}`);
    }
  }
}

if (errors.length > 0) {
  console.error("Secrets capability ledger validation failed:");
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log(`Secrets capability ledger validation passed (${ledger.capabilities.length} capabilities).`);
