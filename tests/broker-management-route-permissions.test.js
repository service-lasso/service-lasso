import assert from "node:assert/strict";
import test from "node:test";

import {
  brokerRotationMutationRequiresOrchestration,
  matchBrokerManagementProxyRoute,
  responseContainsForbiddenBrokerMaterial,
} from "../dist/server/index.js";

const base = "http://127.0.0.1:4001";

function match(method, path) {
  return matchBrokerManagementProxyRoute(method, new URL(path, base));
}

test("broker management proxy maps only canonical routes with fail-closed permissions", () => {
  const expected = [
    ["GET", "/api/services/%40secretsbroker/secrets/management", "workspace:read", false],
    ["GET", "/api/services/%40secretsbroker/secrets/value-search?query=token", "security:manage", false],
    ["POST", "/api/services/%40secretsbroker/secrets/reveal", "security:manage", true],
    ["POST", "/api/services/%40secretsbroker/secrets/create/dry-run", "security:manage", false],
    ["POST", "/api/services/%40secretsbroker/secrets/create/apply", "security:manage", true],
    ["POST", "/api/services/%40secretsbroker/secrets/edit/dry-run", "security:manage", false],
    ["POST", "/api/services/%40secretsbroker/secrets/edit/apply", "security:manage", true],
    ["POST", "/api/services/%40secretsbroker/secrets/reset/dry-run", "security:manage", false],
    ["POST", "/api/services/%40secretsbroker/secrets/reset/apply", "security:manage", true],
    ["POST", "/api/services/%40secretsbroker/secrets/decommission/dry-run", "security:manage", false],
    ["POST", "/api/services/%40secretsbroker/secrets/decommission/apply", "security:manage", true],
    ["POST", "/api/services/%40secretsbroker/secrets/decommission/restore", "security:manage", true],
    ["POST", "/api/services/%40secretsbroker/secrets/rotation/dry-run", "security:manage", false],
    ["POST", "/api/services/%40secretsbroker/secrets/rotation/status", "workspace:read", false],
    ["POST", "/api/services/%40secretsbroker/secrets/rotation/stage", "security:manage", true],
    ["POST", "/api/services/%40secretsbroker/secrets/rotation/activate", "security:manage", true],
    ["POST", "/api/services/%40secretsbroker/secrets/rotation/rollback", "security:manage", true],
    ["POST", "/api/services/%40secretsbroker/secrets/rotation/retire", "security:manage", true],
    ["POST", "/api/services/%40secretsbroker/secrets/campaigns/create", "security:manage", false],
    ["POST", "/api/services/%40secretsbroker/secrets/campaigns/revalidate", "security:manage", false],
    ["POST", "/api/services/%40secretsbroker/secrets/campaigns/apply", "security:manage", true],
    ["POST", "/api/services/%40secretsbroker/secrets/campaigns/status", "workspace:read", false],
    ["POST", "/api/services/%40secretsbroker/secrets/sync/dry-run", "security:manage", false],
    ["POST", "/api/services/%40secretsbroker/secrets/policy/preview", "security:manage", false],
    ["POST", "/api/services/%40secretsbroker/secrets/policy/apply", "security:manage", true],
    ["POST", "/api/services/%40secretsbroker/secrets/lockouts/clear", "security:manage", true],
    ["GET", "/api/services/%40secretsbroker/providers/capabilities", "workspace:read", false],
    ["GET", "/api/services/%40secretsbroker/providers/config/status", "workspace:read", false],
    ["POST", "/api/services/%40secretsbroker/providers/config/validate", "security:manage", false],
    ["POST", "/api/services/%40secretsbroker/providers/config/apply", "security:manage", true],
    ["POST", "/api/services/%40secretsbroker/providers/migration/dry-run", "security:manage", false],
    ["POST", "/api/services/%40secretsbroker/providers/migration/apply", "security:manage", true],
    ["GET", "/api/services/%40secretsbroker/lifecycle/status", "security:manage", false],
    ["GET", "/api/services/%40secretsbroker/lifecycle/backups", "backup:read", false],
    ["POST", "/api/services/%40secretsbroker/lifecycle/backups/create", "backup:create", false],
    ["POST", "/api/services/%40secretsbroker/lifecycle/backups/verify", "backup:read", false],
    ["POST", "/api/services/%40secretsbroker/lifecycle/restore/dry-run", "backup:restore", false],
    ["POST", "/api/services/%40secretsbroker/lifecycle/restore/apply", "backup:restore", true],
    ["POST", "/api/services/%40secretsbroker/lifecycle/key/rotate", "security:manage", true],
    ["GET", "/api/services/%40secretsbroker/operations/telemetry", "workspace:read", false],
    ["GET", "/api/services/%40secretsbroker/operations/events?limit=25", "workspace:read", false],
  ];

  for (const [method, path, permission, sensitive] of expected) {
    const route = match(method, path);
    assert.ok(route, `${method} ${path} should be mapped`);
    assert.equal(route.permission, permission, `${method} ${path} permission`);
    assert.equal(route.sensitive, sensitive, `${method} ${path} sensitivity`);
  }

  assert.equal(match("GET", "/api/services/%40secretsbroker/secrets/reveal"), null);
  assert.equal(match("POST", "/api/services/%40secretsbroker/secrets/unknown"), null);
  assert.equal(match("POST", "/api/services/other/secrets/edit/apply"), null);
  assert.equal(match("GET", "/api/services/%40secretsbroker/lifecycle/key/rotate"), null);
});

