import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import {
  buildServiceVariables,
  compileServiceMaterializationSelectorPlan,
  compileServiceSelectorPlan,
  resolveServiceText,
  resolveServiceVariable,
} from "../dist/runtime/operator/variables.js";
import { materializeConfigArtifacts } from "../dist/runtime/setup/materialize.js";
import { resetLifecycleState } from "../dist/runtime/lifecycle/store.js";

function fixtureService(overrides = {}) {
  return {
    manifestPath: path.join(process.cwd(), "services", "consumer", "service.json"),
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
    secret: "${secretsbroker.API_KEY}:${secretsbroker.API_KEY}:${vault.database.password}",
  });

  assert.deepEqual(plan.localRefs, ["SERVICE_ROOT", "LOCAL_ONLY"]);
  assert.deepEqual(plan.brokerRefs, ["secretsbroker.API_KEY", "vault.database.password"]);
  assert.deepEqual(
    plan.selectors.map((selector) => [selector.selector, selector.kind, selector.namespace ?? null, selector.key]),
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

  const payload = buildServiceVariables(service, { SHARED_VALUE: "global", LEGACY_TOOL_HOME: "C:/tools/legacy" });
  const byKey = Object.fromEntries(payload.variables.map((entry) => [entry.key, entry.value]));

  assert.equal(byKey.LOCAL_ONLY, "local");
  assert.equal(resolveServiceVariable(service, "${SHARED_VALUE}", { SHARED_VALUE: "global" })?.value, "local-wins");
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
        { namespace: "shared/database", ref: "database.PASSWORD", as: "DB_PASSWORD", required: true },
        { namespace: "services/consumer", ref: "consumer.API_TOKEN", as: "API_TOKEN" },
      ],
    },
  });

  const payload = buildServiceVariables(service, {}, {}, {
    brokerValues: {
      "database.PASSWORD": "resolved-password",
      "consumer.API_TOKEN": "resolved-token",
    },
  });
  const byKey = Object.fromEntries(payload.variables.map((entry) => [entry.key, entry]));

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
        { namespace: "shared/database", ref: "database.PASSWORD", as: "DB_PASSWORD" },
        { namespace: "shared/database", ref: "database.DENIED", as: "DENIED_PASSWORD" },
        { namespace: "shared/database", ref: "database.SOURCE_AUTH", as: "AUTH_PASSWORD" },
      ],
    },
  });

  const payload = buildServiceVariables(service, {}, {}, {
    brokerValues: {
      "database.PASSWORD": "resolved-password",
      "vault.API_TOKEN": "should-not-leak",
      "database.DENIED": "denied-secret",
      "database.SOURCE_AUTH": "auth-secret",
    },
    deniedBrokerRefs: ["database.DENIED"],
    sourceAuthRequiredBrokerRefs: ["database.SOURCE_AUTH"],
  });
  const byKey = Object.fromEntries(payload.variables.map((entry) => [entry.key, entry.value]));

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
    { selector: "database.SOURCE_AUTH", kind: "broker", reason: "source-auth-required" },
    { selector: "database.DENIED", kind: "broker", reason: "denied-broker" },
    { selector: "database.SOURCE_AUTH", kind: "broker", reason: "source-auth-required" },
  ]);
});

test("bare selectors do not fall back into broker namespaces", () => {
  resetLifecycleState();
  const service = fixtureService({ env: { LOCAL_SECRET: "${API_KEY}" } });
  const diagnostics = [];
  const resolved = resolveServiceText("token=${API_KEY}", service, {}, {}, {
    brokerValues: { "secretsbroker.API_KEY": "resolved-secret" },
    diagnostics,
  });

  assert.equal(resolved, "token=${API_KEY}");
  assert.deepEqual(diagnostics, [{ selector: "API_KEY", kind: "local", reason: "unresolved-local" }]);
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

  assert.equal(resolved, "token=resolved-secret; missing=${secretsbroker.MISSING}; local=local");
  assert.deepEqual(diagnostics, [{ selector: "secretsbroker.MISSING", kind: "broker", reason: "missing-broker" }]);
});

test("config materialization resolves declared broker imports without leaking denied values", async () => {
  resetLifecycleState();
  const serviceRoot = await mkdtemp(path.join(os.tmpdir(), "service-lasso-broker-config-"));
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
          { namespace: "shared/database", ref: "database.PASSWORD", as: "DB_PASSWORD", required: true },
          { namespace: "shared/database", ref: "database.DENIED", as: "DENIED_PASSWORD" },
        ],
      },
      config: {
        files: [
          {
            path: "runtime/config.json",
            content: "{\n  \"password\": \"${database.PASSWORD}\",\n  \"denied\": \"${database.DENIED}\"\n}\n",
          },
        ],
      },
    },
  };

  try {
    await materializeConfigArtifacts(service, {}, {}, {
      brokerValues: {
        "database.PASSWORD": "resolved-password",
        "database.DENIED": "denied-secret",
      },
      deniedBrokerRefs: ["database.DENIED"],
    });

    const content = await readFile(path.join(serviceRoot, "runtime", "config.json"), "utf8");
    assert.match(content, /resolved-password/);
    assert.match(content, /\$\{database\.DENIED\}/);
    assert.equal(content.includes("denied-secret"), false);
  } finally {
    await rm(serviceRoot, { recursive: true, force: true });
  }
});

test("materialization selector plan covers env, globalenv, install, and config templates", () => {
  const service = fixtureService({
    env: { LOCAL_SECRET_REF: "${secretsbroker.API_KEY}" },
    globalenv: { TOOL_HOME: "${SERVICE_ROOT}/tool" },
    broker: {
      imports: [{ namespace: "shared/database", ref: "database.PASSWORD", as: "DB_PASSWORD" }],
      exports: [{ namespace: "consumer/runtime", ref: "consumer.PUBLIC_URL", source: "${PUBLIC_URL}" }],
    },
    install: { files: [{ path: "generated/${SERVICE_ID}.txt", content: "${vault.shared.token}" }] },
    config: { files: [{ path: "config/${secretsbroker.CONFIG_NAME}.json", content: "${LOCAL_SECRET_REF}" }] },
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
