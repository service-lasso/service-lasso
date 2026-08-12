import test from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import path from "node:path";
import { once } from "node:events";
import { rm } from "node:fs/promises";
import { startApiServer } from "../dist/server/index.js";
import { resetLifecycleState } from "../dist/runtime/lifecycle/store.js";
import { reconcilePortReservationLedger, reservePorts } from "../dist/runtime/ports/reservations.js";
import { makeTempServicesRoot } from "./test-helpers.js";

async function getJson(url) {
  const response = await fetch(url);
  return {
    status: response.status,
    body: await response.json(),
  };
}

test("GET /api/runtime/ports/conflict explains ledger-owned port conflicts", async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-port-conflict-ledger-");
  const workspaceRoot = path.join(tempRoot, "workspace");
  const apiServer = await startApiServer({ port: 0, servicesRoot, workspaceRoot });

  try {
    await reservePorts(workspaceRoot, [
      {
        kind: "service-negotiated",
        ownerId: "alpha-service",
        portName: "http",
        port: 18191,
      },
    ]);

    const result = await getJson(
      `${apiServer.url}/api/runtime/ports/conflict?port=18191&serviceId=bravo-service&portName=http`,
    );

    assert.equal(result.status, 200);
    assert.equal(result.body.conflict, true);
    assert.equal(result.body.reason, "ledger_reserved");
    assert.equal(result.body.requested.serviceId, "bravo-service");
    assert.equal(result.body.owner.ownerId, "alpha-service");
    assert.equal(result.body.owner.kind, "service-negotiated");
    assert.equal(result.body.ledger.activeReservations.length, 1);
    assert.equal(result.body.liveListener.checked, true);
    assert.ok(result.body.remediation.some((hint) => hint.includes("owning Service Lasso service")));
  } finally {
    await apiServer.stop();
    resetLifecycleState();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("GET /api/runtime/ports/conflict reports unknown live-listener conflicts without process secrets", async () => {
  resetLifecycleState();
  const listener = net.createServer();
  listener.listen(0, "127.0.0.1");
  await once(listener, "listening");
  const address = listener.address();
  assert.ok(address && typeof address !== "string");

  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-port-conflict-live-");
  const workspaceRoot = path.join(tempRoot, "workspace");
  const apiServer = await startApiServer({ port: 0, servicesRoot, workspaceRoot });

  try {
    const result = await getJson(
      `${apiServer.url}/api/runtime/ports/conflict?host=127.0.0.1&port=${address.port}`,
    );

    assert.equal(result.status, 200);
    assert.equal(result.body.conflict, true);
    assert.equal(result.body.reason, "live_listener");
    assert.equal(result.body.owner, null);
    assert.deepEqual(result.body.ledger.activeReservations, []);
    assert.equal(result.body.liveListener.occupied, true);
    assert.ok(result.body.remediation.some((hint) => hint.includes("external listener")));
    assert.equal(JSON.stringify(result.body).includes("pid"), false);
    assert.equal(JSON.stringify(result.body).includes("process"), false);
  } finally {
    await apiServer.stop();
    await new Promise((resolve) => listener.close(() => resolve()));
    resetLifecycleState();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("GET /api/runtime/ports/conflict separates stale ledger state from active conflicts", async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-port-conflict-stale-");
  const workspaceRoot = path.join(tempRoot, "workspace");
  const apiServer = await startApiServer({ port: 0, servicesRoot, workspaceRoot });

  try {
    await reservePorts(workspaceRoot, [
      {
        kind: "service-fixed",
        ownerId: "stale-service",
        portName: "http",
        port: 18192,
      },
    ]);
    await reconcilePortReservationLedger(workspaceRoot, [], "not present in rehydrated runtime state");

    const result = await getJson(`${apiServer.url}/api/runtime/ports/conflict?port=18192`);

    assert.equal(result.status, 200);
    assert.equal(result.body.conflict, false);
    assert.equal(result.body.reason, "none");
    assert.equal(result.body.owner, null);
    assert.equal(result.body.ledger.activeReservations.length, 0);
    assert.equal(result.body.ledger.staleReservations[0].ownerId, "stale-service");
    assert.equal(result.body.liveListener.occupied, false);
  } finally {
    await apiServer.stop();
    resetLifecycleState();
    await rm(tempRoot, { recursive: true, force: true });
  }
});
