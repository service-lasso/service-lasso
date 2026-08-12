import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {
  applyLegacyGlobalEnvMigrationPlan,
  classifyLegacyEnvKey,
  createLegacyGlobalEnvMigrationPlan,
} from "../dist/runtime/broker/legacy-globalenv-migration.js";

function fixtureService(id, manifest) {
  return {
    manifestPath: path.join(process.cwd(), "services", id, "service.json"),
    serviceRoot: path.join(process.cwd(), "services", id),
    manifest: {
      id,
      name: id,
      description: `${id} fixture`,
      ...manifest,
    },
  };
}

function assertNoRawMaterial(payload) {
  const text = JSON.stringify(payload);
  for (const forbidden of [
    "super-secret-password-value",
    "raw-token-value",
    "postgres://user:pass@localhost/db",
    "global-secret-value",
  ]) {
    assert.equal(text.includes(forbidden), false, `leaked ${forbidden}`);
  }
}

test("legacy migration classifier detects secret non-secret and ambiguous keys", () => {
  assert.deepEqual(classifyLegacyEnvKey("DB_PASSWORD"), {
    classification: "secret",
    reasons: ["key-match:PASSWORD"],
  });
  assert.deepEqual(classifyLegacyEnvKey("PUBLIC_URL"), {
    classification: "non-secret",
    reasons: ["key-match:PUBLIC_URL"],
  });
  assert.deepEqual(classifyLegacyEnvKey("DATABASE_DSN"), {
    classification: "ambiguous",
    reasons: ["key-match:DSN"],
  });
});

test("legacy migration dry-run maps env secrets to broker imports without raw values", () => {
  const services = [
    fixtureService("api", {
      env: {
        DB_PASSWORD: "super-secret-password-value",
        PUBLIC_URL: "http://localhost:3000",
        DATABASE_DSN: "postgres://user:pass@localhost/db",
      },
      globalenv: {
        SHARED_TOKEN: "global-secret-value",
      },
    }),
  ];

  const plan = createLegacyGlobalEnvMigrationPlan(services, {
    backend: "vault-dev",
    includeAmbiguous: true,
  });
  const candidates = plan.services[0].candidates;

  assert.equal(plan.summary.servicesScanned, 1);
  assert.equal(plan.summary.candidates, 4);
  assert.equal(plan.summary.planned, 1);
  assert.equal(plan.summary.needsConfirmation, 1);
  assert.equal(plan.summary.unsupported, 2);
  assert.deepEqual(
    candidates.map((candidate) => [
      candidate.key,
      candidate.source,
      candidate.classification,
      candidate.state,
      candidate.proposed?.ref ?? null,
    ]),
    [
      ["DB_PASSWORD", "env", "secret", "planned", "api.DB_PASSWORD"],
      ["PUBLIC_URL", "env", "non-secret", "unsupported", null],
      [
        "DATABASE_DSN",
        "env",
        "ambiguous",
        "needs-confirmation",
        "api.DATABASE_DSN",
      ],
      ["SHARED_TOKEN", "globalenv", "secret", "unsupported", null],
    ],
  );
  assert.equal(
    candidates[0].metadata.length,
    "super-secret-password-value".length,
  );
  assert.equal(candidates[0].metadata.fingerprint.length, 16);
  assert.equal(candidates[0].metadata.valueKind, "literal");
  assertNoRawMaterial(plan);
});

test("legacy migration reports denied and unsupported states with safe metadata", () => {
  const services = [
    fixtureService("worker", {
      env: {
        API_TOKEN: "raw-token-value",
      },
      globalenv: {
        GLOBAL_SECRET: "global-secret-value",
      },
    }),
  ];

  const plan = createLegacyGlobalEnvMigrationPlan(services, {
    denyKeys: new Set(["API_TOKEN"]),
  });

  assert.equal(plan.summary.denied, 1);
  assert.equal(plan.summary.unsupported, 1);
  assert.deepEqual(
    plan.services[0].candidates.map((candidate) => [
      candidate.key,
      candidate.state,
      candidate.reasons.at(-1),
    ]),
    [
      ["API_TOKEN", "denied", "policy-denied"],
      ["GLOBAL_SECRET", "unsupported", "globalenv-manual-writeback-required"],
    ],
  );
  assertNoRawMaterial(plan);
});

