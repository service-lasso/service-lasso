import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { startApiServer } from "../dist/server/index.js";
import { resetLifecycleState } from "../dist/runtime/lifecycle/store.js";
import { makeTempServicesRoot, writeManifest } from "./test-helpers.js";

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
  const apiServer = await startApiServer({ port: 0, servicesRoot, workspaceRoot });

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