test("broker inventory query forwarding is bounded and route-specific", () => {
  const search = "x".repeat(400);
  const inventory = match(
    "GET",
    `/api/services/%40secretsbroker/secrets/management?search=${search}&redirect=https://example.test`,
  );
  assert.ok(inventory);
  const brokerUrl = new URL(inventory.brokerPath, base);
  assert.equal(brokerUrl.pathname, "/v1/management/secrets");
  assert.equal(brokerUrl.searchParams.get("search"), "x".repeat(256));
  assert.equal(brokerUrl.searchParams.has("redirect"), false);
});

test("broker event query forwarding is bounded and allowlisted", () => {
  const route = match(
    "GET",
    "/api/services/%40secretsbroker/operations/events?severity=warning&family=auth_failure&limit=25&cursor=10&redirect=https://example.test&operation=" + "x".repeat(400),
  );
  assert.ok(route);
  const brokerUrl = new URL(route.brokerPath, base);
  assert.equal(brokerUrl.pathname, "/v1/events");
  assert.equal(brokerUrl.searchParams.get("severity"), "warning");
  assert.equal(brokerUrl.searchParams.get("family"), "auth_failure");
  assert.equal(brokerUrl.searchParams.get("limit"), "25");
  assert.equal(brokerUrl.searchParams.get("cursor"), "10");
  assert.equal(brokerUrl.searchParams.get("operation"), "x".repeat(256));
  assert.equal(brokerUrl.searchParams.has("redirect"), false);

  const invalidNumeric = match(
    "GET",
    "/api/services/%40secretsbroker/operations/events?limit=all&cursor=-1",
  );
  assert.ok(invalidNumeric);
  assert.equal(new URL(invalidNumeric.brokerPath, base).search, "");
});

test("broker lifecycle response boundary rejects nested key, credential, share, and payload material", () => {
  const safe = {
    key: { keyId: "mk-safe-fingerprint", keyVersion: "v1", secretCount: 3 },
    recovery: { policy: { shareFingerprints: ["sha256-safe"] } },
    backups: [{ backupId: "backup-safe", artifactHash: "sha256:safe", verification: "verified" }],
  };
  assert.equal(responseContainsForbiddenBrokerMaterial(safe, false), false);
  for (const unsafe of [
    { credentialValue: "raw" },
    { nested: { masterKey: "raw" } },
    { nested: [{ recoveryShare: "raw" }] },
    { backup: { payload: { ciphertext: "opaque-but-not-ui-safe" } } },
    { passphrase: "raw" },
  ]) {
    assert.equal(responseContainsForbiddenBrokerMaterial(unsafe, false), true);
  }
});

test("broker telemetry response boundary permits only finite numeric metric values", () => {
  assert.equal(
    responseContainsForbiddenBrokerMaterial({ metrics: [{ name: "broker.requests", value: 3 }] }, false, 0, true),
    false,
  );
  assert.equal(
    responseContainsForbiddenBrokerMaterial({ metrics: [{ name: "broker.requests", value: "raw" }] }, false, 0, true),
    true,
  );
  assert.equal(
    responseContainsForbiddenBrokerMaterial({ metrics: [{ name: "broker.requests", value: 3, token: "raw" }] }, false, 0, true),
    true,
  );
});

test("direct Broker rotation mutations fail closed when Core finds linked consumers", () => {
  const linkedPlan = { services: [{ serviceId: "api" }] };
  const unlinkedPlan = { services: [] };

  for (const operation of ["stage", "activate", "rollback", "retire"]) {
    const path = `/v1/management/secrets/rotation/${operation}`;
    assert.equal(brokerRotationMutationRequiresOrchestration(path, linkedPlan), true);
    assert.equal(brokerRotationMutationRequiresOrchestration(path, unlinkedPlan), false);
  }
  assert.equal(
    brokerRotationMutationRequiresOrchestration(
      "/v1/management/secrets/rotation/status",
      linkedPlan,
    ),
    false,
  );
  assert.equal(
    brokerRotationMutationRequiresOrchestration(
      "/v1/management/secrets/rotation/dry-run",
      linkedPlan,
    ),
    false,
  );
});
