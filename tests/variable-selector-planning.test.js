import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import {
  buildServiceVariables,
  compileCachedServiceSelectorPlan,
  compileServiceMaterializationSelectorPlan,
  compileServiceSelectorPlan,
  getServiceSelectorPlanCacheStats,
  resetServiceSelectorPlanCache,
  resolveServiceText,
  resolveServiceVariable,
} from "../dist/runtime/operator/variables.js";
import {
  compileServiceStartupBrokerPlan,
  resolveServiceStartupBrokerResolution,
  summarizeRequiredStartupBrokerFailures,
} from "../dist/runtime/broker/launch-resolution.js";
import { materializeConfigArtifacts } from "../dist/runtime/setup/materialize.js";
import { resetLifecycleState } from "../dist/runtime/lifecycle/store.js";

function fixtureService(overrides = {}) {
  return {
    manifestPath: path.join(
      process.cwd(),
      "services",
      "consumer",
      "service.json",
    ),
    serviceRoot: path.join(process.cwd(), "services", "consumer"),
    manifest: {
      id: "consumer",
      name: "Consumer",
      description: "Selector planning test service",
      env: {},
      ...overrides,
    },
  };
}

test("selector planning classifies local and broker selectors and deduplicates broker refs", () => {
  const plan = compileServiceSelectorPlan({
    local: "${SERVICE_ROOT}:${LOCAL_ONLY}",
    secret:
      "${secretsbroker.API_KEY}:${secretsbroker.API_KEY}:${vault.database.password}",
  });

  assert.deepEqual(plan.localRefs, ["SERVICE_ROOT", "LOCAL_ONLY"]);
  assert.deepEqual(plan.brokerRefs, [
    "secretsbroker.API_KEY",
    "vault.database.password",
  ]);
  assert.deepEqual(
    plan.selectors.map((selector) => [
      selector.selector,
      selector.kind,
      selector.namespace ?? null,
      selector.key,
    ]),
    [
      ["SERVICE_ROOT", "local", null, "SERVICE_ROOT"],
      ["LOCAL_ONLY", "local", null, "LOCAL_ONLY"],
      ["secretsbroker.API_KEY", "broker", "secretsbroker", "API_KEY"],
      ["vault.database.password", "broker", "vault", "database.password"],
    ],
  );
});

test("service variable resolution preserves local precedence and legacy globalenv compatibility", () => {
  resetLifecycleState();
  const service = fixtureService({
    env: {
      LOCAL_ONLY: "local",
      SHARED_VALUE: "local-wins",
      FROM_DERIVED: "${SERVICE_ID}:${SERVICE_PORT}",
      FROM_GLOBAL: "${LEGACY_TOOL_HOME}",
    },
    ports: { service: 4310 },
  });

  const payload = buildServiceVariables(service, {
    SHARED_VALUE: "global",
    LEGACY_TOOL_HOME: "C:/tools/legacy",
  });
  const byKey = Object.fromEntries(
    payload.variables.map((entry) => [entry.key, entry.value]),
  );

  assert.equal(byKey.LOCAL_ONLY, "local");
  assert.equal(
    resolveServiceVariable(service, "${SHARED_VALUE}", {
      SHARED_VALUE: "global",
    })?.value,
    "local-wins",
  );
  assert.equal(byKey.FROM_DERIVED, "consumer:4310");
  assert.equal(byKey.FROM_GLOBAL, "C:/tools/legacy");
});

test("broker imports materialize to service-specific env names", () => {
  resetLifecycleState();
  const service = fixtureService({
    env: {
      FROM_SELECTOR: "${database.PASSWORD}",
    },
    broker: {
      enabled: true,
      namespace: "services/consumer",
      buckets: [
        { namespace: "services/consumer", kind: "service" },
        { namespace: "shared/database", kind: "shared" },
      ],
      imports: [
        {
          namespace: "shared/database",
          ref: "database.PASSWORD",
          as: "DB_PASSWORD",
          required: true,
        },
        {
          namespace: "services/consumer",
          ref: "consumer.API_TOKEN",
          as: "API_TOKEN",
        },
      ],
    },
  });

  const payload = buildServiceVariables(
    service,
    {},
    {},
    {
      brokerValues: {
        "database.PASSWORD": "resolved-password",
        "consumer.API_TOKEN": "resolved-token",
      },
    },
  );
  const byKey = Object.fromEntries(
    payload.variables.map((entry) => [entry.key, entry]),
  );

  assert.deepEqual(payload.diagnostics, []);
  assert.equal(byKey.FROM_SELECTOR.value, "resolved-password");
  assert.equal(byKey.FROM_SELECTOR.scope, "manifest");
  assert.equal(byKey.DB_PASSWORD.value, "resolved-password");
  assert.equal(byKey.DB_PASSWORD.scope, "broker");
  assert.equal(byKey.API_TOKEN.value, "resolved-token");
});

