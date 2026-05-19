import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import {
  PortReservationConflictError,
  getPortReservationLedgerPath,
  readPortReservationLedger,
  reconcilePortReservationLedger,
  reservePorts,
} from "../dist/runtime/ports/reservations.js";

async function makeWorkspaceRoot() {
  return await mkdtemp(path.join(os.tmpdir(), "service-lasso-port-reservations-"));
}

test("port reservation ledger persists API and service reservations under workspace runtime state", async () => {
  const workspaceRoot = await makeWorkspaceRoot();
  try {
    const ledger = await reservePorts(
      workspaceRoot,
      [
        { kind: "api", ownerId: "runtime-api", portName: "http", port: 18080 },
        { kind: "service-fixed", ownerId: "@nginx", portName: "http", port: 18081 },
        { kind: "service-negotiated", ownerId: "echo-service", portName: "service", port: 18082 },
      ],
      "2026-05-20T00:00:00.000Z",
    );

    assert.equal(ledger.reservations.length, 3);
    assert.deepEqual(
      ledger.reservations.map((reservation) => [reservation.kind, reservation.ownerId, reservation.portName, reservation.port]),
      [
        ["api", "runtime-api", "http", 18080],
        ["service-fixed", "@nginx", "http", 18081],
        ["service-negotiated", "echo-service", "service", 18082],
      ],
    );

    const raw = JSON.parse(await readFile(getPortReservationLedgerPath(workspaceRoot), "utf8"));
    assert.equal(raw.version, 1);
    assert.equal(raw.updatedAt, "2026-05-20T00:00:00.000Z");
    assert.equal(raw.reservations[0].host, "127.0.0.1");

    const reloaded = await readPortReservationLedger(workspaceRoot);
    assert.deepEqual(reloaded, ledger);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("port reservation ledger fails closed when a live port is already owned", async () => {
  const workspaceRoot = await makeWorkspaceRoot();
  try {
    await reservePorts(
      workspaceRoot,
      [{ kind: "api", ownerId: "runtime-api", portName: "http", port: 18080 }],
      "2026-05-20T00:00:00.000Z",
    );

    await assert.rejects(
      reservePorts(
        workspaceRoot,
        [{ kind: "service-negotiated", ownerId: "echo-service", portName: "service", port: 18080 }],
        "2026-05-20T00:01:00.000Z",
      ),
      PortReservationConflictError,
    );
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("port reservation ledger marks missing active reservations stale during reconciliation", async () => {
  const workspaceRoot = await makeWorkspaceRoot();
  try {
    await reservePorts(
      workspaceRoot,
      [
        { kind: "api", ownerId: "runtime-api", portName: "http", port: 18080 },
        { kind: "service-negotiated", ownerId: "echo-service", portName: "service", port: 18081 },
      ],
      "2026-05-20T00:00:00.000Z",
    );

    const reconciled = await reconcilePortReservationLedger(
      workspaceRoot,
      [{ kind: "api", ownerId: "runtime-api", portName: "http", port: 18080 }],
      "not present in rehydrated runtime state",
      "2026-05-20T00:02:00.000Z",
    );

    const api = reconciled.reservations.find((reservation) => reservation.ownerId === "runtime-api");
    const stale = reconciled.reservations.find((reservation) => reservation.ownerId === "echo-service");
    assert.equal(api?.stale, undefined);
    assert.equal(stale?.stale, true);
    assert.equal(stale?.staleReason, "not present in rehydrated runtime state");
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});
