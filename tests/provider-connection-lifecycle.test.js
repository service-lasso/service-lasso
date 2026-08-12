import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { mapZitadelSessionToPlatformContext } from "../dist/platform/facade.js";
import {
  assertProviderLifecyclePayloadSecretSafe,
  createProviderLifecycleUnavailableResponse,
  normalizeProviderConnectionLifecycleStatus,
  providerConnectionLifecycleBoundary,
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

test("provider lifecycle API exposes metadata-only action endpoints", () => {
  assert.equal(providerConnectionLifecycleBoundary.scope, "secrets-broker-source-metadata-only");
  assert.ok(providerConnectionLifecycleBoundary.excludes.includes("provider-oauth"));
  assert.ok(providerConnectionLifecycleBoundary.excludes.includes("provider-token-refresh"));
  assert.ok(providerConnectionLifecycleBoundary.excludes.includes("oidc-callbacks"));

  assert.deepEqual(providerConnectionLifecycleEndpoints, {
    recordSourceAuthRequired: "POST /api/platform/workspaces/{workspaceId}/provider-connections/{connectionId}/record-source-auth-required",
    recordReconnectRequired: "POST /api/platform/workspaces/{workspaceId}/provider-connections/{connectionId}/record-reconnect-required",
    refreshMetadata: "POST /api/platform/workspaces/{workspaceId}/provider-connections/{connectionId}/refresh-metadata",
    testMetadata: "POST /api/platform/workspaces/{workspaceId}/provider-connections/{connectionId}/test-metadata",
    disableMetadata: "POST /api/platform/workspaces/{workspaceId}/provider-connections/{connectionId}/disable-metadata",
    disconnectMetadata: "POST /api/platform/workspaces/{workspaceId}/provider-connections/{connectionId}/disconnect-metadata",
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
    action: "record-source-auth-required",
    connectionId: "pc_slack_missing",
    provider: "slack",
    requestedAt: "2026-05-08T11:05:00Z",
  });
  assert.equal(missing.ok, false);
  assert.equal(missing.status, "source_auth_required");
  assert.equal(missing.error?.code, "setup-needed");
  assert.match(missing.error?.action ?? "", /owning service/i);
  assert.equal(missing.auditEvent.outcome, "setup-needed");

  const reconnect = createProviderLifecycleUnavailableResponse(context, providerConnectionLifecycleFixtures.reconnectRequired, {
    action: "refresh-metadata",
    connectionId: "pc_calendar_reconnect",
    provider: "google-calendar",
    requestedAt: "2026-05-08T11:05:00Z",
  });
  assert.equal(reconnect.ok, false);
  assert.equal(reconnect.status, "reconnect_required");
  assert.equal(reconnect.error?.code, "source-auth-required");
  assert.match(reconnect.error?.action ?? "", /reconnect-required metadata/i);
  assertProviderLifecyclePayloadSecretSafe([missing, reconnect]);
});

test("provider lifecycle authorization denial is fail-closed and secret-safe", () => {
  const context = { ...operatorContext(), entitlements: ["workspace:read"] };
  const denied = createProviderLifecycleUnavailableResponse(context, providerConnectionLifecycleFixtures.healthy, {
    action: "test-metadata",
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
    "Secrets Broker source metadata lifecycle API",
    "record-source-auth-required",
    "record-reconnect-required",
    "refresh-metadata",
    "test-metadata",
    "disconnect-metadata",
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