test("broker selectors require explicit imports and report denied/source auth diagnostics without leaking values", () => {
  resetLifecycleState();
  const service = fixtureService({
    env: {
      DECLARED: "${database.PASSWORD}",
      UNDECLARED: "${vault.API_TOKEN}",
      DENIED: "${database.DENIED}",
      NEEDS_AUTH: "${database.SOURCE_AUTH}",
    },
    broker: {
      imports: [
        {
          namespace: "shared/database",
          ref: "database.PASSWORD",
          as: "DB_PASSWORD",
        },
        {
          namespace: "shared/database",
          ref: "database.DENIED",
          as: "DENIED_PASSWORD",
        },
        {
          namespace: "shared/database",
          ref: "database.SOURCE_AUTH",
          as: "AUTH_PASSWORD",
        },
      ],
    },
  });

  const payload = buildServiceVariables(
    service,
    {},
    {},
    {
      brokerValues: {
        "database.PASSWORD": "resolved-password",
        "vault.API_TOKEN": "should-not-leak",
        "database.DENIED": "denied-secret",
        "database.SOURCE_AUTH": "auth-secret",
      },
      deniedBrokerRefs: ["database.DENIED"],
      sourceAuthRequiredBrokerRefs: ["database.SOURCE_AUTH"],
    },
  );
  const byKey = Object.fromEntries(
    payload.variables.map((entry) => [entry.key, entry.value]),
  );

  assert.equal(byKey.DECLARED, "resolved-password");
  assert.equal(byKey.UNDECLARED, "${vault.API_TOKEN}");
  assert.equal(byKey.DENIED, "${database.DENIED}");
  assert.equal(byKey.NEEDS_AUTH, "${database.SOURCE_AUTH}");
  const serializedPayload = JSON.stringify(payload);
  assert.equal(serializedPayload.includes("should-not-leak"), false);
  assert.equal(serializedPayload.includes("denied-secret"), false);
  assert.equal(serializedPayload.includes("auth-secret"), false);
  assert.deepEqual(payload.diagnostics, [
    { selector: "vault.API_TOKEN", kind: "broker", reason: "denied-broker" },
    { selector: "database.DENIED", kind: "broker", reason: "denied-broker" },
    {
      selector: "database.SOURCE_AUTH",
      kind: "broker",
      reason: "source-auth-required",
    },
    { selector: "database.DENIED", kind: "broker", reason: "denied-broker" },
    {
      selector: "database.SOURCE_AUTH",
      kind: "broker",
      reason: "source-auth-required",
    },
  ]);
});

test("bare selectors do not fall back into broker namespaces", () => {
  resetLifecycleState();
  const service = fixtureService({ env: { LOCAL_SECRET: "${API_KEY}" } });
  const diagnostics = [];
  const resolved = resolveServiceText(
    "token=${API_KEY}",
    service,
    {},
    {},
    {
      brokerValues: { "secretsbroker.API_KEY": "resolved-secret" },
      diagnostics,
    },
  );

  assert.equal(resolved, "token=${API_KEY}");
  assert.deepEqual(diagnostics, [
    { selector: "API_KEY", kind: "local", reason: "unresolved-local" },
  ]);
});

test("explicit broker selectors resolve only from broker values and report missing refs", () => {
  resetLifecycleState();
  const service = fixtureService({ env: { LOCAL_ONLY: "local" } });
  const diagnostics = [];
  const resolved = resolveServiceText(
    "token=${secretsbroker.API_KEY}; missing=${secretsbroker.MISSING}; local=${LOCAL_ONLY}",
    service,
    {},
    {},
    {
      brokerValues: { "secretsbroker.API_KEY": "resolved-secret" },
      diagnostics,
    },
  );

  assert.equal(
    resolved,
    "token=resolved-secret; missing=${secretsbroker.MISSING}; local=local",
  );
  assert.deepEqual(diagnostics, [
    {
      selector: "secretsbroker.MISSING",
      kind: "broker",
      reason: "missing-broker",
    },
  ]);
});

