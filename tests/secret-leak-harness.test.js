import test from "node:test";
import assert from "node:assert/strict";
import {
  assertNoSecretMaterial,
  scanForSecretMaterial,
  serviceLassoSecretLeakSentinels,
} from "../dist/testing/secretLeakHarness.js";

test("secret leak harness detects project sentinel values across nested surfaces", () => {
  const payload = {
    route: "/safe",
    page: {
      title: "Secrets Broker",
      text: `value=${serviceLassoSecretLeakSentinels[0].value}`,
    },
    storage: ["metadata only"],
  };

  const findings = scanForSecretMaterial(payload);

  assert.deepEqual(
    findings.map((finding) => [finding.kind, finding.label, finding.path]),
    [["sentinel", "service-lasso-fake-token", "$.page.text"]],
  );
  assert.throws(
    () => assertNoSecretMaterial(payload),
    /Secret material leak detected/,
  );
});

test("secret leak harness detects common credential shapes", () => {
  const findings = scanForSecretMaterial({
    log: "Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456",
  });

  assert.deepEqual(
    findings.map((finding) => [finding.kind, finding.label]),
    [["credential-shape", "bearer-token"]],
  );
});

test("secret leak harness allows metadata-only broker surfaces", () => {
  assertNoSecretMaterial({
    ref: "api.DB_PASSWORD",
    status: "policy-denied",
    required: true,
    valuePresent: true,
    fingerprint: "0123456789abcdef",
  });
});
