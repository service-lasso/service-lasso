import test from "node:test";
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { startApiServer } from "../dist/server/index.js";
import { resetLifecycleState } from "../dist/runtime/lifecycle/store.js";
import { makeTempServicesRoot, writeExecutableFixtureService } from "./test-helpers.js";

async function getJson(url) {
  const response = await fetch(url);
  return {
    status: response.status,
    body: await response.json(),
  };
}

async function postJson(url, body = {}) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  return {
    status: response.status,
    body: await response.json(),
  };
}

test("recovery API exposes status and manual doctor execution", async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot } = await makeTempServicesRoot("service-lasso-api-recovery-");
  await writeExecutableFixtureService(servicesRoot, "recovery-fixture", {
    doctor: {
      enabled: true,
      failurePolicy: "block",
      steps: [
        {
          name: "doctor-pass",
          command: process.execPath,
          args: ["-e", "process.exit(0)"],
        },
      ],
    },
  });
  const apiServer = await startApiServer({ port: 0, servicesRoot });

  try {
    const doctor = await postJson(`${apiServer.url}/api/services/recovery-fixture/recovery/doctor`);
    const single = await getJson(`${apiServer.url}/api/services/recovery-fixture/recovery`);
    const all = await getJson(`${apiServer.url}/api/recovery`);
    const detail = await getJson(`${apiServer.url}/api/services/recovery-fixture`);

    assert.equal(doctor.status, 200);
    assert.equal(doctor.body.doctor.ok, true);
    assert.equal(doctor.body.recovery.events[0].kind, "doctor");
    assert.equal(single.status, 200);
    assert.equal(single.body.recovery.events[0].steps[0].name, "doctor-pass");
    assert.equal(all.status, 200);
    assert.equal(all.body.services[0].serviceId, "recovery-fixture");
    assert.equal(detail.status, 200);
    assert.equal(detail.body.service.recovery.events[0].kind, "doctor");
  } finally {
    await apiServer.stop();
    resetLifecycleState();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

