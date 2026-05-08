import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { mapZitadelSessionToPlatformContext } from "../dist/platform/facade.js";
import {
  assertProviderLifecyclePayloadSecretSafe,
  createProviderLifecycleUnavailableResponse,
  normalizeProviderConnectionLifecycleStatus,
  providerConnectionLifecycleEndpoints,
  providerConnectionLifecycleFixtures,
} from "../dist/platform/providerConnectionLifecycle.js";

const repoRoot = process.cwd();

const forbiddenSecrets = [
  "raw-provider-secret",
  "correct-horse-battery-staple",
  "access-token-value",
  "refresh-token-value",
  "private-key-material",
  "client_secret=",
  "recovery phrase",
];

function operatorContext() {
  const context = mapZitadelSessionToPlatformContext({
    issuer: "http://localhost:8080",
    subject: "zitadel-user-operator",
  });
  assert.ok(context);
  return context;
}

test("provider lifecycle API exposes stable action endpoints", () => {
  assert.deepEqual(providerConnectionLifecycleEndpoints, {
    connect: "POST /api/platform/workspaces/{workspaceId}/provider-connections/{connectionId}/connect",
    reconnect: "POST /api/platform/workspaces/{workspaceId}/provider-connections/{connectionId}/reconnect",
    refresh: "POST /api/platform/workspaces/{workspaceId}/provider-connections/{connectionId}/refresh",
    test: "POST /api/platform/workspaces/{workspaceId}/provider-connections/{connectionId}/test",
    disable: "POST /api/platform/workspaces/{workspaceId}/provider-connections/{connectionId}/disable",
    disconnect: "POST /api/platform/workspaces/{workspaceId}/provider-connections/{connectionId}/disconnect",
  });
  assertProviderLifecyclePayloadSecretSafe(providerConnectionLifecycleEndpoints);
});

test("provider lifecycle fixtures cover healthy expiring auth-required refresh-failed revoked disconnected and deleted states", () => {
  assert.equal(providerConnectionLifecycleFixtures.healthy.lifecycleStatus, "connected");
  assert.equal(providerConnectionLifecycleFixtures.expiring.lifecycleStatus, "expiring");
  assert.equal(providerConnectionLifecycleFixtures.missing.lifecycleStatus, "source_auth_required");
  assert.equal(providerConnectionLifecycleFixtures.refreshFailed.lifecycleStatus, "refresh_failed");
  assert.equal(providerConnectionLifecycleFixtures.denied.lifecycleStatus, "permission_changed");
  assert.equal(providerConnectionLifecycleFixtures.revoked.lifecycleStatus, "revoked");
  assert.equal(providerConnectionLifecycleFixtures.reconnectRequired.lifecycleStatus, "reconnect_required");
  assert.equal(providerConnectionLifecycleFixtures.deleted.lifecycleStatus, "deleted");

  for (const fixture of Object.values(providerConnectionLifecycleFixtures)) {
    assert.equal(fixture.connection.secretMaterialPresent, false);
    assert.ok(fixture.connection.secretRef?.startsWith("provider."));
    assertProviderLifecyclePayloadSecretSafe(fixture);
  }
});

test("provider lifecycle status normalization covers connected expiring failure and degraded states", () => {
  assert.equal(normalizeProviderConnectionLifecycleStatus({ metadataStatus: "ready" }), "connected");
  assert.equal(
    normalizeProviderConnectionLifecycleStatus({ metadataStatus: "ready", expiresAt: "2026-05-08T23:00:00Z" }),
    "expiring",
  );
  assert.equal(normalizeProviderConnectionLifecycleStatus({ lastRefreshFailed: true }), "refresh_failed");
  assert.equal(normalizeProviderConnectionLifecycleStatus({ scopesChanged: true }), "permission_changed");
  assert.equal(normalizeProviderConnectionLifecycleStatus({ metadataStatus: "needs-auth" }), "source_auth_required");
  assert.equal(normalizeProviderConnectionLifecycleStatus({ metadataStatus: "refresh-failed" }), "refresh_failed");
  assert.equal(normalizeProviderConnectionLifecycleStatus({ metadataStatus: "expiring" }), "expiring");
  assert.equal(normalizeProviderConnectionLifecycleStatus({ metadataStatus: "revoked" }), "revoked");
  assert.equal(normalizeProviderConnectionLifecycleStatus({ metadataStatus: "disabled" }), "disabled");
  assert.equal(normalizeProviderConnectionLifecycleStatus({ metadataStatus: "deleted" }), "deleted");
  assert.equal(normalizeProviderConnectionLifecycleStatus({ metadataStatus: "error" }), "degraded");
});

test("unimplemented provider-specific lifecycle flows return actionable setup-needed or unavailable errors", () => {
  const context = operatorContext();
  const missing = createProviderLifecycleUnavailableResponse(context, providerConnectionLifecycleFixtures.missing, {
    action: "connect",
    connectionId: "pc_slack_missing",
    provider: "slack",
    requestedAt: "2026-05-08T11:05:00Z",
  });
  assert.equal(missing.ok, false);
  assert.equal(missing.status, "source_auth_required");
  assert.equal(missing.error?.code, "setup-needed");
  assert.match(missing.error?.action ?? "", /setup flow/i);
  assert.equal(missing.auditEvent.outcome, "setup-needed");

  const reconnect = createProviderLifecycleUnavailableResponse(context, providerConnectionLifecycleFixtures.reconnectRequired, {
    action: "refresh",
    connectionId: "pc_calendar_reconnect",
    provider: "google-calendar",
    requestedAt: "2026-05-08T11:05:00Z",
  });
  assert.equal(reconnect.ok, false);
  assert.equal(reconnect.status, "reconnect_required");
  assert.equal(reconnect.error?.code, "source-auth-required");
  assert.match(reconnect.error?.action ?? "", /reconnect flow/i);
  assertProviderLifecyclePayloadSecretSafe([missing, reconnect]);
});

test("provider lifecycle authorization denial is fail-closed and secret-safe", () => {
  const context = { ...operatorContext(), entitlements: ["workspace:read"] };
  const denied = createProviderLifecycleUnavailableResponse(context, providerConnectionLifecycleFixtures.healthy, {
    action: "test",
    connectionId: "pc_github_ready",
    provider: "github",
    requestedAt: "2026-05-08T11:05:00Z",
  });

  assert.equal(denied.ok, false);
  assert.equal(denied.error?.code, "permission-denied");
  assert.equal(denied.auditEvent.outcome, "denied");
  assert.match(denied.auditEvent.safeDetail, /missing-entitlement/);
  assertProviderLifecyclePayloadSecretSafe(denied);
});

test("provider lifecycle docs and fixtures stay free of raw secrets key material and recovery material", async () => {
  const docs = await readFile(path.join(repoRoot, "docs", "reference", "product-api-facade.md"), "utf8");
  for (const requiredText of [
    "Provider connection lifecycle API",
    "connect",
    "reconnect",
    "refresh/test",
    "disconnect",
    "connected",
    "refresh_failed",
    "source_auth_required",
    "deleted",
    "setup-needed",
    "safe audit event",
  ]) {
    assert.ok(docs.includes(requiredText), `Expected docs to include ${requiredText}`);
  }

  const serializedFixtures = JSON.stringify(providerConnectionLifecycleFixtures);
  for (const secret of forbiddenSecrets) {
    assert.equal(serializedFixtures.includes(secret), false, `Fixture leaked ${secret}`);
  }
});
