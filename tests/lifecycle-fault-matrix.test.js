import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const matrixPath = new URL("../docs/reference/lifecycle-fault-injection-matrix.md", import.meta.url);

const requiredScenarios = [
  "crash before every atomic state write",
  "crash after every atomic state write",
  "crash after reservation, materialisation, spawn, ownership persistence, and readiness",
  "truncated registry or journal",
  "corrupt registry or journal",
  "unsupported-version registry or journal",
  "stale PID",
  "live PID owned by this workspace",
  "reused PID or unverifiable PID",
  "stale lifecycle or allocation lock",
  "concurrently contested lifecycle or allocation lock",
  "preferred-port collision",
  "fixed conflict and bind race after reservation",
  "wildcard versus loopback overlap",
  "two workspaces and two generations starting concurrently",
  "service with child and grandchild processes",
  "failure midway through dependent rematerialisation or restart",
  "stop/restart when runtime API is unavailable",
  "canonical checkout versus worktree wrong-lane verification",
];

const requiredInvariants = [
  "no unrelated or unverified process is terminated",
  "no two committed endpoints overlap",
  "one workspace has at most one authoritative active generation",
  "durable state either describes reality or reports an explicit blocked/recovery state",
  "rerunning the same command converges",
  "temporary files, locks, reservations, and runtime resources do not remain indefinitely",
  "final diagnosis is stable and machine-readable",
];

test("lifecycle fault-injection matrix maps every required #881 scenario", async () => {
  const matrix = await readFile(matrixPath, "utf8");

  for (const scenario of requiredScenarios) {
    assert.match(matrix, new RegExp(escapeRegExp(scenario)), `missing scenario: ${scenario}`);
  }
});

test("lifecycle fault-injection matrix records safety invariants and production boundary", async () => {
  const matrix = await readFile(matrixPath, "utf8");

  for (const invariant of requiredInvariants) {
    assert.match(matrix, new RegExp(escapeRegExp(invariant)), `missing invariant: ${invariant}`);
  }

  assert.match(matrix, /test-only fixtures or harness controls/);
  assert.match(matrix, /must not be reachable from production runtime APIs, CLI commands, manifests, service environment, or packaged release builds/);
});

test("lifecycle fault-injection matrix maps rows to automation and closure confidence", async () => {
  const matrix = await readFile(matrixPath, "utf8");
  const rows = matrix
    .split(/\r?\n/)
    .filter((line) => /^\| FI-\d{3} \|/.test(line));

  assert.equal(rows.length, requiredScenarios.length);

  for (const row of rows) {
    const cells = row.split("|").map((cell) => cell.trim());
    const automation = cells[5];
    const invariants = cells[6];
    const status = cells[7];

    assert.match(automation, /(existing|planned|npm run|tests\/)/, `missing automation mapping in ${row}`);
    assert.match(status, /^(planned|partial|implemented)$/, `unexpected status in ${row}`);
    assert.match(invariants, /INV-[1-7]/, `missing invariant IDs in ${row}`);
  }

  assert.match(matrix, /bounded timeout and cleanup evidence/);
  assert.match(matrix, /documented platform-unavailable contract test with explicit confidence limits/);
});

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
