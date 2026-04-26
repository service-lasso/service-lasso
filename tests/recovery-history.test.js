import test from "node:test";
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { appendServiceRecoveryHistoryEvents, readServiceRecoveryHistory } from "../dist/runtime/recovery/history.js";
import { makeTempServicesRoot, writeExecutableFixtureService } from "./test-helpers.js";

test("recovery history rehydrates persisted events and enforces retention", async () => {
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-recovery-history-");

  try {
    const { serviceRoot } = await writeExecutableFixtureService(servicesRoot, "history-service");
    const service = {
      serviceRoot,
      manifest: {
        id: "history-service",
      },
    };

    await appendServiceRecoveryHistoryEvents(service, [
      {
        kind: "monitor",
        serviceId: "history-service",
        action: "skip",
        reason: "not_running",
        message: "first",
        at: "2026-04-27T00:00:00.000Z",
      },
      {
        kind: "monitor",
        serviceId: "history-service",
        action: "skip",
        reason: "backoff",
        message: "second",
        at: "2026-04-27T00:00:01.000Z",
      },
      {
        kind: "monitor",
        serviceId: "history-service",
        action: "restart",
        reason: "crashed",
        message: "third",
        at: "2026-04-27T00:00:02.000Z",
      },
    ], 2);

    const rehydrated = await readServiceRecoveryHistory(service);

    assert.equal(rehydrated.serviceId, "history-service");
    assert.equal(rehydrated.events.length, 2);
    assert.deepEqual(rehydrated.events.map((event) => event.message), ["second", "third"]);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
