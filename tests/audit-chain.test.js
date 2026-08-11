import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
