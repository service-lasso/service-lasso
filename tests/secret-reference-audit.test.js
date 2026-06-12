import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { promisify } from "node:util";
import { execFile as execFileCallback } from "node:child_process";
import { rm } from "node:fs/promises";
import { startApiServer } from "../dist/server/index.js";
import { assertNoSecretMaterial } from "../dist/testing/secretLeakHarness.js";
import { makeTempServicesRoot, writeManifest } from "./test-helpers.js";

const execFile = promisify(execFileCallback);
const rawSecretSentinel = "SERVICE_LASSO_FAKE_SECRET_SENTINEL_TOKEN_DO_NOT_USE";

async function getJson(url) {
  const response = await fetch(url);
  return {
    status: response.status,
    body: await response.json(),
  };
}

async function writeSecretAuditFixture(servicesRoot) {
  await writeManifest(servicesRoot, "audit-consumer", {
    id: "audit-consumer",
    name: "Audit Consumer",
    description: "Service with declared and undeclared secret references.",
    env: {
      DECLARED_TOKEN: "\${secretsbroker.API_TOKEN}",
      UNDECLARED_PASSWORD: "\${secretsbroker.DB_PASSWORD}",
      MALFORMED_SECRET: "\${LOCAL_SECRET_TOKEN}",
      RAW_SENTINEL: rawSecretSentinel,
    },
    config: {
      files: [
        {
          path: "config/app.env",
          content: "API=\${secretsbroker.API_TOKEN}\nRAW=" + rawSecretSentinel,
        },
      ],
    },
    broker: {
      imports: [
        {
          namespace: "secretsbroker",
          ref: "secretsbroker.API_TOKEN",
          as: "DECLARED_TOKEN",
          required: true,
        },
      ],
    },
  });
}

async function writeRotationReadinessFixture(servicesRoot) {
  await writeSecretAuditFixture(servicesRoot);
  await writeManifest(servicesRoot, "rotation-consumer", {
    id: "rotation-consumer",
    name: "Rotation Consumer",
    description: "Service with a declared rotate-capable secret reference.",
    env: {
      ROTATE_TOKEN: "\${secretsbroker.ROTATE_TOKEN}",
      RAW_SENTINEL: rawSecretSentinel,
    },
    broker: {
      imports: [
        {
          namespace: "secretsbroker",
          ref: "secretsbroker.ROTATE_TOKEN",
          as: "ROTATE_TOKEN",
          required: true,
        },
      ],
      exports: [
        {
          namespace: "secretsbroker",
          ref: "secretsbroker.ROTATE_TOKEN",
          source: "env.ROTATE_TOKEN",
          required: true,
        },
      ],
      writeback: {
        allowedNamespaces: ["secretsbroker"],
        allowedOperations: ["rotate"],
        allowedRefs: ["secretsbroker.ROTATE_TOKEN"],
        generatedSecrets: [
          {
            ref: "secretsbroker.ROTATE_TOKEN",
            source: "env.ROTATE_TOKEN",
            operation: "rotate",
            required: true,
          },
        ],
      },
    },
  });
}

async function writeProviderAuthNotRequiredFixture(servicesRoot) {
  await writeManifest(servicesRoot, "no-auth-consumer", {
    id: "no-auth-consumer",
    name: "No Auth Consumer",
    description: "Service with a declared broker ref and no rotate-capable writeback.",
    env: {
      API_TOKEN: "\${secretsbroker.API_TOKEN}",
      RAW_SENTINEL: rawSecretSentinel,
    },
    broker: {
      imports: [
        {
          namespace: "secretsbroker",
          ref: "secretsbroker.API_TOKEN",
          as: "API_TOKEN",
          required: true,
        },
      ],
    },
  });
}

async function writeProviderAuthRequiredFixture(servicesRoot) {
  await writeManifest(servicesRoot, "auth-required-consumer", {
    id: "auth-required-consumer",
    name: "Auth Required Consumer",
    description: "Service with a rotate-capable ref that needs broker auth confirmation.",
    env: {
      ROTATE_TOKEN: "\${secretsbroker.ROTATE_TOKEN}",
      RAW_SENTINEL: rawSecretSentinel,
    },
    broker: {
      imports: [
        {
          namespace: "secretsbroker",
          ref: "secretsbroker.ROTATE_TOKEN",
          as: "ROTATE_TOKEN",
          required: true,
        },
      ],
      exports: [
        {
          namespace: "secretsbroker",
          ref: "secretsbroker.ROTATE_TOKEN",
          source: "env.ROTATE_TOKEN",
          required: true,
        },
      ],
      writeback: {
        allowedNamespaces: ["secretsbroker"],
        allowedOperations: ["rotate"],
        allowedRefs: ["secretsbroker.ROTATE_TOKEN"],
        generatedSecrets: [
          {
            ref: "secretsbroker.ROTATE_TOKEN",
            source: "env.ROTATE_TOKEN",
            operation: "rotate",
            required: true,
          },
        ],
      },
    },
  });
}