test("config materialization resolves declared broker imports without leaking denied values", async () => {
  resetLifecycleState();
  const serviceRoot = await mkdtemp(
    path.join(os.tmpdir(), "service-lasso-broker-config-"),
  );
  const service = {
    manifestPath: path.join(serviceRoot, "service.json"),
    serviceRoot,
    manifest: {
      id: "config-consumer",
      name: "Config Consumer",
      description: "Materializes broker imports into config.",
      env: {
        DB_PASSWORD: "${database.PASSWORD}",
        DENIED_PASSWORD: "${database.DENIED}",
      },
      broker: {
        imports: [
          {
            namespace: "shared/database",
            ref: "database.PASSWORD",
            as: "DB_PASSWORD",
            required: true,
          },
          {
            namespace: "shared/database",
            ref: "database.DENIED",
            as: "DENIED_PASSWORD",
          },
        ],
      },
      config: {
        files: [
          {
            path: "runtime/config.json",
            content:
              '{\n  "password": "${database.PASSWORD}",\n  "denied": "${database.DENIED}"\n}\n',
          },
        ],
      },
    },
  };

  try {
    await materializeConfigArtifacts(
      service,
      {},
      {},
      {
        brokerValues: {
          "database.PASSWORD": "resolved-password",
          "database.DENIED": "denied-secret",
        },
        deniedBrokerRefs: ["database.DENIED"],
      },
    );

    const content = await readFile(
      path.join(serviceRoot, "runtime", "config.json"),
      "utf8",
    );
    assert.match(content, /resolved-password/);
    assert.match(content, /\$\{database\.DENIED\}/);
    assert.equal(content.includes("denied-secret"), false);
  } finally {
    await rm(serviceRoot, { recursive: true, force: true });
  }
});

test("startup broker resolution batches unique selectors and materializes only launch env values", async () => {
  resetLifecycleState();
  const service = fixtureService({
    env: {
      DATABASE_URL: "postgres://app:${database.PASSWORD}@db/service",
      OPTIONAL_TOKEN: "${optional.API_TOKEN}",
      DUPLICATE: "${database.PASSWORD}:${database.PASSWORD}",
    },
    broker: {
      imports: [
        {
          namespace: "shared/database",
          ref: "database.PASSWORD",
          as: "DB_PASSWORD",
          required: true,
        },
        {
          namespace: "optional",
          ref: "optional.API_TOKEN",
          as: "OPTIONAL_TOKEN",
          required: false,
        },
      ],
    },
  });

  const requestedBatches = [];
  const resolution = await resolveServiceStartupBrokerResolution(
    service,
    ({ refs }) => {
      requestedBatches.push(refs);
      return [
        {
          ref: "database.PASSWORD",
          status: "resolved",
          value: "resolved-password",
        },
        { ref: "optional.API_TOKEN", status: "missing" },
      ];
    },
  );
  const payload = buildServiceVariables(
    service,
    {},
    {},
    resolution.variableResolution,
  );
  const byKey = Object.fromEntries(
    payload.variables.map((entry) => [entry.key, entry.value]),
  );

  assert.deepEqual(requestedBatches, [
    ["database.PASSWORD", "optional.API_TOKEN"],
  ]);
  assert.equal(
    byKey.DATABASE_URL,
    "postgres://app:resolved-password@db/service",
  );
  assert.equal(byKey.DB_PASSWORD, "resolved-password");
  assert.equal(byKey.OPTIONAL_TOKEN, "${optional.API_TOKEN}");
  assert.deepEqual(summarizeRequiredStartupBrokerFailures(resolution), []);
  assert.equal(
    JSON.stringify({
      decisions: resolution.decisions,
      failures: resolution.failures,
    }).includes("resolved-password"),
    false,
  );
});

