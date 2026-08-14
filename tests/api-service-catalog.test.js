import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import AdmZip from "adm-zip";
import { startApiServer } from "../dist/server/index.js";

async function makeTempRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), "service-lasso-catalog-api-"));
  const servicesRoot = path.join(root, "services");
  const workspaceRoot = path.join(root, "workspace");
  await mkdir(servicesRoot, { recursive: true });
  await mkdir(workspaceRoot, { recursive: true });
  return { root, servicesRoot, workspaceRoot };
}

async function writeCatalog(root, entries) {
  const catalogPath = path.join(root, "catalog.json");
  await writeFile(
    catalogPath,
    JSON.stringify(
      {
        schemaVersion: "1.0.0",
        catalogId: "service-lasso-approved-services",
        updatedAt: "2026-07-26",
        defaults: {
          publisher: "Service Lasso",
          trustStatus: "approved",
          versionPolicy: {
            channel: "stable",
            selector: "latest-semver",
            allowPrerelease: false,
          },
          releaseAsset: {
            namePattern: "^.+\\.zip$",
            required: true,
          },
          manifestPath: "service.json",
        },
        entries,
      },
      null,
      2,
    ),
  );
  return catalogPath;
}

function serviceManifest(serviceId, version = "2026.8.15-fixture") {
  return {
    id: serviceId,
    name: serviceId + " service",
    description: "Catalog install API fixture.",
    version,
    healthcheck: {
      type: "process",
    },
  };
}

function archiveBufferFor(serviceId, version) {
  const zip = new AdmZip();
  zip.addFile("package/service.json", Buffer.from(JSON.stringify(serviceManifest(serviceId, version), null, 2), "utf8"));
  zip.addFile("package/runtime/fixture.txt", Buffer.from(`installed ${serviceId}\n`, "utf8"));
  return zip.toBuffer();
}

