import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import path from "node:path";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { startApiServer } from "../dist/server/index.js";
import { makeTempServicesRoot, writeManifest } from "./test-helpers.js";

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

async function getJson(url) {
  const response = await fetch(url);
  return {
    status: response.status,
    body: await response.json(),
  };
}

async function getBytes(url) {
  const response = await fetch(url);
  return {
    status: response.status,
    contentType: response.headers.get("content-type"),
    bytes: Buffer.from(await response.arrayBuffer()),
  };
}

async function writeArchiveProvider(servicesRoot) {
  const serviceRoot = await writeManifest(servicesRoot, "@archive", {
    id: "@archive",
    name: "Archive Provider",
    description: "Archive provider fixture.",
    version: "fixture-7z",
    role: "provider",
    enabled: true,
    actions: {
      "archive-selection": {
        mode: "command",
        command: process.execPath,
        args: ["runtime/archive-provider.mjs"],
        payload: {
          inline: true,
          required: true,
          schema: {
            type: "object",
            required: ["serviceId", "sourceId", "selectedPaths", "resolvedPaths", "artifact"],
          },
          recordInlineFields: ["serviceId", "sourceId", "selectedPaths", "archiveFormat"],
        },
        timeoutSeconds: 5,
      },
    },
  });
  const runtimeRoot = path.join(serviceRoot, "runtime");
  await mkdir(runtimeRoot, { recursive: true });
  await writeFile(
    path.join(runtimeRoot, "archive-provider.mjs"),
    [
      "import { mkdir, writeFile } from 'node:fs/promises';",
      "import path from 'node:path';",
      "const payload = JSON.parse(process.env.SERVICE_LASSO_ACTION_PAYLOAD ?? '{}');",
      "await mkdir(path.dirname(payload.artifact.path), { recursive: true });",
      "await writeFile(payload.artifact.path, JSON.stringify({",
      "  serviceId: payload.serviceId,",
      "  sourceId: payload.sourceId,",
      "  selectedPaths: payload.selectedPaths,",
      "  archiveFormat: payload.archiveFormat",
      "}, null, 2));",
      "console.log('archive artifact created');",
    ].join("\n"),
    "utf8",
  );
}

