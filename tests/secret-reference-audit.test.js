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
    assert.ok(findings.some((finding) => finding.ref === "secretsbroker.API_TOKEN" && finding.status === "present"));
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