test("startup broker resolution classifies required failures without leaking lookup values", async () => {
  resetLifecycleState();
  const service = fixtureService({
    env: {
      LOCKED: "${vault.LOCKED}",
      DENIED: "${vault.DENIED}",
      AUTH: "${vault.AUTH}",
      OFFLINE: "${vault.OFFLINE}",
      DEGRADED: "${vault.DEGRADED}",
    },
    broker: {
      imports: [
        {
          namespace: "vault",
          ref: "vault.LOCKED",
          as: "LOCKED",
          required: true,
        },
        {
          namespace: "vault",
          ref: "vault.DENIED",
          as: "DENIED",
          required: true,
        },
        { namespace: "vault", ref: "vault.AUTH", as: "AUTH", required: true },
        {
          namespace: "vault",
          ref: "vault.OFFLINE",
          as: "OFFLINE",
          required: true,
        },
        {
          namespace: "vault",
          ref: "vault.DEGRADED",
          as: "DEGRADED",
          required: true,
        },
        {
          namespace: "vault",
          ref: "vault.MISSING",
          as: "MISSING",
          required: true,
        },
      ],
    },
  });

  const resolution = await resolveServiceStartupBrokerResolution(
    service,
    () => [
      {
        ref: "vault.LOCKED",
        status: "locked",
        value: "locked-value-must-not-leak",
      },
      {
        ref: "vault.DENIED",
        status: "policy-denied",
        value: "denied-value-must-not-leak",
      },
      {
        ref: "vault.AUTH",
        status: "auth-required",
        value: "auth-value-must-not-leak",
      },
      {
        ref: "vault.OFFLINE",
        status: "source-unavailable",
        value: "offline-value-must-not-leak",
      },
      {
        ref: "vault.DEGRADED",
        status: "degraded",
        value: "degraded-value-must-not-leak",
      },
    ],
  );
  const requiredFailures = summarizeRequiredStartupBrokerFailures(resolution);
  const payload = buildServiceVariables(
    service,
    {},
    {},
    resolution.variableResolution,
  );

  assert.deepEqual(
    requiredFailures.map((failure) => [
      failure.ref,
      failure.status,
      failure.required,
    ]),
    [
      ["vault.LOCKED", "locked", true],
      ["vault.DENIED", "policy-denied", true],
      ["vault.AUTH", "auth-required", true],
      ["vault.OFFLINE", "source-unavailable", true],
      ["vault.DEGRADED", "degraded", true],
      ["vault.MISSING", "missing", true],
    ],
  );
  assert.deepEqual(payload.diagnostics, [
    { selector: "vault.LOCKED", kind: "broker", reason: "locked-broker" },
    { selector: "vault.DENIED", kind: "broker", reason: "denied-broker" },
    { selector: "vault.AUTH", kind: "broker", reason: "source-auth-required" },
    { selector: "vault.OFFLINE", kind: "broker", reason: "source-unavailable" },
    { selector: "vault.DEGRADED", kind: "broker", reason: "degraded-broker" },
    { selector: "vault.MISSING", kind: "broker", reason: "missing-broker" },
  ]);
  const serialized = JSON.stringify({ resolution, payload });
  assert.equal(serialized.includes("must-not-leak"), false);
});

test("startup broker plan cache invalidates on env and broker import changes", () => {
  resetServiceSelectorPlanCache();
  const service = fixtureService({
    env: { PASSWORD: "${database.PASSWORD}" },
    broker: {
      imports: [
        {
          namespace: "shared/database",
          ref: "database.PASSWORD",
          as: "DB_PASSWORD",
          required: true,
        },
      ],
    },
  });

  const first = compileServiceStartupBrokerPlan(service);
  const second = compileServiceStartupBrokerPlan(service);
  service.manifest.env.API_TOKEN = "${service.API_TOKEN}";
  const envChanged = compileServiceStartupBrokerPlan(service);
  service.manifest.broker.imports.push({
    namespace: "service",
    ref: "service.API_TOKEN",
    as: "API_TOKEN",
  });
  const importChanged = compileServiceStartupBrokerPlan(service);

  assert.equal(second.selectorPlan, first.selectorPlan);
  assert.notEqual(envChanged.selectorPlan, first.selectorPlan);
  assert.deepEqual(envChanged.brokerRefs, [
    "database.PASSWORD",
    "service.API_TOKEN",
  ]);
  assert.deepEqual(importChanged.brokerRefs, [
    "database.PASSWORD",
    "service.API_TOKEN",
  ]);
  assert.equal(getServiceSelectorPlanCacheStats().planInvalidations >= 2, true);
});

test("materialization selector plan covers env, globalenv, install, and config templates", () => {
  const service = fixtureService({
    env: { LOCAL_SECRET_REF: "${secretsbroker.API_KEY}" },
    globalenv: { TOOL_HOME: "${SERVICE_ROOT}/tool" },
    broker: {
      imports: [
        {
          namespace: "shared/database",
          ref: "database.PASSWORD",
          as: "DB_PASSWORD",
        },
      ],
      exports: [
        {
          namespace: "consumer/runtime",
          ref: "consumer.PUBLIC_URL",
          source: "${PUBLIC_URL}",
        },
      ],
    },
    install: {
      files: [
        {
          path: "generated/${SERVICE_ID}.txt",
          content: "${vault.shared.token}",
        },
      ],
    },
    config: {
      files: [
        {
          path: "config/${secretsbroker.CONFIG_NAME}.json",
          content: "${LOCAL_SECRET_REF}",
        },
      ],
    },
  });

  const plan = compileServiceMaterializationSelectorPlan(service);

  assert.deepEqual(plan.brokerRefs, [
    "secretsbroker.API_KEY",
    "database.PASSWORD",
    "consumer.PUBLIC_URL",
    "vault.shared.token",
    "secretsbroker.CONFIG_NAME",
  ]);
  assert.ok(plan.localRefs.includes("SERVICE_ROOT"));
  assert.ok(plan.localRefs.includes("PUBLIC_URL"));
  assert.ok(plan.localRefs.includes("SERVICE_ID"));
  assert.ok(plan.localRefs.includes("LOCAL_SECRET_REF"));
});

