import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { startApiServer } from "../dist/server/index.js";
import { discoverServices } from "../dist/runtime/discovery/discoverServices.js";
import { configService, installService } from "../dist/runtime/lifecycle/actions.js";
import { resetLifecycleState, getLifecycleState } from "../dist/runtime/lifecycle/store.js";
import { createServiceRegistry } from "../dist/runtime/manager/DependencyGraph.js";
import {
  PortReservationConflictError,
  getPortReservationLedgerPath,
  readPortReservationLedger,
  reconcilePortReservationLedger,
  reservePorts,
} from "../dist/runtime/ports/reservations.js";
import { makeTempServicesRoot, writeExecutableFixtureService } from "./test-helpers.js";

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

test("API startup reserves the resolved runtime port in the workspace ledger", async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-api-port-reservation-");
  const workspaceRoot = path.join(tempRoot, "workspace");
  const apiServer = await startApiServer({ port: 0, servicesRoot, workspaceRoot });

  try {
    const ledger = await readPortReservationLedger(workspaceRoot);
    assert.ok(
      ledger.reservations.some(
        (reservation) =>
          reservation.kind === "api" &&
          reservation.ownerId === "runtime-api" &&
          reservation.portName === "http" &&
          reservation.port === apiServer.port &&
          reservation.stale !== true,
      ),
    );
  } finally {
    await apiServer.stop();
    resetLifecycleState();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("service port negotiation avoids active API ledger reservations", async () => {
  resetLifecycleState();
  const previousRangeStart = process.env.SERVICE_LASSO_PORT_RANGE_START;
  const previousRangeEnd = process.env.SERVICE_LASSO_PORT_RANGE_END;
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-service-port-reservation-");
  const workspaceRoot = path.join(tempRoot, "workspace");

  process.env.SERVICE_LASSO_PORT_RANGE_START = "18180";
  process.env.SERVICE_LASSO_PORT_RANGE_END = "18182";

  try {
    await writeExecutableFixtureService(servicesRoot, "echo-service", {
      ports: { service: 18180 },
    });
    await reservePorts(workspaceRoot, [
      { kind: "api", ownerId: "runtime-api", portName: "http", port: 18180 },
    ]);

    const discovered = await discoverServices(servicesRoot);
    const registry = createServiceRegistry(discovered);
    const service = registry.getById("echo-service");
    assert.ok(service);

    await installService(service, registry);
    const result = await configService(service, registry, { workspaceRoot });
    const state = getLifecycleState("echo-service");
    const ledger = await readPortReservationLedger(workspaceRoot);

    assert.equal(result.ok, true);
    assert.equal(state.runtime.ports.service, 18181);
    assert.ok(
      ledger.reservations.some(
        (reservation) =>
          reservation.kind === "service-negotiated" &&
          reservation.ownerId === "echo-service" &&
          reservation.portName === "service" &&
          reservation.port === 18181 &&
          reservation.stale !== true,
      ),
    );
  } finally {
    if (previousRangeStart === undefined) {
      delete process.env.SERVICE_LASSO_PORT_RANGE_START;
    } else {
      process.env.SERVICE_LASSO_PORT_RANGE_START = previousRangeStart;
    }
    if (previousRangeEnd === undefined) {
      delete process.env.SERVICE_LASSO_PORT_RANGE_END;
    } else {
      process.env.SERVICE_LASSO_PORT_RANGE_END = previousRangeEnd;
    }
    resetLifecycleState();
    await rm(tempRoot, { recursive: true, force: true });
  }
});
