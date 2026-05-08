import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { readFile, rm } from "node:fs/promises";
import { startApiServer } from "../dist/server/index.js";
import {
  authorizeScopedBrokerWriteback,
  BROKER_CREDENTIAL_ENV,
  BROKER_CREDENTIAL_EXPIRES_AT_ENV,
  BROKER_IDENTITY_ID_ENV,
  mintScopedBrokerIdentity,
  resetScopedBrokerIdentities,
} from "../dist/runtime/broker/identity.js";
import { resetLifecycleState } from "../dist/runtime/lifecycle/store.js";
import { readStoredState } from "../dist/runtime/state/readState.js";
import { makeTempServicesRoot, writeExecutableFixtureService } from "./test-helpers.js";

function fixtureService() {
  return {
    manifestPath: path.join(process.cwd(), "services", "writer", "service.json"),
    serviceRoot: path.join(process.cwd(), "services", "writer"),
    manifest: {
      id: "writer",
      name: "Writer",
      description: "Broker writeback identity test fixture.",
      broker: {
        writeback: {
          allowedNamespaces: ["services/writer"],
          allowedOperations: ["create", "rotate"],
          allowedRefs: ["writer.API_TOKEN"],
          auditReason: "test writeback",
        },
      },
    },
  };
}

async function postJson(url) {
  const response = await fetch(url, { method: "POST" });
  return {
    status: response.status,
    body: await response.json(),
  };
}

async function waitFor(predicate, timeoutMs = 1_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Condition not met within ${timeoutMs}ms`);
}

test("scoped broker credentials allow only the launched service writeback scope", () => {
  resetScopedBrokerIdentities();
  const issuedAt = new Date("2026-05-08T06:00:00.000Z");
  const credential = mintScopedBrokerIdentity(fixtureService(), { now: issuedAt, ttlMs: 1_000 });
  assert.ok(credential);

  const allowed = authorizeScopedBrokerWriteback(credential.token, {
    serviceId: "writer",
    namespace: "services/writer",
    ref: "writer.API_TOKEN",
    operation: "create",
    now: new Date("2026-05-08T06:00:00.500Z"),
  });
  assert.equal(allowed.ok, true);
  assert.equal(allowed.reason, "allowed");
  assert.equal(allowed.audit?.serviceId, "writer");
  assert.equal(allowed.audit?.identityId, credential.metadata.id);
  assert.equal(allowed.audit?.reason, "test writeback");

  assert.equal(
    authorizeScopedBrokerWriteback(credential.token, {
      serviceId: "other-service",
      namespace: "services/writer",
      ref: "writer.API_TOKEN",
      operation: "create",
      now: new Date("2026-05-08T06:00:00.500Z"),
    }).reason,
    "service-mismatch",
  );
  assert.equal(
    authorizeScopedBrokerWriteback(credential.token, {
      serviceId: "writer",
      namespace: "shared/database",
      ref: "writer.API_TOKEN",
      operation: "create",
      now: new Date("2026-05-08T06:00:00.500Z"),
    }).reason,
    "namespace-denied",
  );
  assert.equal(
    authorizeScopedBrokerWriteback(credential.token, {
      serviceId: "writer",
      namespace: "services/writer",
      ref: "writer.OTHER_TOKEN",
      operation: "create",
      now: new Date("2026-05-08T06:00:00.500Z"),
    }).reason,
    "ref-denied",
  );
  assert.equal(
    authorizeScopedBrokerWriteback(credential.token, {
      serviceId: "writer",
      namespace: "services/writer",
      ref: "writer.API_TOKEN",
      operation: "delete",
      now: new Date("2026-05-08T06:00:00.500Z"),
    }).reason,
    "operation-denied",
  );
  assert.equal(
    authorizeScopedBrokerWriteback(credential.token, {
      serviceId: "writer",
      namespace: "services/writer",
      ref: "writer.API_TOKEN",
      operation: "create",
      now: new Date("2026-05-08T06:00:01.000Z"),
    }).reason,
    "expired",
  );
  assert.equal(JSON.stringify(credential.metadata).includes(credential.token), false);
});

test("runtime injects scoped broker credential without persisting or logging raw authority", async () => {
  resetLifecycleState();
  resetScopedBrokerIdentities();
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-broker-identity-");
  const { serviceRoot } = await writeExecutableFixtureService(servicesRoot, "writer", {
    captureEnvKeys: [BROKER_IDENTITY_ID_ENV, BROKER_CREDENTIAL_ENV, BROKER_CREDENTIAL_EXPIRES_AT_ENV],
    broker: {
      writeback: {
        allowedNamespaces: ["services/writer"],
        allowedOperations: ["create", "rotate"],
        allowedRefs: ["writer.API_TOKEN"],
        auditReason: "capture writer token",
      },
    },
  });
  const apiServer = await startApiServer({ port: 0, servicesRoot });

  try {
    await postJson(`${apiServer.url}/api/services/writer/install`);
    await postJson(`${apiServer.url}/api/services/writer/config`);
    const start = await postJson(`${apiServer.url}/api/services/writer/start`);
    assert.equal(start.status, 200);
    assert.equal(start.body.state.running, true);
    assert.equal(typeof start.body.state.runtime.brokerIdentity.id, "string");
    assert.equal(start.body.state.runtime.brokerIdentity.serviceId, "writer");

    const envPath = path.join(serviceRoot, "runtime", "env.json");
    await waitFor(async () => {
      try {
        const env = JSON.parse(await readFile(envPath, "utf8"));
        return typeof env[BROKER_CREDENTIAL_ENV] === "string";
      } catch {
        return false;
      }
    });

    const env = JSON.parse(await readFile(envPath, "utf8"));
    assert.equal(env[BROKER_IDENTITY_ID_ENV], start.body.state.runtime.brokerIdentity.id);
    assert.equal(typeof env[BROKER_CREDENTIAL_ENV], "string");
    assert.equal(typeof env[BROKER_CREDENTIAL_EXPIRES_AT_ENV], "string");

    const decision = authorizeScopedBrokerWriteback(env[BROKER_CREDENTIAL_ENV], {
      serviceId: "writer",
      namespace: "services/writer",
      ref: "writer.API_TOKEN",
      operation: "rotate",
    });
    assert.equal(decision.ok, true);
    assert.equal(decision.audit?.serviceId, "writer");

    const storedRunning = await readStoredState(serviceRoot);
    assert.equal(JSON.stringify(start.body).includes(env[BROKER_CREDENTIAL_ENV]), false);
    assert.equal(JSON.stringify(storedRunning.runtime).includes(env[BROKER_CREDENTIAL_ENV]), false);

    const stop = await postJson(`${apiServer.url}/api/services/writer/stop`);
    assert.equal(stop.status, 200);
    assert.equal(stop.body.state.running, false);
    assert.equal(typeof stop.body.state.runtime.brokerIdentity.revokedAt, "string");
    assert.equal(
      authorizeScopedBrokerWriteback(env[BROKER_CREDENTIAL_ENV], {
        serviceId: "writer",
        namespace: "services/writer",
        ref: "writer.API_TOKEN",
        operation: "rotate",
      }).reason,
      "revoked",
    );
  } finally {
    await apiServer.stop();
    resetLifecycleState();
    resetScopedBrokerIdentities();
    await rm(tempRoot, { recursive: true, force: true });
  }
});