test("selector planning cache reuses unchanged plans and invalidates when values change", () => {
  resetServiceSelectorPlanCache();

  const first = compileCachedServiceSelectorPlan("service:consumer:env", {
    LOCAL: "${SERVICE_ROOT}",
    SECRET: "${database.PASSWORD}:${database.PASSWORD}",
  });
  const second = compileCachedServiceSelectorPlan("service:consumer:env", {
    SECRET: "${database.PASSWORD}:${database.PASSWORD}",
    LOCAL: "${SERVICE_ROOT}",
  });
  const changed = compileCachedServiceSelectorPlan("service:consumer:env", {
    LOCAL: "${SERVICE_ROOT}",
    SECRET: "${vault.API_TOKEN}",
  });

  assert.equal(second, first);
  assert.notEqual(changed, first);
  assert.deepEqual(second.brokerRefs, ["database.PASSWORD"]);
  assert.deepEqual(changed.brokerRefs, ["vault.API_TOKEN"]);
  assert.deepEqual(getServiceSelectorPlanCacheStats(), {
    planHits: 1,
    planMisses: 2,
    planInvalidations: 1,
    templateHits: 1,
    templateMisses: 3,
    planEntries: 1,
    templateEntries: 3,
  });
});

test("materialization selector plan cache invalidates on broker policy and config changes", () => {
  resetServiceSelectorPlanCache();
  const service = fixtureService({
    env: { LOCAL_SECRET_REF: "${secretsbroker.API_KEY}" },
    broker: {
      imports: [
        {
          namespace: "shared/database",
          ref: "database.PASSWORD",
          as: "DB_PASSWORD",
        },
      ],
    },
    config: {
      files: [
        { path: "config/${SERVICE_ID}.json", content: "${database.PASSWORD}" },
      ],
    },
  });

  const first = compileServiceMaterializationSelectorPlan(service);
  const second = compileServiceMaterializationSelectorPlan(service);

  service.manifest.broker.imports = [
    {
      namespace: "shared/database",
      ref: "database.PASSWORD",
      as: "DB_PASSWORD",
    },
    { namespace: "shared/database", ref: "database.USER", as: "DB_USER" },
  ];
  const withBrokerPolicyChange =
    compileServiceMaterializationSelectorPlan(service);

  service.manifest.config.files[0].content =
    "${database.PASSWORD}:${database.USER}:${vault.extra.token}";
  const withConfigChange = compileServiceMaterializationSelectorPlan(service);

  assert.equal(second, first);
  assert.notEqual(withBrokerPolicyChange, first);
  assert.notEqual(withConfigChange, withBrokerPolicyChange);
  assert.deepEqual(withBrokerPolicyChange.brokerRefs, [
    "secretsbroker.API_KEY",
    "database.PASSWORD",
    "database.USER",
  ]);
  assert.deepEqual(withConfigChange.brokerRefs, [
    "secretsbroker.API_KEY",
    "database.PASSWORD",
    "database.USER",
    "vault.extra.token",
  ]);

  const stats = getServiceSelectorPlanCacheStats();
  assert.equal(stats.planHits >= 1, true);
  assert.equal(stats.planInvalidations >= 2, true);
});

test("compiled selector templates are reused during repeated text resolution", () => {
  resetServiceSelectorPlanCache();
  const service = fixtureService({
    env: {
      LOCAL_ONLY: "local",
      FROM_LOCAL: "${LOCAL_ONLY}:${LOCAL_ONLY}",
    },
  });

  const first = resolveServiceText("value=${FROM_LOCAL}", service);
  const second = resolveServiceText("value=${FROM_LOCAL}", service);

  assert.equal(first, "value=local:local");
  assert.equal(second, "value=local:local");
  assert.equal(getServiceSelectorPlanCacheStats().templateHits > 0, true);
});
