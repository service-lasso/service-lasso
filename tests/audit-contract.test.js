import test from "node:test";
import assert from "node:assert/strict";
import {
  buildAuditEvent,
  createAuditEventId,
  createAuditSummary,
  createAuditTimestamp,
} from "../dist/runtime/audit/events.js";

test("audit contract builds durable metadata-only events", () => {
  const event = buildAuditEvent({
    id: "audit_test_1",
    timestamp: "2026-06-28T00:00:00.000Z",
    source: "runtime",
    actor: {
      type: "operator",
      id: "operator:test",
      source: "web",
      display: "Operator",
    },
    action: "runtime.reload",
    outcome: "success",
    subjectType: "runtime",
    routeTemplate: "/api/runtime/actions/:action",
    method: "POST",
    statusCode: 200,
    summary: createAuditSummary(["Runtime", "reload", "completed"]),
    correlationId: "corr_1",
    metadata: {
      targetCount: 1,
      changedFieldCount: 0,
      policyDecision: "allowed",
    },
    chainStatus: "unavailable",
  });

  assert.equal(event.contractVersion, "service-lasso.audit-event.v1");
  assert.equal(event.kind, "durable-audit");
  assert.equal(event.source, "runtime");
  assert.equal(event.outcome, "success");
  assert.equal(event.rawMaterialReturned, undefined);
  assert.equal(JSON.stringify(event).includes("ACTUAL_SECRET"), false);
});

test("audit helpers create safe ids, timestamps, and summaries", () => {
  assert.match(createAuditEventId("Runtime Action"), /^runtime-action_[0-9a-f-]+$/);
  assert.equal(createAuditTimestamp(new Date("2026-06-28T00:01:02.003Z")), "2026-06-28T00:01:02.003Z");
  assert.equal(createAuditSummary(["config", "save", 2, "fields"]), "config save 2 fields");
  assert.throws(() => createAuditSummary(["  ", null, undefined]), /must not be empty/);
});

test("audit event builder rejects unsafe top-level and metadata field names", () => {
  const baseEvent = {
    source: "service",
    actor: {
      type: "operator",
      id: "operator:test",
    },
    action: "service.config.save",
    outcome: "success",
    subjectType: "service-config",
    serviceId: "alpha-service",
    summary: "Service config saved with safe revision metadata",
  };

  assert.throws(
    () =>
      buildAuditEvent({
        ...baseEvent,
        raw: "raw request body",
      }),
    /Unsafe audit field "raw"/,
  );

  assert.throws(
    () =>
      buildAuditEvent({
        ...baseEvent,
        metadata: {
          safeHash: "sha256:abc123",
          nested: {
            authorization: "Bearer example",
          },
        },
      }),
    /Unsafe audit field "authorization"/,
  );
});

test("#757 audit contract serialization omits secret and raw-payload sentinels", () => {
  const event = buildAuditEvent({
    id: "audit_regression_1",
    timestamp: "2026-08-31T00:00:00.000Z",
    source: "runtime",
    actor: {
      type: "operator",
      id: "operator:test",
      source: "web",
      display: "Operator",
    },
    action: "runtime.reload",
    outcome: "success",
    subjectType: "runtime",
    routeTemplate: "/api/runtime/actions/:action",
    method: "POST",
    statusCode: 200,
    summary: createAuditSummary(["Runtime", "reload", "completed"]),
    correlationId: "corr_757",
    metadata: {
      targetCount: 1,
      changedFieldCount: 0,
      policyDecision: "allowed",
      configPath: "service.json",
      validationStatus: "valid",
    },
    chainStatus: "verified",
  });

  const serialized = JSON.stringify(event);
  for (const sentinel of [
    "ACTUAL_SECRET",
    "RAW_SECRET",
    "BEGIN PRIVATE KEY",
    "PASSWORD=",
    "CLIENT_SECRET=",
    "REFRESH_TOKEN=",
    "BOT_TOKEN=",
    "Authorization",
    "RAW_REQUEST_BODY",
    "RAW_CONFIG_PAYLOAD",
    "RAW_STDIN_PAYLOAD",
    "RAW_LOG_LINE",
  ]) {
    assert.equal(serialized.includes(sentinel), false, `contract event leaked ${sentinel}`);
  }

  assert.throws(
    () =>
      buildAuditEvent({
        source: "service",
        actor: { type: "operator", id: "operator:test" },
        action: "service.config.save",
        outcome: "success",
        subjectType: "service-config",
        summary: "unsafe body field",
        body: "RAW_REQUEST_BODY",
      }),
    /Unsafe audit field "body"/,
  );
});
