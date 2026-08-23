import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
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

test("recovery history preserves concurrent appends for the same service", async () => {
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-recovery-history-concurrent-");

  try {
    const { serviceRoot } = await writeExecutableFixtureService(servicesRoot, "history-concurrent-service");
    const service = {
      serviceRoot,
      manifest: {
        id: "history-concurrent-service",
      },
    };

    await Promise.all(Array.from({ length: 12 }, (_, index) => appendServiceRecoveryHistoryEvents(service, [
      {
        kind: "monitor",
        serviceId: "history-concurrent-service",
        action: "skip",
        reason: "not_running",
        message: `event-${index}`,
        at: `2026-04-27T00:00:${String(index).padStart(2, "0")}.000Z`,
      },
    ], 20)));

    const rehydrated = await readServiceRecoveryHistory(service);

    assert.equal(rehydrated.serviceId, "history-concurrent-service");
    assert.equal(rehydrated.events.length, 12);
    assert.deepEqual(
      rehydrated.events.map((event) => event.message).sort(),
      Array.from({ length: 12 }, (_, index) => `event-${index}`).sort(),
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("recovery history writes atomically and fails visibly for corrupt durable evidence", async () => {
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-recovery-history-atomic-");

  try {
    const { serviceRoot } = await writeExecutableFixtureService(servicesRoot, "history-atomic-service");
    const service = {
      serviceRoot,
      manifest: {
        id: "history-atomic-service",
      },
    };

    await appendServiceRecoveryHistoryEvents(service, [
      {
        kind: "monitor",
        serviceId: "history-atomic-service",
        action: "restart",
        reason: "crashed",
        message: "persisted",
        at: "2026-08-14T00:00:00.000Z",
      },
    ]);

    const stateRoot = path.join(serviceRoot, ".state");
    assert.deepEqual((await readdir(stateRoot)).filter((name) => name.endsWith(".tmp")), []);

    await mkdir(stateRoot, { recursive: true });
    await writeFile(path.join(stateRoot, "recovery.json"), "{not-json", "utf8");
    await assert.rejects(
      readServiceRecoveryHistory(service),
      /Recovery history for "history-atomic-service" is unreadable or invalid\./,
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
