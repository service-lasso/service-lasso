import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { readFile, rm, writeFile } from "node:fs/promises";
import { startApiServer } from "../dist/server/index.js";
import {
  authorizeScopedBrokerWriteback,
  BROKER_CREDENTIAL_ENV,
  BROKER_CREDENTIAL_EXPIRES_AT_ENV,
  BROKER_IDENTITY_ID_ENV,
  BROKER_IDENTITY_LEASE_ENV,
  BROKER_TRANSPORT_BINDING_KIND_ENV,
  BROKER_TRANSPORT_BINDING_SUBJECT_ENV,
  mintScopedBrokerIdentity,
  resolveLauncherTransportBinding,
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

test("scoped broker credentials can carry transport binding metadata", () => {
  resetScopedBrokerIdentities();
  const issuedAt = new Date("2026-05-08T06:00:00.000Z");
  const credential = mintScopedBrokerIdentity(fixtureService(), {
    now: issuedAt,
    ttlMs: 1_000,
    transportBinding: {
      kind: "windows-sid",
      subject: "S-1-5-21-1000",
    },
  });
  assert.ok(credential);

  assert.deepEqual(credential.metadata.transportBinding, {
    kind: "windows-sid",
    subject: "S-1-5-21-1000",
  });
  assert.equal(credential.env[BROKER_TRANSPORT_BINDING_KIND_ENV], "windows-sid");
  assert.equal(credential.env[BROKER_TRANSPORT_BINDING_SUBJECT_ENV], "S-1-5-21-1000");
  assert.equal(JSON.stringify(credential.metadata).includes(credential.token), false);
});

test("launcher transport binding prefers explicit policy environment", () => {
  assert.deepEqual(
    resolveLauncherTransportBinding({
      [BROKER_TRANSPORT_BINDING_KIND_ENV]: "windows-sid",
      [BROKER_TRANSPORT_BINDING_SUBJECT_ENV]: "S-1-5-21-2000",
    }),
    {
      kind: "windows-sid",
      subject: "S-1-5-21-2000",
    },
  );
  assert.deepEqual(
    resolveLauncherTransportBinding({
      [BROKER_TRANSPORT_BINDING_KIND_ENV]: "windows-sid",
    }),
    process.platform === "win32"
      ? null
      : { kind: "unix-uid", subject: String(process.getuid()) },
  );
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

test("runtime can inject a broker-issued signed launch lease without persisting raw authority", async () => {
  resetLifecycleState();
  resetScopedBrokerIdentities();
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-broker-lease-");
  const helperPath = path.join(tempRoot, "issue-lease-helper.mjs");
  await writeFile(
    helperPath,
    `
const args = process.argv.slice(2);
function flag(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
}
const refs = args.flatMap((arg, index) => arg === "--allowed-ref" ? [args[index + 1]] : []);
const namespaces = args.flatMap((arg, index) => arg === "--allowed-namespace" ? [args[index + 1]] : []);
const operations = args.flatMap((arg, index) => arg === "--operation" ? [args[index + 1]] : []);
const lease = {
  issuer: "service-lasso-local-launcher",
  serviceId: flag("--service-id"),
  workspaceId: flag("--workspace-id"),
  allowedRefs: refs,
  allowedNamespaces: namespaces,
  allowedOperations: operations,
  issuedAt: flag("--issued-at"),
  expiresAt: flag("--expires-at"),
  jti: flag("--jti"),
  transportBinding: {
    kind: flag("--transport-binding-kind"),
    subject: flag("--transport-binding-subject"),
  },
  signature: "hmac-sha256:test-signature"
};
process.stdout.write(JSON.stringify({ serviceId: "@secretsbroker", apiVersion: "test", outcome: "ready", lease }));
`.trim(),
  );
  const { serviceRoot } = await writeExecutableFixtureService(servicesRoot, "writer", {
    captureEnvKeys: [BROKER_IDENTITY_ID_ENV, BROKER_CREDENTIAL_ENV, BROKER_IDENTITY_LEASE_ENV],
    broker: {
      imports: [
        {
          namespace: "shared/writer",
          ref: "writer.API_TOKEN",
          required: false,
        },
      ],
      writeback: {
        allowedNamespaces: ["services/writer"],
        allowedOperations: ["create", "rotate"],
        allowedRefs: ["writer.GENERATED_TOKEN"],
        auditReason: "capture writer token",
      },
    },
  });
  const priorCommand = process.env.SERVICE_LASSO_SECRETSBROKER_LAUNCH_LEASE_COMMAND;
  const priorArgs = process.env.SERVICE_LASSO_SECRETSBROKER_LAUNCH_LEASE_ARGS_JSON;
  const priorSigningKey = process.env.SECRETSBROKER_LAUNCH_IDENTITY_SIGNING_KEY;
  const priorBindingKind = process.env.SERVICE_LASSO_BROKER_TRANSPORT_BINDING_KIND;
  const priorBindingSubject = process.env.SERVICE_LASSO_BROKER_TRANSPORT_BINDING_SUBJECT;
  process.env.SERVICE_LASSO_SECRETSBROKER_LAUNCH_LEASE_COMMAND = process.execPath;
  process.env.SERVICE_LASSO_SECRETSBROKER_LAUNCH_LEASE_ARGS_JSON = JSON.stringify([helperPath]);
  process.env.SECRETSBROKER_LAUNCH_IDENTITY_SIGNING_KEY = "SERVICE_LASSO_FAKE_SIGNING_KEY_DO_NOT_USE";
  process.env.SERVICE_LASSO_BROKER_TRANSPORT_BINDING_KIND = "windows-sid";
  process.env.SERVICE_LASSO_BROKER_TRANSPORT_BINDING_SUBJECT = "S-1-5-21-lease-test";
  const apiServer = await startApiServer({ port: 0, servicesRoot });

  try {
    await postJson(`${apiServer.url}/api/services/writer/install`);
    await postJson(`${apiServer.url}/api/services/writer/config`);
    const start = await postJson(`${apiServer.url}/api/services/writer/start`);
    assert.equal(start.status, 200);

    const envPath = path.join(serviceRoot, "runtime", "env.json");
    await waitFor(async () => {
      try {
        const env = JSON.parse(await readFile(envPath, "utf8"));
        return typeof env[BROKER_IDENTITY_LEASE_ENV] === "string";
      } catch {
        return false;
      }
    });

    const env = JSON.parse(await readFile(envPath, "utf8"));
    const lease = JSON.parse(env[BROKER_IDENTITY_LEASE_ENV]);
    assert.equal(lease.serviceId, "writer");
    assert.equal(lease.workspaceId, "local-demo");
    assert.deepEqual(lease.transportBinding, {
      kind: "windows-sid",
      subject: "S-1-5-21-lease-test",
    });
    assert.deepEqual(lease.allowedNamespaces, ["services/writer", "shared/writer"]);
    assert.deepEqual(lease.allowedOperations, ["create", "resolve", "rotate"]);
    assert.equal(lease.allowedRefs.includes("shared/writer/writer.API_TOKEN"), true);
    assert.equal(lease.allowedRefs.includes("services/writer/writer.GENERATED_TOKEN"), true);

    const storedRunning = await readStoredState(serviceRoot);
    assert.equal(JSON.stringify(start.body).includes("SERVICE_LASSO_FAKE_SIGNING_KEY_DO_NOT_USE"), false);
    assert.equal(JSON.stringify(storedRunning.runtime).includes("SERVICE_LASSO_FAKE_SIGNING_KEY_DO_NOT_USE"), false);
    assert.equal(JSON.stringify(storedRunning.runtime).includes("hmac-sha256:test-signature"), false);

    await postJson(`${apiServer.url}/api/services/writer/stop`);
  } finally {
    await apiServer.stop();
    if (priorCommand === undefined) {
      delete process.env.SERVICE_LASSO_SECRETSBROKER_LAUNCH_LEASE_COMMAND;
    } else {
      process.env.SERVICE_LASSO_SECRETSBROKER_LAUNCH_LEASE_COMMAND = priorCommand;
    }
    if (priorArgs === undefined) {
      delete process.env.SERVICE_LASSO_SECRETSBROKER_LAUNCH_LEASE_ARGS_JSON;
    } else {
      process.env.SERVICE_LASSO_SECRETSBROKER_LAUNCH_LEASE_ARGS_JSON = priorArgs;
    }
    if (priorSigningKey === undefined) {
      delete process.env.SECRETSBROKER_LAUNCH_IDENTITY_SIGNING_KEY;
    } else {
      process.env.SECRETSBROKER_LAUNCH_IDENTITY_SIGNING_KEY = priorSigningKey;
    }
    if (priorBindingKind === undefined) {
      delete process.env.SERVICE_LASSO_BROKER_TRANSPORT_BINDING_KIND;
    } else {
      process.env.SERVICE_LASSO_BROKER_TRANSPORT_BINDING_KIND = priorBindingKind;
    }
    if (priorBindingSubject === undefined) {
      delete process.env.SERVICE_LASSO_BROKER_TRANSPORT_BINDING_SUBJECT;
    } else {
      process.env.SERVICE_LASSO_BROKER_TRANSPORT_BINDING_SUBJECT = priorBindingSubject;
    }
    resetLifecycleState();
    resetScopedBrokerIdentities();
    await rm(tempRoot, { recursive: true, force: true });
  }
});
