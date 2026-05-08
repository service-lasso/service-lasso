import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  assertProviderConnectionMetadataOnly,
  authorizePlatformResource,
  examplePlatformFacadeState,
  mapZitadelSessionToPlatformContext,
  providerConnectionMetadataEndpoints,
} from "../dist/platform/facade.js";

const repoRoot = process.cwd();

const forbiddenSecrets = [
  "raw-provider-secret",
  "correct-horse-battery-staple",
  "access-token-value",
  "refresh-token-value",
  "private-key-material",
  "recovery phrase",
];

test("platform facade fixture defines users workspaces linked identities provider connections and roles", () => {
  assert.equal(examplePlatformFacadeState.users.length, 1);
  assert.equal(examplePlatformFacadeState.workspaces.length, 1);
  assert.equal(examplePlatformFacadeState.linkedIdentities.length, 1);
  assert.equal(examplePlatformFacadeState.providerConnections.length, 1);
  assert.equal(examplePlatformFacadeState.roles.length, 1);

  const connection = examplePlatformFacadeState.providerConnections[0];
  assert.equal(connection.workspaceId, examplePlatformFacadeState.workspaces[0].id);
  assert.equal(connection.ownerUserId, examplePlatformFacadeState.users[0].id);
  assert.equal(connection.secretMaterialPresent, false);
  assert.equal(connection.secretRef, "provider.github.oauth.client");
  assert.equal(connection.status, "ready");
  assert.doesNotThrow(() => assertProviderConnectionMetadataOnly(connection));
});

test("provider connection metadata API exposes CRUD endpoints without secret payload endpoints", () => {
  assert.deepEqual(providerConnectionMetadataEndpoints, {
    list: "GET /api/platform/workspaces/{workspaceId}/provider-connections",
    create: "POST /api/platform/workspaces/{workspaceId}/provider-connections",
    read: "GET /api/platform/workspaces/{workspaceId}/provider-connections/{connectionId}",
    update: "PATCH /api/platform/workspaces/{workspaceId}/provider-connections/{connectionId}",
  });

  const serializedEndpoints = JSON.stringify(providerConnectionMetadataEndpoints);
  assert.equal(serializedEndpoints.includes("secret-value"), false);
  assert.equal(serializedEndpoints.includes("token-value"), false);
});

test("ZITADEL session context maps to internal user workspace and entitlements", () => {
  const context = mapZitadelSessionToPlatformContext({
    issuer: "http://localhost:8080",
    subject: "zitadel-user-operator",
    email: "operator@example.test",
  });

  assert.ok(context);
  assert.equal(context.userId, "usr_01hzy9operator");
  assert.equal(context.workspaceId, "wks_local_demo");
  assert.equal(context.linkedIdentityId, "lid_zitadel_operator");
  assert.ok(context.entitlements.includes("secrets-broker:resolve"));
  assert.ok(context.entitlements.includes("workflow:run"));

  assert.equal(
    mapZitadelSessionToPlatformContext({
      issuer: "http://localhost:8080",
      subject: "unknown-user",
    }),
    undefined,
  );
});

test("authorization boundaries fail closed for workspace mismatch missing entitlement and connection readiness", () => {
  const context = mapZitadelSessionToPlatformContext({
    issuer: "http://localhost:8080",
    subject: "zitadel-user-operator",
  });
  assert.ok(context);

  const connection = examplePlatformFacadeState.providerConnections[0];
  assert.deepEqual(authorizePlatformResource(context, { kind: "provider-connection", connection }), {
    allowed: true,
    reason: "allowed",
    requiredEntitlements: ["provider-connection:use"],
  });

  assert.equal(
    authorizePlatformResource(
      { ...context, workspaceId: "wks_other" },
      { kind: "provider-connection", connection },
    ).reason,
    "workspace-mismatch",
  );

  assert.equal(
    authorizePlatformResource(
      { ...context, entitlements: ["workspace:read"] },
      { kind: "secrets-broker-ref", workspaceId: context.workspaceId, brokerNamespace: "workspaces/local-demo/provider-connections/github", ref: "provider.github.oauth.client" },
    ).reason,
    "missing-entitlement",
  );

  assert.equal(
    authorizePlatformResource(context, {
      kind: "provider-connection",
      connection: { ...connection, status: "needs-auth" },
    }).reason,
    "connection-not-ready",
  );
});

test("provider connection metadata rejects raw secret and recovery material fields", () => {
  const connection = examplePlatformFacadeState.providerConnections[0];
  assert.throws(
    () => assertProviderConnectionMetadataOnly({ ...connection, secretMaterialPresent: true }),
    /raw secret material/,
  );
  assert.throws(
    () =>
      assertProviderConnectionMetadataOnly({
        ...connection,
        displayName: "raw-provider-secret",
      }),
    /secret-like value/,
  );
  assert.throws(
    () =>
      assertProviderConnectionMetadataOnly({
        ...connection,
        // Contract guard for accidental expansion outside the typed shape.
        accessToken: "access-token-value",
      }),
    /secret-like field accessToken/,
  );
});

test("product facade docs and fixture stay metadata-only", async () => {
  const docs = await readFile(path.join(repoRoot, "docs", "reference", "product-api-facade.md"), "utf8");
  const fixture = JSON.stringify(examplePlatformFacadeState);

  for (const requiredText of [
    "users",
    "workspaces",
    "linked_identities",
    "provider_connections",
    "roles/entitlements",
    "GET   /api/platform/workspaces/{workspaceId}/provider-connections",
    "ZITADEL session mapping",
    "Secrets Broker checks",
    "must not be stored or returned by the facade",
  ]) {
    assert.ok(docs.includes(requiredText), `Expected docs to include ${requiredText}`);
  }

  for (const secret of forbiddenSecrets) {
    assert.equal(fixture.includes(secret), false, `Fixture leaked ${secret}`);
  }
});