test("secret reference audit reports declared missing and malformed refs without raw values", async () => {
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-secret-audit-");
  await writeSecretAuditFixture(servicesRoot);
  const apiServer = await startApiServer({ port: 0, servicesRoot });

  try {
    const result = await getJson(apiServer.url + "/api/secrets/audit");
    assert.equal(result.status, 200);
    assert.equal(result.body.summary.services, 1);
    assert.equal(result.body.summary.present, 3);
    assert.equal(result.body.summary.missing, 1);
    assert.equal(result.body.summary.malformed, 1);
    assertNoSecretMaterial(result.body);

    const findings = result.body.services[0].findings;
    const declaredToken = findings.find((finding) => finding.ref === "secretsbroker.API_TOKEN" && finding.status === "present");
    assert.equal(declaredToken.accessPolicy.status, "missing");
    assert.ok(findings.some((finding) => finding.ref === "secretsbroker.DB_PASSWORD" && finding.status === "missing"));
    assert.ok(findings.some((finding) => finding.ref === "LOCAL_SECRET_TOKEN" && finding.status === "malformed"));

    const serviceResult = await getJson(apiServer.url + "/api/services/audit-consumer/secrets/audit");
    assert.equal(serviceResult.status, 200);
    assert.equal(serviceResult.body.serviceId, "audit-consumer");
    assert.deepEqual(serviceResult.body.summary, result.body.services[0].summary);
    assertNoSecretMaterial(serviceResult.body);
  } finally {
    await apiServer.stop();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("secret reference audit reports broker access policy assignment without raw values", async () => {
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-secret-policy-audit-");
  await writeManifest(servicesRoot, "policy-consumer", {
    id: "policy-consumer",
    name: "Policy Consumer",
    description: "Service with explicit broker access policy assignment.",
    env: {
      API_TOKEN: "\${secretsbroker.API_TOKEN}",
      DENIED_TOKEN: "\${secretsbroker.DENIED_TOKEN}",
      RAW_SENTINEL: rawSecretSentinel,
    },
    broker: {
      imports: [
        {
          namespace: "shared/secretsbroker",
          ref: "secretsbroker.API_TOKEN",
          as: "API_TOKEN",
          required: true,
        },
      ],
      accessPolicy: {
        serviceId: "policy-consumer",
        workspace: "local-demo",
        grants: [
          {
            namespace: "shared/secretsbroker",
            scope: "shared",
            refs: ["secretsbroker.API_TOKEN"],
            operations: ["resolve"],
            purpose: "read API token metadata for runtime startup",
          },
        ],
      },
    },
  });
  const apiServer = await startApiServer({ port: 0, servicesRoot });

  try {
    const result = await getJson(apiServer.url + "/api/secrets/audit");
    assert.equal(result.status, 200);
    assertNoSecretMaterial(result.body);

    const findings = result.body.services[0].findings;
    const allowed = findings.find((finding) => finding.ref === "secretsbroker.API_TOKEN" && finding.source === "broker.import");
    assert.equal(allowed.accessPolicy.status, "allowed");
    assert.equal(allowed.accessPolicy.operation, "resolve");

    const denied = findings.find((finding) => finding.ref === "secretsbroker.DENIED_TOKEN");
    assert.equal(denied.status, "missing");
    assert.equal(denied.accessPolicy.status, "not_applicable");
  } finally {
    await apiServer.stop();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("secret rotation readiness classifies policy capability and auth states without raw values", async () => {
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-secret-rotation-readiness-");
  await writeRotationReadinessFixture(servicesRoot);
  const apiServer = await startApiServer({ port: 0, servicesRoot });

  try {
    const result = await getJson(apiServer.url + "/api/secrets/rotation-readiness");
    assert.equal(result.status, 200);
    assert.equal(result.body.summary.services, 2);
    assert.equal(result.body.summary.needsPolicy, 1);
    assert.equal(result.body.summary.needsCapability, 1);
    assert.equal(result.body.summary.needsAuthCheck, 1);
    assert.equal(result.body.summary.blocked, 1);
    assertNoSecretMaterial(result.body);

    const auditConsumer = result.body.services.find((service) => service.serviceId === "audit-consumer");
    assert.ok(auditConsumer.refs.some((ref) => ref.ref === "secretsbroker.API_TOKEN" && ref.status === "needs_capability"));
    assert.ok(auditConsumer.refs.some((ref) => ref.ref === "secretsbroker.DB_PASSWORD" && ref.status === "needs_policy"));
    assert.ok(auditConsumer.refs.some((ref) => ref.ref === "LOCAL_SECRET_TOKEN" && ref.status === "blocked"));

    const rotationConsumer = result.body.services.find((service) => service.serviceId === "rotation-consumer");
    const rotateRef = rotationConsumer.refs.find((ref) => ref.ref === "secretsbroker.ROTATE_TOKEN");
    assert.equal(rotateRef.status, "needs_auth_check");
    assert.equal(rotateRef.policy.status, "declared");
    assert.equal(rotateRef.providerCapability.status, "supported");
    assert.equal(rotateRef.authRequirement.status, "unknown");
    assert.deepEqual(rotateRef.blockers, ["provider_auth_requirement_unknown"]);
    assert.ok(rotateRef.lastUsed.locations.includes("broker.writeback.generatedSecrets[0].ref"));

    const serviceResult = await getJson(apiServer.url + "/api/services/rotation-consumer/secrets/rotation-readiness");
    assert.equal(serviceResult.status, 200);
    assert.equal(serviceResult.body.serviceId, "rotation-consumer");
    assert.equal(serviceResult.body.summary.needsAuthCheck, 1);
    assertNoSecretMaterial(serviceResult.body);
  } finally {
    await apiServer.stop();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("provider auth-required summary reports no auth-required refs without raw values", async () => {
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-secret-auth-none-");
  await writeProviderAuthNotRequiredFixture(servicesRoot);
  const apiServer = await startApiServer({ port: 0, servicesRoot });

  try {
    const result = await getJson(apiServer.url + "/api/secrets/provider-auth-required");
    assert.equal(result.status, 200);
    assert.equal(result.body.summary.services, 1);
    assert.equal(result.body.summary.references, 1);
    assert.equal(result.body.summary.authRequired, 0);
    assert.equal(result.body.summary.notRequired, 1);
    assert.equal(result.body.summary.blocked, 0);
    assert.deepEqual(result.body.providers, []);
    assertNoSecretMaterial(result.body);

    const serviceResult = await getJson(apiServer.url + "/api/services/no-auth-consumer/secrets/provider-auth-required");
    assert.equal(serviceResult.status, 200);
    assert.equal(serviceResult.body.serviceId, "no-auth-consumer");
    assert.equal(serviceResult.body.refs[0].ref, "secretsbroker.API_TOKEN");
    assert.equal(serviceResult.body.refs[0].status, "not_required");
    assertNoSecretMaterial(serviceResult.body);
  } finally {
    await apiServer.stop();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("provider auth-required summary identifies provider refs that need broker auth confirmation", async () => {
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-secret-auth-required-");
  await writeProviderAuthRequiredFixture(servicesRoot);
  const apiServer = await startApiServer({ port: 0, servicesRoot });

  try {
    const result = await getJson(apiServer.url + "/api/secrets/provider-auth-required");
    assert.equal(result.status, 200);
    assert.equal(result.body.summary.authRequired, 1);
    assert.equal(result.body.summary.notRequired, 0);
    assert.equal(result.body.summary.blocked, 0);
    assert.deepEqual(result.body.providers, [
      {
        provider: "secretsbroker",
        authRequiredRefs: 1,
        services: ["auth-required-consumer"],
        refs: ["secretsbroker.ROTATE_TOKEN"],
      },
    ]);
    assertNoSecretMaterial(result.body);

    const serviceResult = await getJson(apiServer.url + "/api/services/auth-required-consumer/secrets/provider-auth-required");
    assert.equal(serviceResult.status, 200);
    assert.equal(serviceResult.body.refs[0].status, "auth_required");
    assert.deepEqual(serviceResult.body.refs[0].blockers, ["provider_auth_required"]);
    assertNoSecretMaterial(serviceResult.body);
  } finally {
    await apiServer.stop();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("provider auth-required summary handles mixed provider states", async () => {
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-secret-auth-mixed-");
  await writeProviderAuthNotRequiredFixture(servicesRoot);
  await writeProviderAuthRequiredFixture(servicesRoot);
  const apiServer = await startApiServer({ port: 0, servicesRoot });

  try {
    const result = await getJson(apiServer.url + "/api/secrets/provider-auth-required");
    assert.equal(result.status, 200);
    assert.equal(result.body.summary.services, 2);
    assert.equal(result.body.summary.references, 2);
    assert.equal(result.body.summary.authRequired, 1);
    assert.equal(result.body.summary.notRequired, 1);
    assert.equal(result.body.summary.blocked, 0);

    const byService = Object.fromEntries(result.body.services.map((service) => [service.serviceId, service]));
    assert.equal(byService["no-auth-consumer"].summary.notRequired, 1);
    assert.equal(byService["auth-required-consumer"].summary.authRequired, 1);
    assert.equal(result.body.providers[0].provider, "secretsbroker");
    assert.equal(result.body.providers[0].authRequiredRefs, 1);
    assertNoSecretMaterial(result.body);
  } finally {
    await apiServer.stop();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("CLI secrets audit returns the same safe reference metadata", async () => {
  const { tempRoot, servicesRoot, workspaceRoot } = await makeTempServicesRoot("service-lasso-secret-audit-cli-");
  await writeSecretAuditFixture(servicesRoot);

  try {
    const stdout = await execFile(
      process.execPath,
      [
        path.resolve("dist", "cli.js"),
        "secrets",
        "audit",
        "audit-consumer",
        "--services-root",
        servicesRoot,
        "--workspace-root",
        workspaceRoot,
        "--json",
      ],
      {
        cwd: path.resolve("."),
        env: {
          ...process.env,
          npm_package_version: "0.1.0-test",
        },
      },
    );
    const result = JSON.parse(stdout.stdout);
    assert.equal(result.action, "audit");
    assert.equal(result.serviceId, "audit-consumer");
    assert.equal(result.summary.present, 3);
    assert.equal(result.summary.missing, 1);
    assert.equal(result.summary.malformed, 1);
    assertNoSecretMaterial(result);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("CLI secrets rotation-readiness returns the same safe classification metadata", async () => {
  const { tempRoot, servicesRoot, workspaceRoot } = await makeTempServicesRoot("service-lasso-secret-rotation-cli-");
  await writeRotationReadinessFixture(servicesRoot);

  try {
    const stdout = await execFile(
      process.execPath,
      [
        path.resolve("dist", "cli.js"),
        "secrets",
        "rotation-readiness",
        "rotation-consumer",
        "--services-root",
        servicesRoot,
        "--workspace-root",
        workspaceRoot,
        "--json",
      ],
      {
        cwd: path.resolve("."),
        env: {
          ...process.env,
          npm_package_version: "0.1.0-test",
        },
      },
    );
    const result = JSON.parse(stdout.stdout);
    assert.equal(result.action, "rotation-readiness");
    assert.equal(result.serviceId, "rotation-consumer");
    assert.equal(result.summary.needsAuthCheck, 1);
    assert.equal(result.refs[0].providerCapability.status, "supported");
    assertNoSecretMaterial(result);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("CLI secrets provider-auth-required returns the same safe summary metadata", async () => {
  const { tempRoot, servicesRoot, workspaceRoot } = await makeTempServicesRoot("service-lasso-secret-auth-cli-");
  await writeProviderAuthRequiredFixture(servicesRoot);

  try {
    const stdout = await execFile(
      process.execPath,
      [
        path.resolve("dist", "cli.js"),
        "secrets",
        "provider-auth-required",
        "auth-required-consumer",
        "--services-root",
        servicesRoot,
        "--workspace-root",
        workspaceRoot,
        "--json",
      ],
      {
        cwd: path.resolve("."),
        env: {
          ...process.env,
          npm_package_version: "0.1.0-test",
        },
      },
    );
    const result = JSON.parse(stdout.stdout);
    assert.equal(result.action, "provider-auth-required");
    assert.equal(result.serviceId, "auth-required-consumer");
    assert.equal(result.summary.authRequired, 1);
    assert.equal(result.refs[0].status, "auth_required");
    assertNoSecretMaterial(result);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
