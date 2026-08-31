import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { startApiServer } from "../dist/server/index.js";
import { resetLifecycleState } from "../dist/runtime/lifecycle/store.js";
import { makeTempServicesRoot, writeManifest } from "./test-helpers.js";

/**
 * Builds a log-read URL the way current Service Admin tabs do:
 * `GET /api/logs/read` with `type=<sourceId>` encoded by URLSearchParams.
 *
 * @param {string} baseUrl
 * @param {string} serviceId
 * @param {string} sourceId
 * @param {Record<string, string>} [extra]
 * @returns {string}
 */
function adminLogReadUrl(baseUrl, serviceId, sourceId, extra = {}) {
  const params = new URLSearchParams({
    service: serviceId,
    type: sourceId,
    limit: "50",
    ...extra,
  });
  return `${baseUrl}/api/logs/read?${params.toString()}`;
}

test("log-info exposes builtin declared and discovered service-owned log sources", async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot, workspaceRoot } = await makeTempServicesRoot("service-lasso-log-sources-");
  const serviceRoot = await writeManifest(servicesRoot, "log-source-service", {
    id: "log-source-service",
    name: "Log Source Service",
    description: "Fixture for service-owned log source registry.",
    logSources: [
      {
        id: "app",
        label: "Application log",
        type: "file",
        path: "logs/app.log",
        format: "text",
      },
      {
        id: "workers",
        label: "Worker logs",
        type: "glob",
        pattern: "var/log/*.log",
        format: "ndjson",
      },
      {
        id: "missing",
        label: "Missing log",
        type: "file",
        path: "logs/missing.log",
      },
    ],
  });
  await mkdir(path.join(serviceRoot, "logs"), { recursive: true });
  await mkdir(path.join(serviceRoot, "var", "log"), { recursive: true });
  await writeFile(path.join(serviceRoot, "logs", "app.log"), "ready\n");
  await writeFile(path.join(serviceRoot, "var", "log", "worker.log"), "worker ready\n");
  let apiServer = await startApiServer({ port: 0, servicesRoot, workspaceRoot });

  try {
    const response = await fetch(`${apiServer.url}/api/services/log-info?service=log-source-service&type=default`);
    const body = await response.json();

    assert.equal(response.status, 200);
    const sources = body.sources;
    assert.ok(sources.some((source) => source.id === "stdout" && source.origin === "builtin"));
    assert.ok(sources.some((source) => source.id === "stderr" && source.origin === "builtin"));
    assert.ok(
      sources.some(
        (source) =>
          source.id === "app" &&
          source.origin === "declared" &&
          source.relativePath === "logs/app.log" &&
          source.status === "available" &&
          source.tail === true,
      ),
    );
    assert.ok(
      sources.some(
        (source) =>
          source.id === "missing" &&
          source.origin === "declared" &&
          source.relativePath === "logs/missing.log" &&
          source.status === "missing",
      ),
    );
    assert.ok(
      sources.some(
        (source) =>
          source.origin === "discovered" &&
          source.relativePath === "var/log/worker.log" &&
          source.status === "available",
      ),
    );

    const inventory = JSON.parse(await readFile(path.join(serviceRoot, ".state", "log-sources.json"), "utf8"));
    assert.equal(inventory.serviceId, "log-source-service");
    assert.ok(inventory.sources.some((source) => source.id === "app" && source.status === "available"));
    assert.ok(inventory.sources.every((source) => !String(source.relativePath ?? "").includes("..")));

    const declaredRead = await fetch(`${apiServer.url}/api/logs/read?service=log-source-service&type=app&limit=50`);
    const declaredBody = await declaredRead.json();
    assert.equal(declaredRead.status, 200);
    assert.equal(declaredBody.source.id, "app");
    assert.match(String(declaredBody.path).replaceAll("\\", "/"), /logs\/app\.log$/);
    assert.ok(declaredBody.lines.some((line) => line.includes("ready")));

    const sourceQueryRead = await fetch(
      `${apiServer.url}/api/logs/read?service=log-source-service&type=default&source=app&limit=50`,
    );
    const sourceQueryBody = await sourceQueryRead.json();
    assert.equal(sourceQueryRead.status, 200);
    assert.equal(sourceQueryBody.source.id, "app");
    assert.deepEqual(sourceQueryBody.lines, declaredBody.lines);

    const discoveredRead = await fetch(
      `${apiServer.url}/api/logs/read?service=log-source-service&type=${encodeURIComponent("discovered:var/log/worker.log")}&limit=50`,
    );
    const discoveredBody = await discoveredRead.json();
    assert.equal(discoveredRead.status, 200);
    assert.equal(discoveredBody.source.id, "discovered:var/log/worker.log");
    assert.ok(discoveredBody.lines.some((line) => line.includes("worker ready")));

    const missingRead = await fetch(`${apiServer.url}/api/logs/read?service=log-source-service&type=missing&limit=50`);
    const missingBody = await missingRead.json();
    assert.equal(missingRead.status, 200);
    assert.equal(missingBody.available, false);
    assert.equal(missingBody.totalLines, 0);
    assert.deepEqual(missingBody.lines, []);

    const unknownRead = await fetch(`${apiServer.url}/api/logs/read?service=log-source-service&type=not-a-source&limit=50`);
    const unknownBody = await unknownRead.json();
    assert.equal(unknownRead.status, 404);
    assert.equal(unknownBody.error, "log_source_not_found");

    await apiServer.stop();
    resetLifecycleState();
    apiServer = await startApiServer({ port: 0, servicesRoot, workspaceRoot });
    const restartResponse = await fetch(`${apiServer.url}/api/services/log-info?service=log-source-service&type=default`);
    const restartBody = await restartResponse.json();

    assert.equal(restartResponse.status, 200);
    assert.ok(restartBody.sources.some((source) => source.id === "app" && source.status === "available"));
    assert.ok(restartBody.sources.some((source) => source.id === "missing" && source.status === "missing"));
  } finally {
    await apiServer.stop();
    resetLifecycleState();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("manifest validation rejects unsafe declared log source paths", async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot, workspaceRoot } = await makeTempServicesRoot("service-lasso-log-source-unsafe-");
  await writeManifest(servicesRoot, "unsafe-log-source-service", {
    id: "unsafe-log-source-service",
    name: "Unsafe Log Source Service",
    description: "Fixture for unsafe declared log source rejection.",
    logSources: [
      {
        id: "outside",
        label: "Outside log",
        type: "file",
        path: "../outside.log",
      },
    ],
  });

  try {
    await assert.rejects(
      () => startApiServer({ port: 0, servicesRoot, workspaceRoot }),
      /logSources\[0\]\.path.*service root/i,
    );
  } finally {
    resetLifecycleState();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("log-read honors NGINX-style advertised ids via Admin type= and source= queries", async () => {
  resetLifecycleState();
  const { tempRoot, servicesRoot, workspaceRoot } = await makeTempServicesRoot("service-lasso-nginx-log-read-");
  const serviceRoot = await writeManifest(servicesRoot, "nginx-log-service", {
    id: "nginx-log-service",
    name: "NGINX Log Service",
    description: "Fixture for advertised access/error log-read ids.",
    logSources: [
      {
        id: "missing-access",
        label: "Missing access log",
        type: "file",
        path: "logs/missing-access.log",
      },
    ],
  });
  await mkdir(path.join(serviceRoot, "logs"), { recursive: true });
  await writeFile(path.join(serviceRoot, "logs", "access.log"), "nginx access hit\n");
  await writeFile(path.join(serviceRoot, "logs", "error.log"), "nginx error line\n");
  const apiServer = await startApiServer({ port: 0, servicesRoot, workspaceRoot });

  try {
    const infoResponse = await fetch(`${apiServer.url}/api/services/log-info?service=nginx-log-service&type=default`);
    const infoBody = await infoResponse.json();
    assert.equal(infoResponse.status, 200);
    assert.ok(
      infoBody.sources.some(
        (source) => source.id === "discovered:logs/access.log" && source.relativePath === "logs/access.log",
      ),
    );
    assert.ok(
      infoBody.sources.some(
        (source) => source.id === "discovered:logs/error.log" && source.relativePath === "logs/error.log",
      ),
    );

    const accessByDiscoveredId = await fetch(adminLogReadUrl(apiServer.url, "nginx-log-service", "discovered:logs/access.log"));
    const accessByDiscoveredBody = await accessByDiscoveredId.json();
    assert.equal(accessByDiscoveredId.status, 200);
    assert.equal(accessByDiscoveredBody.source.id, "discovered:logs/access.log");
    assert.ok(accessByDiscoveredBody.lines.some((line) => line.includes("nginx access hit")));

    const accessByRelativePath = await fetch(adminLogReadUrl(apiServer.url, "nginx-log-service", "logs/access.log"));
    const accessByRelativeBody = await accessByRelativePath.json();
    assert.equal(accessByRelativePath.status, 200);
    assert.equal(accessByRelativeBody.source.id, "discovered:logs/access.log");
    assert.deepEqual(accessByRelativeBody.lines, accessByDiscoveredBody.lines);

    const errorByRelativePath = await fetch(adminLogReadUrl(apiServer.url, "nginx-log-service", "logs/error.log"));
    const errorByRelativeBody = await errorByRelativePath.json();
    assert.equal(errorByRelativePath.status, 200);
    assert.equal(errorByRelativeBody.source.id, "discovered:logs/error.log");
    assert.ok(errorByRelativeBody.lines.some((line) => line.includes("nginx error line")));

    const accessBySourceParam = new URLSearchParams({
      service: "nginx-log-service",
      type: "default",
      source: "logs/access.log",
      limit: "50",
    });
    const accessBySource = await fetch(`${apiServer.url}/api/logs/read?${accessBySourceParam.toString()}`);
    const accessBySourceBody = await accessBySource.json();
    assert.equal(accessBySource.status, 200);
    assert.deepEqual(accessBySourceBody.lines, accessByDiscoveredBody.lines);

    const discoveredSourceParam = new URLSearchParams({
      service: "nginx-log-service",
      source: "discovered:logs/access.log",
      limit: "50",
    });
    const discoveredSource = await fetch(`${apiServer.url}/api/logs/read?${discoveredSourceParam.toString()}`);
    const discoveredSourceBody = await discoveredSource.json();
    assert.equal(discoveredSource.status, 200);
    assert.deepEqual(discoveredSourceBody.lines, accessByDiscoveredBody.lines);

    const missingAdvertised = await fetch(adminLogReadUrl(apiServer.url, "nginx-log-service", "logs/missing-access.log"));
    const missingAdvertisedBody = await missingAdvertised.json();
    assert.equal(missingAdvertised.status, 200);
    assert.equal(missingAdvertisedBody.available, false);
    assert.equal(missingAdvertisedBody.totalLines, 0);
    assert.deepEqual(missingAdvertisedBody.lines, []);

    const unknownSource = await fetch(adminLogReadUrl(apiServer.url, "nginx-log-service", "logs/not-advertised.log"));
    const unknownSourceBody = await unknownSource.json();
    assert.equal(unknownSource.status, 404);
    assert.equal(unknownSourceBody.error, "log_source_not_found");

    const traversal = await fetch(adminLogReadUrl(apiServer.url, "nginx-log-service", "logs/../error.log"));
    const traversalBody = await traversal.json();
    assert.equal(traversal.status, 404);
    assert.equal(traversalBody.error, "log_source_not_found");

    const combinedRead = await fetch(adminLogReadUrl(apiServer.url, "nginx-log-service", "combined"));
    const combinedBody = await combinedRead.json();
    assert.equal(combinedRead.status, 200);
    assert.equal(combinedBody.type, "default");
    assert.equal(combinedBody.source.id, "default");

    const stdoutRead = await fetch(adminLogReadUrl(apiServer.url, "nginx-log-service", "stdout"));
    const stdoutBody = await stdoutRead.json();
    assert.equal(stdoutRead.status, 200);
    assert.equal(stdoutBody.type, "stdout");
  } finally {
    await apiServer.stop();
    resetLifecycleState();
    await rm(tempRoot, { recursive: true, force: true });
  }
});
