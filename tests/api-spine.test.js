import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { startApiServer } from "../dist/server/index.js";

async function getJson(url) {
  const response = await fetch(url);
  return {
    status: response.status,
    body: await response.json(),
  };
}

test("GET /api/health returns core API health", async () => {
  const apiServer = await startApiServer({ port: 0, version: "test-version" });

  try {
    const result = await getJson(`${apiServer.url}/api/health`);

    assert.equal(result.status, 200);
    assert.equal(result.body.service, "service-lasso");
    assert.equal(result.body.status, "ok");
    assert.equal(result.body.mode, "development");
    assert.equal(result.body.api.status, "up");
    assert.equal(result.body.api.version, "test-version");
  } finally {
    await apiServer.stop();
  }
});

test("GET /api/services returns discovered services from the tracked services root", async () => {
  const servicesRoot = path.resolve("services");
  const apiServer = await startApiServer({ port: 0, servicesRoot });

  try {
    const result = await getJson(`${apiServer.url}/api/services`);

    assert.equal(result.status, 200);
    assert.ok(Array.isArray(result.body.services));
    assert.equal(result.body.services.length, 3);
    assert.deepEqual(
      result.body.services.map((service) => service.id),
      ["@node", "@python", "echo-service"],
    );
    assert.equal(result.body.services[0].status, "discovered");
    assert.equal(result.body.services[0].source, "manifest");
  } finally {
    await apiServer.stop();
  }
});
