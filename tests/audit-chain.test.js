import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  appendAuditEvent,
  readAuditEvents,
  verifyAuditFile,
} from "../dist/runtime/audit/store.js";

async function makeWorkspace() {
  return mkdtemp(path.join(tmpdir(), "service-lasso-audit-chain-"));
}

async function appendRuntimeEvent(workspaceRoot, action, timestampOffset = 0) {
  const event = await appendAuditEvent({
    workspaceRoot,
    source: "runtime-api",
    action,
    actor: "operator-ui",
    subject: "runtime",
    outcome: "success",
    statusCode: 200,
    summary: `audit chain ${action}`,
    metadata: {
      sequenceProbe: timestampOffset,
    },
  });
  return event;
}

function runtimeAuditFile(workspaceRoot, event) {
  return path.join(workspaceRoot, ".service-lasso", "audit", "runtime", `${event.timestamp.slice(0, 10)}.jsonl`);
}

test("audit appends include verified hash-chain metadata", async () => {
  const workspaceRoot = await makeWorkspace();

  try {
    const first = await appendRuntimeEvent(workspaceRoot, "runtime.first", 1);
    const second = await appendRuntimeEvent(workspaceRoot, "runtime.second", 2);
    const filePath = runtimeAuditFile(workspaceRoot, first);
    const verification = await verifyAuditFile(filePath);

    assert.equal(first.chainId, "runtime");
    assert.equal(first.sequence, 1);
    assert.equal(first.previousHash, null);
    assert.match(first.eventHash, /^[a-f0-9]{64}$/u);
    assert.equal(first.chainStatus, "verified");
    assert.equal(second.sequence, 2);
    assert.equal(second.previousHash, first.eventHash);
    assert.equal(verification.chainStatus, "verified");
    assert.deepEqual(verification.events.map((event) => event.chainStatus), ["verified", "verified"]);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("audit chain identity follows the durable destination instead of service metadata", async () => {
  const workspaceRoot = await makeWorkspace();
  const serviceRoot = path.join(workspaceRoot, "services", "alpha-service");

  try {
    await mkdir(serviceRoot, { recursive: true });
    const relatedServiceEvent = await appendAuditEvent({
      workspaceRoot,
      serviceId: "alpha-service",
      source: "runtime-api",
      action: "operator.confirmation.confirm",
      actor: "operator-ui",
      subject: "alpha-service",
      outcome: "failure",
      statusCode: 403,
      summary: "runtime denial with related service metadata",
      reason: "actor_mismatch",
    });
    const runtimeEvent = await appendRuntimeEvent(workspaceRoot, "runtime.second", 2);
    const serviceEvent = await appendAuditEvent({
      serviceRoot,
      serviceId: "alpha-service",
      source: "service",
      action: "service.config",
      actor: "operator-ui",
      subject: "alpha-service",
      outcome: "success",
      statusCode: 200,
      summary: "service-root event",
    });
    const runtimeResponse = await readAuditEvents({ workspaceRoot });
    const serviceResponse = await readAuditEvents({ serviceRoots: [serviceRoot] });

    assert.equal(relatedServiceEvent.chainId, "runtime");
    assert.equal(relatedServiceEvent.serviceId, "alpha-service");
    assert.equal(runtimeEvent.chainId, "runtime");
    assert.equal(runtimeEvent.sequence, 2);
    assert.equal(runtimeEvent.previousHash, relatedServiceEvent.eventHash);
    assert.equal(runtimeResponse.chainStatus, "verified");
    assert.equal(runtimeResponse.pagination.total, 2);
    assert.deepEqual(runtimeResponse.events.map((event) => event.chainId), ["runtime", "runtime"]);
    assert.equal(serviceEvent.chainId, "service:alpha-service");
    assert.equal(serviceResponse.chainStatus, "verified");
    assert.equal(serviceResponse.pagination.total, 1);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("audit verifier detects modified, deleted, and reordered chain lines", async () => {
  const workspaceRoot = await makeWorkspace();

  try {
    const first = await appendRuntimeEvent(workspaceRoot, "runtime.first", 1);
    await appendRuntimeEvent(workspaceRoot, "runtime.second", 2);
    await appendRuntimeEvent(workspaceRoot, "runtime.third", 3);
    const filePath = runtimeAuditFile(workspaceRoot, first);
    const originalLines = (await readFile(filePath, "utf8")).trim().split(/\r?\n/u);

    const modified = originalLines.map((line, index) => {
      if (index !== 1) return line;
      const event = JSON.parse(line);
      event.summary = "audit chain modified";
      return JSON.stringify(event);
    });
    await writeFile(filePath, `${modified.join("\n")}\n`, "utf8");
    assert.equal((await verifyAuditFile(filePath)).chainStatus, "broken");

    await writeFile(filePath, `${[originalLines[0], originalLines[2]].join("\n")}\n`, "utf8");
    assert.equal((await verifyAuditFile(filePath)).chainStatus, "broken");

    await writeFile(filePath, `${[originalLines[1], originalLines[0], originalLines[2]].join("\n")}\n`, "utf8");
    assert.equal((await verifyAuditFile(filePath)).chainStatus, "broken");
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("audit verifier reports legacy files as unavailable and read API surfaces chain status", async () => {
  const workspaceRoot = await makeWorkspace();

  try {
    const runtimeDir = path.join(workspaceRoot, ".service-lasso", "audit", "runtime");
    const filePath = path.join(runtimeDir, "2026-08-11.jsonl");
    await mkdir(runtimeDir, { recursive: true });
    await writeFile(
      filePath,
      `${JSON.stringify({
        id: "legacy-1",
        timestamp: "2026-08-11T00:00:00.000Z",
        source: "runtime-api",
        action: "runtime.legacy",
        actor: "operator-ui",
        outcome: "success",
        statusCode: 200,
        summary: "legacy audit event",
        reason: null,
        correlationId: "corr-legacy",
        relatedRevisionId: null,
      })}\n`,
      "utf8",
    );

    const verification = await verifyAuditFile(filePath);
    const response = await readAuditEvents({ workspaceRoot });

    assert.equal(verification.chainStatus, "unavailable");
    assert.equal(response.events[0].chainStatus, "unavailable");
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("service audit chains continue across date buckets and legacy single-file storage", async () => {
  const workspaceRoot = await makeWorkspace();
  const serviceRoot = path.join(workspaceRoot, "services", "bucketed-service");
  const auditDir = path.join(serviceRoot, ".state", "audit");

  try {
    await mkdir(serviceRoot, { recursive: true });
    const first = await appendAuditEvent({
      serviceRoot,
      serviceId: "bucketed-service",
      source: "service",
      action: "service.first",
      actor: "operator-ui",
      outcome: "success",
      statusCode: 200,
      summary: "first bucketed service event",
    });
    const currentFile = path.join(auditDir, `${first.timestamp.slice(0, 10)}.jsonl`);
    await rename(currentFile, path.join(auditDir, "events.jsonl"));

    const second = await appendAuditEvent({
      serviceRoot,
      serviceId: "bucketed-service",
      source: "service",
      action: "service.second",
      actor: "operator-ui",
      outcome: "success",
      statusCode: 200,
      summary: "second bucketed service event",
    });
    const response = await readAuditEvents({ serviceRoots: [serviceRoot] });

    assert.equal(second.sequence, 2);
    assert.equal(second.previousHash, first.eventHash);
    assert.equal(response.chainStatus, "verified");
    assert.equal(response.pagination.total, 2);
    assert.deepEqual(response.events.map((event) => event.sequence), [2, 1]);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("audit directory verification reports corrupt rows without discarding prior valid events", async () => {
  const workspaceRoot = await makeWorkspace();
  const serviceRoot = path.join(workspaceRoot, "services", "corrupt-service");

  try {
    await mkdir(serviceRoot, { recursive: true });
    const event = await appendAuditEvent({
      serviceRoot,
      serviceId: "corrupt-service",
      source: "service",
      action: "service.valid",
      actor: "operator-ui",
      outcome: "success",
      statusCode: 200,
      summary: "valid event before corruption",
    });
    const filePath = path.join(serviceRoot, ".state", "audit", `${event.timestamp.slice(0, 10)}.jsonl`);
    await writeFile(filePath, `${await readFile(filePath, "utf8")}{not-json}\n`, "utf8");

    const response = await readAuditEvents({ serviceRoots: [serviceRoot] });

    assert.equal(response.chainStatus, "broken");
    assert.equal(response.pagination.total, 1);
    assert.equal(response.events[0].id, event.id);
    assert.equal(response.events[0].chainStatus, "broken");
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("concurrent service audit appends remain a single verified sequence", async () => {
  const workspaceRoot = await makeWorkspace();
  const serviceRoot = path.join(workspaceRoot, "services", "concurrent-service");

  try {
    await mkdir(serviceRoot, { recursive: true });
    const events = await Promise.all(Array.from({ length: 20 }, async (_, index) => appendAuditEvent({
      serviceRoot,
      serviceId: "concurrent-service",
      source: "service",
      action: `service.concurrent.${index}`,
      actor: "operator-ui",
      outcome: "success",
      statusCode: 200,
      summary: `concurrent service event ${index}`,
    })));
    const response = await readAuditEvents({ serviceRoots: [serviceRoot] });

    assert.deepEqual(events.map((event) => event.sequence), Array.from({ length: 20 }, (_, index) => index + 1));
    assert.equal(response.chainStatus, "verified");
    assert.equal(response.pagination.total, 20);
    assert.deepEqual(
      [...response.events].sort((left, right) => left.sequence - right.sequence).map((event) => event.sequence),
      Array.from({ length: 20 }, (_, index) => index + 1),
    );
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});
