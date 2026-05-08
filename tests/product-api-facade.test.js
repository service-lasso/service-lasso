import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  assertProviderConnectionMetadataOnly,
  authorizePlatformResource,
  examplePlatformFacadeState,
  mapZitadelSessionToPlatformContext,
  platformAuditMetadataIncludesSecretMaterial,
  providerConnectionMetadataEndpoints,
  resolveServiceLassoRequestContext,
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
  assert.equal(examplePlatformFacadeState.serviceIdentities.length, 1);

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
  assert.equal(context.instanceId, "inst_local_demo");
  assert.equal(context.actor.kind, "user");
  assert.equal(context.authMethod, "zitadel-session");
  assert.deepEqual(context.audit, {
    actorKind: "user",
    actorId: "usr_01hzy9operator",
    workspaceId: "wks_local_demo",
    instanceId: "inst_local_demo",
    linkedIdentityId: "lid_zitadel_operator",
    authMethod: "zitadel-session",
  });
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

test("request context resolver covers fail-closed session and service identity states", () => {
  const resolved = resolveServiceLassoRequestContext({
    kind: "zitadel-session",
    session: {
      issuer: "http://localhost:8080",
      subject: "zitadel-user-operator",
      expiresAt: "2026-05-08T10:30:00Z",
    },
    workspaceId: "wks_local_demo",
    instanceId: "inst_local_demo",
    now: new Date("2026-05-08T10:05:00Z"),
  });
  assert.equal(resolved.ok, true);
  assert.equal(resolved.ok && resolved.context.workspaceId, "wks_local_demo");
  assert.equal(resolved.ok && platformAuditMetadataIncludesSecretMaterial(resolved.context.audit), false);

  assert.deepEqual(
    resolveServiceLassoRequestContext({ kind: "zitadel-session", instanceId: "inst_local_demo" }),
    {
      ok: false,
      reason: "unauthenticated",
      status: 401,
      safeMessage: "Missing ZITADEL session.",
      audit: undefined,
    },
  );

  const expired = resolveServiceLassoRequestContext({
    kind: "zitadel-session",
    session: {
      issuer: "http://localhost:8080",
      subject: "zitadel-user-operator",
      expiresAt: "2026-05-08T09:59:00Z",
    },
    instanceId: "inst_local_demo",
    now: new Date("2026-05-08T10:05:00Z"),
  });
  assert.equal(expired.ok, false);
  assert.equal(!expired.ok && expired.reason, "expired-session");
  assert.equal(!expired.ok && expired.status, 401);

  const mismatch = resolveServiceLassoRequestContext({
    kind: "zitadel-session",
    session: { issuer: "http://localhost:8080", subject: "zitadel-user-operator" },
    workspaceId: "wks_other",
    instanceId: "inst_local_demo",
  });
  assert.equal(mismatch.ok, false);
  assert.equal(!mismatch.ok && mismatch.reason, "workspace-mismatch");
  assert.equal(!mismatch.ok && platformAuditMetadataIncludesSecretMaterial(mismatch.audit), false);

  const service = resolveServiceLassoRequestContext({
    kind: "service-identity",
    service: { serviceId: "@node", workspaceId: "wks_local_demo", instanceId: "inst_local_demo" },
    workspaceId: "wks_local_demo",
    instanceId: "inst_local_demo",
  });
  assert.equal(service.ok, true);
  assert.equal(service.ok && service.context.actor.kind, "service");
  assert.equal(service.ok && service.context.authMethod, "service-identity");
  assert.ok(service.ok && service.context.entitlements.includes("secrets-broker:resolve"));

  const deniedService = resolveServiceLassoRequestContext({
    kind: "service-identity",
    service: { serviceId: "writer", workspaceId: "wks_local_demo", instanceId: "inst_local_demo" },
    workspaceId: "wks_local_demo",
    instanceId: "inst_local_demo",
  });
  assert.equal(deniedService.ok, false);
  assert.equal(!deniedService.ok && deniedService.reason, "service-identity-denied");
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
    "request_context",
    "service_identities",
    "roles/entitlements",
    "GET   /api/platform/workspaces/{workspaceId}/provider-connections",
    "ZITADEL session mapping",
    "Service-authenticated requests",
    "service-identity-denied`",
    "Secrets Broker checks",
    "must not be stored or returned by the facade",
  ]) {
    assert.ok(docs.includes(requiredText), `Expected docs to include ${requiredText}`);
  }

  for (const secret of forbiddenSecrets) {
    assert.equal(fixture.includes(secret), false, `Fixture leaked ${secret}`);
  }
});