async function startFakeGitHubReleaseApi() {
  const archives = {
    "lasso-node-v1.2.0.zip": archiveBufferFor("catalog-node", "v1.2.0"),
    "lasso-postgres-v1.0.0.zip": archiveBufferFor("catalog-postgres", "v1.0.0"),
  };

  const buildReleases = (baseUrl) => [
    {
      tag_name: "v1.3.0-beta.1",
      name: "Preview",
      html_url: "https://github.test/service-lasso/lasso-node/releases/v1.3.0-beta.1",
      created_at: "2026-07-03T00:00:00Z",
      published_at: "2026-07-03T00:00:00Z",
      prerelease: true,
      draft: false,
      body: "Preview release",
      assets: [
        {
          name: "lasso-node-v1.3.0-beta.1.zip",
          size: 123,
          content_type: "application/zip",
          browser_download_url: `${baseUrl}/downloads/lasso-node-v1.3.0-beta.1.zip`,
        },
      ],
    },
    {
      tag_name: "v1.2.0",
      name: "Stable",
      html_url: "https://github.test/service-lasso/lasso-node/releases/v1.2.0",
      created_at: "2026-07-02T00:00:00Z",
      published_at: "2026-07-02T00:00:00Z",
      prerelease: false,
      draft: false,
      body: "Stable release with token=should-not-leak",
      assets: [
        {
          name: "lasso-node-v1.2.0.zip",
          size: 456,
          content_type: "application/zip",
          browser_download_url: `${baseUrl}/downloads/lasso-node-v1.2.0.zip`,
        },
        {
          name: "checksums.txt",
          size: 32,
          content_type: "text/plain",
          browser_download_url: `${baseUrl}/downloads/checksums.txt`,
        },
      ],
    },
    {
      tag_name: "v2.0.0",
      name: "Draft",
      html_url: "https://github.test/service-lasso/lasso-node/releases/v2.0.0",
      created_at: "2026-07-04T00:00:00Z",
      published_at: "2026-07-04T00:00:00Z",
      prerelease: false,
      draft: true,
      body: "Draft release",
      assets: [{ name: "lasso-node-v2.0.0.zip" }],
    },
  ];
  const postgresReleases = (baseUrl) => [
    {
      tag_name: "v1.0.0",
      name: "Postgres stable",
      html_url: "https://github.test/service-lasso/lasso-postgres/releases/v1.0.0",
      created_at: "2026-07-01T00:00:00Z",
      published_at: "2026-07-01T00:00:00Z",
      prerelease: false,
      draft: false,
      body: "Postgres stable release",
      assets: [
        {
          name: "lasso-postgres-v1.0.0.zip",
          size: archives["lasso-postgres-v1.0.0.zip"].length,
          content_type: "application/zip",
          browser_download_url: `${baseUrl}/downloads/lasso-postgres-v1.0.0.zip`,
        },
      ],
    },
  ];

  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    if (url.pathname === "/repos/service-lasso/lasso-node/releases") {
      response.setHeader("content-type", "application/json; charset=utf-8");
      response.end(JSON.stringify(buildReleases(baseUrl)));
      return;
    }

    if (url.pathname === "/repos/service-lasso/lasso-postgres/releases") {
      response.setHeader("content-type", "application/json; charset=utf-8");
      response.end(JSON.stringify(postgresReleases(baseUrl)));
      return;
    }

    const archiveName = decodeURIComponent(url.pathname.replace(/^\/downloads\//, ""));
    if (url.pathname.startsWith("/downloads/") && archives[archiveName]) {
      response.setHeader("content-type", "application/zip");
      response.end(archives[archiveName]);
      return;
    }

    response.statusCode = 404;
    response.end("missing");
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    stop: async () => {
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

async function getJson(url) {
  const response = await fetch(url);
  return {
    status: response.status,
    body: await response.json(),
  };
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return {
    status: response.status,
    body: await response.json(),
  };
}

test("catalog API lists approved packages with filters", async () => {
  const { root, servicesRoot, workspaceRoot } = await makeTempRoot();
  const catalogPath = await writeCatalog(root, [
    {
      packageId: "lasso-node",
      displayName: "Node.js Provider",
      summary: "Release-backed Node.js provider package.",
      repository: {
        owner: "service-lasso",
        name: "lasso-node",
        url: "https://github.com/service-lasso/lasso-node",
      },
      category: "runtime",
      tags: ["nodejs", "provider"],
      defaultVersionPolicy: {
        channel: "stable",
        selector: "latest-semver",
        allowPrerelease: false,
      },
      releaseAsset: {
        namePattern: "^lasso-node-.+\\.zip$",
        required: true,
      },
    },
    {
      packageId: "lasso-postgres",
      displayName: "Postgres",
      summary: "Database service package.",
      repository: {
        owner: "service-lasso",
        name: "lasso-postgres",
        url: "https://github.com/service-lasso/lasso-postgres",
      },
      category: "database",
      tags: ["postgres", "storage"],
      defaultVersionPolicy: {
        channel: "stable",
        selector: "latest-semver",
        allowPrerelease: false,
      },
      releaseAsset: {
        namePattern: "^lasso-postgres-.+\\.zip$",
        required: true,
      },
    },
  ]);
  const apiServer = await startApiServer({ port: 0, servicesRoot, workspaceRoot, serviceCatalogUrl: catalogPath });

  try {
    const all = await getJson(`${apiServer.url}/api/catalog/packages`);
    const filtered = await getJson(`${apiServer.url}/api/catalog/packages?category=runtime&tag=provider&q=node`);
    const detail = await getJson(`${apiServer.url}/api/catalog/packages/lasso-node`);

    assert.equal(all.status, 200);
    assert.equal(all.body.catalog.summary.total, 2);
    assert.deepEqual(all.body.catalog.summary.categories, ["database", "runtime"]);
    assert.equal(filtered.status, 200);
    assert.equal(filtered.body.catalog.packages.length, 1);
    assert.equal(filtered.body.catalog.packages[0].packageId, "lasso-node");
    assert.equal(filtered.body.catalog.packages[0].approved, true);
    assert.equal(detail.status, 200);
    assert.equal(detail.body.package.repository.name, "lasso-node");
  } finally {
    await apiServer.stop();
    await rm(root, { recursive: true, force: true });
  }
});

test("catalog API resolves GitHub release versions and stable default asset", async () => {
  const { root, servicesRoot, workspaceRoot } = await makeTempRoot();
  const releaseApi = await startFakeGitHubReleaseApi();
  const catalogPath = await writeCatalog(root, [
    {
      packageId: "lasso-node",
      displayName: "Node.js Provider",
      summary: "Release-backed Node.js provider package.",
      repository: {
        owner: "service-lasso",
        name: "lasso-node",
        url: "https://github.com/service-lasso/lasso-node",
      },
      category: "runtime",
      tags: ["nodejs", "provider"],
      defaultVersionPolicy: {
        channel: "stable",
        selector: "latest-semver",
        allowPrerelease: false,
      },
      releaseAsset: {
        namePattern: "^lasso-node-.+\\.zip$",
        required: true,
      },
    },
  ]);
  const apiServer = await startApiServer({
    port: 0,
    servicesRoot,
    workspaceRoot,
    serviceCatalogUrl: catalogPath,
    serviceCatalogGithubApiBaseUrl: releaseApi.baseUrl,
  });

  try {
    const response = await getJson(`${apiServer.url}/api/catalog/packages/lasso-node/releases`);

    assert.equal(response.status, 200);
    assert.equal(response.body.source.repository, "service-lasso/lasso-node");
    assert.equal(response.body.summary.total, 3);
    assert.equal(response.body.summary.stable, 1);
    assert.equal(response.body.defaultVersion.tag, "v1.2.0");
    assert.equal(response.body.defaultVersion.selectedAsset.name, "lasso-node-v1.2.0.zip");
    assert.equal(response.body.defaultVersion.notesSummary, "Stable release with token=[redacted]");
    assert.equal(response.body.versions.find((version) => version.tag === "v1.3.0-beta.1").default, false);
  } finally {
    await apiServer.stop();
    await releaseApi.stop();
    await rm(root, { recursive: true, force: true });
  }
});

test("catalog install API stages release archives and reports per-service outcomes", async () => {
  const { root, servicesRoot, workspaceRoot } = await makeTempRoot();
  const releaseApi = await startFakeGitHubReleaseApi();
  const catalogPath = await writeCatalog(root, [
    {
      packageId: "lasso-node",
      displayName: "Node.js Provider",
      summary: "Release-backed Node.js provider package.",
      repository: {
        owner: "service-lasso",
        name: "lasso-node",
        url: "https://github.com/service-lasso/lasso-node",
      },
      category: "runtime",
      tags: ["nodejs", "provider"],
      releaseAsset: {
        namePattern: "^lasso-node-.+\\.zip$",
        required: true,
      },
    },
    {
      packageId: "lasso-postgres",
      displayName: "Postgres",
      summary: "Database service package.",
      repository: {
        owner: "service-lasso",
        name: "lasso-postgres",
        url: "https://github.com/service-lasso/lasso-postgres",
      },
      category: "database",
      tags: ["postgres", "storage"],
      releaseAsset: {
        namePattern: "^lasso-postgres-.+\\.zip$",
        required: true,
      },
    },
  ]);
  const apiServer = await startApiServer({
    port: 0,
    servicesRoot,
    workspaceRoot,
    serviceCatalogUrl: catalogPath,
    serviceCatalogGithubApiBaseUrl: releaseApi.baseUrl,
  });

  try {
    const first = await postJson(`${apiServer.url}/api/catalog/install`, {
      selections: [{ packageId: "lasso-node", version: "v1.2.0" }],
      actor: "catalog-test",
    });
    const copiedScript = path.join(servicesRoot, "catalog-node", "runtime", "fixture.txt");
    const services = await getJson(`${apiServer.url}/api/services`);

    assert.equal(first.status, 200);
    assert.equal(first.body.install.ok, true);
    assert.equal(first.body.install.results[0].state, "registered");
    assert.deepEqual(first.body.install.results[0].progress, ["pending", "downloading", "validating", "copying", "registered"]);
    assert.equal(await readFile(copiedScript, "utf8"), "installed catalog-node\n");
    assert.equal(services.body.services.some((service) => service.id === "catalog-node"), true);

    const second = await postJson(`${apiServer.url}/api/catalog/install`, {
      selections: [
        { packageId: "lasso-node", version: "v1.2.0" },
        { packageId: "lasso-postgres", version: "v1.0.0" },
      ],
      actor: "catalog-test",
    });
    const audit = await getJson(`${apiServer.url}/api/audit?source=runtime-api&action=catalog.service.install&limit=10`);
    const inbox = await getJson(`${apiServer.url}/api/operator/inbox?filter=all`);

    assert.equal(second.status, 200);
    assert.equal(second.body.install.ok, false);
    assert.equal(second.body.install.state, "partial");
    assert.equal(second.body.install.summary.registered, 1);
    assert.equal(second.body.install.summary.conflicts, 1);
    assert.equal(second.body.install.results.find((result) => result.packageId === "lasso-node").state, "skipped/conflict");
    assert.equal(await readFile(path.join(servicesRoot, "catalog-postgres", "service.json"), "utf8").then((text) => JSON.parse(text).id), "catalog-postgres");
    assert.ok(audit.body.events.filter((event) => event.action === "catalog.service.install").length >= 3);
    assert.equal(inbox.body.inbox.items.some((item) => item.dedupeKey.startsWith("catalog-install:lasso-postgres")), true);
  } finally {
    await apiServer.stop();
    await releaseApi.stop();
    await rm(root, { recursive: true, force: true });
  }
});
