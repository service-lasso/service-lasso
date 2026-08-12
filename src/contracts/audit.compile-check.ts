import { defineAuditEventInput } from "./audit.js";

defineAuditEventInput({
  source: "runtime",
  actor: {
    type: "system",
    id: "runtime",
  },
  action: "runtime.reload",
  outcome: "success",
  subjectType: "runtime",
  summary: "Runtime reload completed",
});

defineAuditEventInput({
  source: "service",
  actor: {
    type: "operator",
    id: "operator:test",
  },
  action: "service.config.save",
  outcome: "success",
  subjectType: "service-config",
  serviceId: "service-a",
  relatedRevisionId: "rev_123",
  summary: "Service config saved with revision metadata",
  metadata: {
    changedFieldCount: 3,
    currentHash: "sha256:abc123",
  },
});

defineAuditEventInput({
  source: "runtime",
  actor: {
    type: "system",
    id: "runtime",
  },
  action: "unsafe.example",
  outcome: "failure",
  subjectType: "runtime",
  summary: "Compile-time unsafe field check",
  // @ts-expect-error raw token payloads are not accepted as first-class audit fields.
  token: "never-store-token-material",
});