test("legacy migration apply is gated by confirmation and audit reason", () => {
  const services = [
    fixtureService("api", {
      env: { DB_PASSWORD: "super-secret-password-value" },
    }),
  ];
  const plan = createLegacyGlobalEnvMigrationPlan(services);

  assert.throws(
    () =>
      applyLegacyGlobalEnvMigrationPlan(plan, services, {
        auditReason: "migrate api secret",
      }),
    /requires confirmation token/,
  );
  assert.throws(
    () =>
      applyLegacyGlobalEnvMigrationPlan(plan, services, {
        confirmation: "APPLY_LEGACY_GLOBALENV_MIGRATION",
        auditReason: " ",
      }),
    /requires a non-empty audit reason/,
  );
});

test("legacy migration apply produces manifest changes, partial skips, and rollback guidance", () => {
  const services = [
    fixtureService("api", {
      env: {
        DB_PASSWORD: "super-secret-password-value",
        DATABASE_DSN: "postgres://user:pass@localhost/db",
        PUBLIC_URL: "http://localhost:3000",
      },
      globalenv: {
        SHARED_TOKEN: "global-secret-value",
      },
      broker: {
        imports: [
          { namespace: "services/api", ref: "api.EXISTING", as: "EXISTING" },
        ],
      },
    }),
  ];
  const plan = createLegacyGlobalEnvMigrationPlan(services, {
    includeAmbiguous: true,
  });

  const result = applyLegacyGlobalEnvMigrationPlan(plan, services, {
    confirmation: "APPLY_LEGACY_GLOBALENV_MIGRATION",
    auditReason: "Move api legacy env secrets into broker refs",
  });
  const manifest = result.updatedManifests.api;

  assert.equal(result.ok, false);
  assert.deepEqual(result.applied, [
    { serviceId: "api", key: "DB_PASSWORD", ref: "api.DB_PASSWORD" },
  ]);
  assert.deepEqual(
    result.skipped.map((entry) => [entry.key, entry.state]),
    [
      ["DATABASE_DSN", "needs-confirmation"],
      ["PUBLIC_URL", "unsupported"],
      ["SHARED_TOKEN", "unsupported"],
    ],
  );
  assert.equal(manifest.env.DB_PASSWORD, "${api.DB_PASSWORD}");
  assert.equal(manifest.env.PUBLIC_URL, "http://localhost:3000");
  assert.deepEqual(manifest.broker.imports, [
    { namespace: "services/api", ref: "api.EXISTING", as: "EXISTING" },
    {
      namespace: "services/api",
      ref: "api.DB_PASSWORD",
      as: "DB_PASSWORD",
      required: true,
    },
  ]);
  assert.match(
    result.rollbackGuidance.join("\n"),
    /restor(?:e|ing) the original env\/globalenv entries/,
  );
  assertNoRawMaterial(result);
});

test("legacy migration apply can include ambiguous env candidates only with explicit flag", () => {
  const services = [
    fixtureService("api", {
      env: { DATABASE_DSN: "postgres://user:pass@localhost/db" },
    }),
  ];
  const plan = createLegacyGlobalEnvMigrationPlan(services, {
    includeAmbiguous: true,
  });
  const result = applyLegacyGlobalEnvMigrationPlan(plan, services, {
    confirmation: "APPLY_LEGACY_GLOBALENV_MIGRATION",
    auditReason: "Migrate confirmed ambiguous DSN",
    allowAmbiguous: true,
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.applied, [
    { serviceId: "api", key: "DATABASE_DSN", ref: "api.DATABASE_DSN" },
  ]);
  assert.equal(
    result.updatedManifests.api.env.DATABASE_DSN,
    "${api.DATABASE_DSN}",
  );
  assertNoRawMaterial(result);
});