test("POST /api/files/archive-selection delegates selected file exports to @archive and records metadata", async () => {
  const { tempRoot, servicesRoot, workspaceRoot } = await makeTempServicesRoot("service-lasso-file-export-");
  const serviceRoot = await writeManifest(servicesRoot, "alpha-service", {
    id: "alpha-service",
    name: "Alpha Service",
    description: "Service with exportable files.",
    files: {
      enabled: true,
      roots: [
        {
          id: "workspace",
          label: "Workspace",
          path: ".",
          mode: "read-write",
        },
      ],
    },
  });
  await mkdir(path.join(serviceRoot, "runtime", "data"), { recursive: true });
  await writeFile(path.join(serviceRoot, "runtime", "data", "example.txt"), "export me\n", "utf8");
  await writeArchiveProvider(servicesRoot);

  const apiServer = await startApiServer({ port: 0, servicesRoot, workspaceRoot });
  try {
    const result = await postJson(`${apiServer.url}/api/files/archive-selection`, {
      actor: "service-admin-web",
      source: {
        type: "file-selection",
        serviceId: "alpha-service",
        sourceId: "workspace",
        paths: ["runtime/data"],
        archiveFormat: "7z",
      },
    });

    assert.equal(result.status, 200);
    assert.equal(result.body.ok, true);
    assert.equal(result.body.action, "archive-selection");
    assert.equal(result.body.export.serviceId, "alpha-service");
    assert.equal(result.body.export.sourceId, "alpha-service:workspace");
    assert.deepEqual(result.body.export.selectedPaths, ["runtime/data"]);
    assert.equal(result.body.export.archiveFormat, "7z");
    assert.equal(result.body.export.provider.serviceId, "@archive");
    assert.equal(result.body.export.provider.actionId, "archive-selection");
    assert.equal(result.body.export.provider.version, "fixture-7z");
    assert.equal(result.body.export.provider.status, "succeeded");
    assert.equal(result.body.export.artifact.format, "7z");
    assert.equal(result.body.export.artifact.fileName.endsWith(".7z"), true);
    assert.equal(result.body.export.artifact.checksum.algorithm, "sha256");
    assert.equal(JSON.stringify(result.body).includes(serviceRoot), false);

    const download = await getBytes(`${apiServer.url}${result.body.export.artifact.downloadUrl}`);
    assert.equal(download.status, 200);
    assert.match(download.contentType, /application\/x-7z-compressed/);
    assert.equal(
      createHash("sha256").update(download.bytes).digest("hex"),
      result.body.export.artifact.checksum.value,
    );
    assert.deepEqual(JSON.parse(download.bytes.toString("utf8")).selectedPaths, ["runtime/data"]);

    const history = await getJson(`${apiServer.url}/api/services/%40archive/actions/archive-selection/runs`);
    assert.equal(history.status, 200);
    assert.equal(history.body.runs.length, 1);
    assert.equal(history.body.runs[0].metadata.payload.inline.serviceId, "alpha-service");
    assert.deepEqual(history.body.runs[0].metadata.payload.inline.selectedPaths, ["runtime/data"]);
    assert.equal(JSON.stringify(history.body.runs[0].metadata.payload.inline).includes(serviceRoot), false);

    const audit = await getJson(`${apiServer.url}/api/audit?serviceId=alpha-service&action=service.file.export`);
    assert.equal(audit.status, 200);
    assert.equal(audit.body.events.length, 1);
    assert.equal(audit.body.events[0].outcome, "success");
    assert.equal(audit.body.events[0].metadata.artifactId, result.body.export.artifactId);
  } finally {
    await apiServer.stop();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("POST /api/files/archive-selection rejects paths outside the registered file source", async () => {
  const { tempRoot, servicesRoot, workspaceRoot } = await makeTempServicesRoot("service-lasso-file-export-boundary-");
  await writeManifest(servicesRoot, "alpha-service", {
    id: "alpha-service",
    name: "Alpha Service",
    description: "Service with exportable files.",
    files: {
      enabled: true,
      roots: [{ id: "workspace", label: "Workspace", path: ".", mode: "read-write" }],
    },
  });
  await writeArchiveProvider(servicesRoot);

  const apiServer = await startApiServer({ port: 0, servicesRoot, workspaceRoot });
  try {
    const result = await postJson(`${apiServer.url}/api/files/archive-selection`, {
      source: {
        type: "file-selection",
        serviceId: "alpha-service",
        sourceId: "workspace",
        paths: ["../outside"],
        archiveFormat: "7z",
      },
    });

    assert.equal(result.status, 400);
    assert.equal(result.body.error, "path_outside_workspace");
  } finally {
    await apiServer.stop();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("POST /api/files/archive-selection fails clearly when @archive is unavailable", async () => {
  const { tempRoot, servicesRoot, workspaceRoot } = await makeTempServicesRoot("service-lasso-file-export-provider-");
  const serviceRoot = await writeManifest(servicesRoot, "alpha-service", {
    id: "alpha-service",
    name: "Alpha Service",
    description: "Service with exportable files.",
    files: {
      enabled: true,
      roots: [{ id: "workspace", label: "Workspace", path: ".", mode: "read-write" }],
    },
  });
  await writeFile(path.join(serviceRoot, "example.txt"), "export me\n", "utf8");

  const apiServer = await startApiServer({ port: 0, servicesRoot, workspaceRoot });
  try {
    const result = await postJson(`${apiServer.url}/api/files/archive-selection`, {
      source: {
        type: "file-selection",
        serviceId: "alpha-service",
        sourceId: "workspace",
        paths: ["example.txt"],
        archiveFormat: "7z",
      },
    });

    assert.equal(result.status, 409);
    assert.equal(result.body.error, "archive_provider_unavailable");
    assert.match(result.body.message, /@archive provider/);
  } finally {
    await apiServer.stop();
    await rm(tempRoot, { recursive: true, force: true });
  }
});
