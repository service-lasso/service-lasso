import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { discoverServices } from "../dist/runtime/discovery/discoverServices.js";
import { loadServiceManifest } from "../dist/runtime/discovery/loadManifest.js";
import { startApiServer } from "../dist/server/index.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function makeTempServicesRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), "service-lasso-services-"));
  return root;
}

async function writeManifest(servicesRoot, serviceId, body) {
  const serviceRoot = path.join(servicesRoot, serviceId);
  await mkdir(serviceRoot, { recursive: true });
  await writeFile(path.join(serviceRoot, "service.json"), JSON.stringify(body, null, 2));
}

test("discoverServices loads valid service manifests from a services root", async () => {
  const servicesRoot = await makeTempServicesRoot();

  try {
    await writeManifest(servicesRoot, "@node", {
      id: "@node",
      name: "Node Runtime",
      description: "Runtime provider",
    });
    await writeManifest(servicesRoot, "echo-service", {
      id: "echo-service",
      name: "Echo Service",
      description: "Sample service",
    });

    const discovered = await discoverServices(servicesRoot);

    assert.equal(discovered.length, 2);
    assert.deepEqual(
      discovered.map((service) => service.manifest.id),
      ["@node", "echo-service"],
    );
  } finally {
    await rm(servicesRoot, { recursive: true, force: true });
  }
});

test("core services root declares the clean-clone baseline inventory", async () => {
  const services = await discoverServices(path.join(repoRoot, "services"));
  const byId = new Map(services.map((service) => [service.manifest.id, service.manifest]));

  assert.deepEqual(
    ["localcert", "nginx", "@node", "@traefik", "echo-service", "service-admin"].filter((serviceId) => !byId.has(serviceId)),
    [],
  );
  assert.equal(byId.get("localcert")?.role, "provider");
  assert.equal(byId.get("localcert")?.name, "Core Local Certificate Utility");
  assert.match(byId.get("localcert")?.description ?? "", /Core local\/no-download certificate utility service/);
  assert.equal(byId.get("nginx")?.role, undefined);
  assert.equal(byId.get("nginx")?.version, "1.30.0");
  assert.equal(byId.get("nginx")?.artifact?.source.repo, "service-lasso/lasso-nginx");
  assert.equal(byId.get("nginx")?.artifact?.source.tag, "2026.4.27-712c75f");
  assert.equal(byId.get("nginx")?.artifact?.platforms.win32?.assetName, "lasso-nginx-1.30.0-win32.zip");
  assert.deepEqual(byId.get("nginx")?.ports, { http: 18080 });
  assert.deepEqual(byId.get("nginx")?.healthcheck, {
    type: "http",
    url: "http://127.0.0.1:${HTTP_PORT}/health",
    expected_status: 200,
    retries: 80,
    interval: 250,
  });
  assert.equal(byId.get("@node")?.executable, "node");
  assert.equal(byId.get("@node")?.role, "provider");
  assert.equal(byId.get("@node")?.artifact?.source.repo, "service-lasso/lasso-node");
  assert.equal(byId.get("@node")?.artifact?.source.tag, "2026.4.27-13573bd");
  assert.equal(byId.get("@java")?.executable, "java");
  assert.equal(byId.get("@java")?.role, "provider");
  assert.equal(byId.get("@java")?.artifact?.source.repo, "service-lasso/lasso-java");
  assert.equal(byId.get("@java")?.artifact?.source.tag, "2026.4.27-b313cb0");
  assert.equal(byId.get("@python")?.role, "provider");
  assert.equal(byId.get("@python")?.artifact?.source.repo, "service-lasso/lasso-python");
  assert.equal(byId.get("@python")?.artifact?.source.tag, "2026.4.27-63f915c");
  assert.equal(byId.get("@traefik")?.enabled, true);
  assert.deepEqual(byId.get("@traefik")?.depend_on, ["localcert", "nginx"]);
  assert.equal(byId.get("@traefik")?.artifact?.source.repo, "service-lasso/lasso-traefik");
  assert.equal(byId.get("@traefik")?.artifact?.source.tag, "2026.4.27-bbc7f15");
  assert.match(byId.get("@traefik")?.commandline?.win32 ?? "", /--providers\.file\.filename="\$\{SERVICE_ROOT\}\\runtime\\dynamic\.yml"/);
  assert.match(byId.get("@traefik")?.commandline?.linux ?? "", /--entryPoints\.mongo\.address=":\$\{MONGO_PORT\}"/);
  assert.match(byId.get("@traefik")?.commandline?.default ?? "", /--serversTransport\.insecureSkipVerify=true/);
  assert.deepEqual(byId.get("@traefik")?.ports, {
    web: 19080,
    websecure: 19443,
    admin: 19081,
    https_traefik: 19082,
    https_nginx: 19090,
    https_cms: 19100,
    https_flow: 19110,
    https_flowtms: 19120,
    https_api: 19130,
    https_files: 19140,
    https_bpmn: 19150,
    mongo: 19160,
    typedb: 19170,
  });
  assert.deepEqual(byId.get("@traefik")?.portmapping, {
    HTTP: "${WEB_PORT}",
    HTTPS: "${WEBSECURE_PORT}",
    HTTPS_TRAEFIK: "${HTTPS_TRAEFIK_PORT}",
    HTTPS_NGINX: "${HTTPS_NGINX_PORT}",
    HTTPS_CMS: "${HTTPS_CMS_PORT}",
    HTTPS_FLOW: "${HTTPS_FLOW_PORT}",
    HTTPS_FLOWTMS: "${HTTPS_FLOWTMS_PORT}",
    HTTPS_API: "${HTTPS_API_PORT}",
    HTTPS_FILES: "${HTTPS_FILES_PORT}",
    HTTPS_BPMN: "${HTTPS_BPMN_PORT}",
    TCP_MOGNO: "${MONGO_PORT}",
    TCP_TYPEDB: "${TYPEDB_PORT}",
  });
  assert.deepEqual(byId.get("@traefik")?.env, {
    TRAEFIK_HTTP_PORT: "${WEB_PORT}",
    TRAEFIK_HTTPS_PORT: "${WEBSECURE_PORT}",
    TRAEFIK_INTERNAL_PORT: "${ADMIN_PORT}",
    TRAEFIK_HTTPS_TRAEFIK_PORT: "${HTTPS_TRAEFIK_PORT}",
    TRAEFIK_HTTPS_NGINX_PORT: "${HTTPS_NGINX_PORT}",
    TRAEFIK_HTTPS_CMS_PORT: "${HTTPS_CMS_PORT}",
    TRAEFIK_HTTPS_FLOW_PORT: "${HTTPS_FLOW_PORT}",
    TRAEFIK_HTTPS_FLOWTMS_PORT: "${HTTPS_FLOWTMS_PORT}",
    TRAEFIK_HTTPS_API_PORT: "${HTTPS_API_PORT}",
    TRAEFIK_HTTPS_FILES_PORT: "${HTTPS_FILES_PORT}",
    TRAEFIK_HTTPS_BPMN_PORT: "${HTTPS_BPMN_PORT}",
    TRAEFIK_MONGO_PORT: "${MONGO_PORT}",
    TRAEFIK_TYPEDB_PORT: "${TYPEDB_PORT}",
    TRAEFIK_WEB_URL: "http://127.0.0.1:${WEB_PORT}/",
    TRAEFIK_WEBSECURE_URL: "https://127.0.0.1:${WEBSECURE_PORT}/",
    TRAEFIK_DASHBOARD_URL: "http://127.0.0.1:${ADMIN_PORT}/dashboard/",
    TRAEFIK_PING_URL: "http://127.0.0.1:${ADMIN_PORT}/ping",
  });
  assert.deepEqual(byId.get("@traefik")?.globalenv, {
    TRAEFIK_HTTP_PORT: "${WEB_PORT}",
    TRAEFIK_HTTPS_PORT: "${WEBSECURE_PORT}",
    TRAEFIK_INTERNAL_PORT: "${ADMIN_PORT}",
    TRAEFIK_HTTPS_TRAEFIK_PORT: "${HTTPS_TRAEFIK_PORT}",
    TRAEFIK_HTTPS_NGINX_PORT: "${HTTPS_NGINX_PORT}",
    TRAEFIK_HTTPS_CMS_PORT: "${HTTPS_CMS_PORT}",
    TRAEFIK_HTTPS_FLOW_PORT: "${HTTPS_FLOW_PORT}",
    TRAEFIK_HTTPS_FLOWTMS_PORT: "${HTTPS_FLOWTMS_PORT}",
    TRAEFIK_HTTPS_API_PORT: "${HTTPS_API_PORT}",
    TRAEFIK_HTTPS_FILES_PORT: "${HTTPS_FILES_PORT}",
    TRAEFIK_HTTPS_BPMN_PORT: "${HTTPS_BPMN_PORT}",
    TRAEFIK_MONGO_PORT: "${MONGO_PORT}",
    TRAEFIK_TYPEDB_PORT: "${TYPEDB_PORT}",
    TRAEFIK_WEB_URL: "http://127.0.0.1:${WEB_PORT}/",
    TRAEFIK_WEBSECURE_URL: "https://127.0.0.1:${WEBSECURE_PORT}/",
    TRAEFIK_DASHBOARD_URL: "http://127.0.0.1:${ADMIN_PORT}/dashboard/",
    TRAEFIK_PING_URL: "http://127.0.0.1:${ADMIN_PORT}/ping",
    TRAEFIK_TRAEFIK_URL: "http://127.0.0.1:${ADMIN_PORT}/dashboard/",
    TRAEFIK_HOST_DOMAIN: "localhost",
    TRAEFIK_HOST_DOMAIN_URL: "localhost",
    TRAEFIK_HOST_DOMAIN_SUFFIX: "localhost",
  });
  assert.deepEqual(byId.get("@traefik")?.healthcheck, {
    type: "http",
    url: "http://127.0.0.1:${ADMIN_PORT}/ping",
    expected_status: 200,
    retries: 80,
    interval: 250,
  });
  assert.equal(byId.get("echo-service")?.artifact?.source.repo, "service-lasso/lasso-echoservice");
  assert.equal(byId.get("service-admin")?.artifact?.source.repo, "service-lasso/lasso-serviceadmin");
  assert.equal(byId.get("service-admin")?.name, "Core Service Admin");
  assert.match(byId.get("service-admin")?.description ?? "", /Core operator\/admin UI service/);
});

test("loadServiceManifest fails explicitly for malformed manifests", async () => {
  const servicesRoot = await makeTempServicesRoot();
  const manifestPath = path.join(servicesRoot, "broken", "service.json");

  try {
    await mkdir(path.dirname(manifestPath), { recursive: true });
    await writeFile(
      manifestPath,
      JSON.stringify({
        id: "broken",
        description: "Missing name should fail",
      }),
    );

    await assert.rejects(
      () => loadServiceManifest(manifestPath),
      /expected non-empty string for "name"/i,
    );
  } finally {
    await rm(servicesRoot, { recursive: true, force: true });
  }
});

test("loadServiceManifest accepts bounded tcp healthchecks", async () => {
  const servicesRoot = await makeTempServicesRoot();
  const manifestPath = path.join(servicesRoot, "tcp-service", "service.json");

  try {
    await mkdir(path.dirname(manifestPath), { recursive: true });
    await writeFile(
      manifestPath,
      JSON.stringify({
        id: "tcp-service",
        name: "TCP Service",
        description: "Service with bounded tcp health.",
        healthcheck: {
          type: "tcp",
          address: "127.0.0.1:4012",
        },
      }),
    );

    const manifest = await loadServiceManifest(manifestPath);

    assert.deepEqual(manifest.healthcheck, {
      type: "tcp",
      address: "127.0.0.1:4012",
    });
  } finally {
    await rm(servicesRoot, { recursive: true, force: true });
  }
});

test("loadServiceManifest accepts bounded file healthchecks", async () => {
  const servicesRoot = await makeTempServicesRoot();
  const manifestPath = path.join(servicesRoot, "file-service", "service.json");

  try {
    await mkdir(path.dirname(manifestPath), { recursive: true });
    await writeFile(
      manifestPath,
      JSON.stringify({
        id: "file-service",
        name: "File Service",
        description: "Service with bounded file health.",
        healthcheck: {
          type: "file",
          file: "./runtime/ready.txt",
        },
      }),
    );

    const manifest = await loadServiceManifest(manifestPath);

    assert.deepEqual(manifest.healthcheck, {
      type: "file",
      file: "./runtime/ready.txt",
    });
  } finally {
    await rm(servicesRoot, { recursive: true, force: true });
  }
});

test("loadServiceManifest accepts bounded variable healthchecks", async () => {
  const servicesRoot = await makeTempServicesRoot();
  const manifestPath = path.join(servicesRoot, "variable-service", "service.json");

  try {
    await mkdir(path.dirname(manifestPath), { recursive: true });
    await writeFile(
      manifestPath,
      JSON.stringify({
        id: "variable-service",
        name: "Variable Service",
        description: "Service with bounded variable health.",
        healthcheck: {
          type: "variable",
          variable: "${ECHO_MESSAGE}",
        },
      }),
    );

    const manifest = await loadServiceManifest(manifestPath);

    assert.deepEqual(manifest.healthcheck, {
      type: "variable",
      variable: "${ECHO_MESSAGE}",
    });
  } finally {
    await rm(servicesRoot, { recursive: true, force: true });
  }
});

test("loadServiceManifest accepts donor-aligned readiness retry fields", async () => {
  const servicesRoot = await makeTempServicesRoot();

  try {
    await writeManifest(servicesRoot, "http-ready-service", {
      id: "http-ready-service",
      name: "HTTP Ready Service",
      description: "Manifest proving readiness retry parsing.",
      healthcheck: {
        type: "http",
        url: "http://127.0.0.1:18080/health",
        expected_status: 200,
        retries: 5,
        interval: 250,
        start_period: 100,
      },
    });

    const manifest = await loadServiceManifest(path.join(servicesRoot, "http-ready-service", "service.json"));

    assert.deepEqual(manifest.healthcheck, {
      type: "http",
      url: "http://127.0.0.1:18080/health",
      expected_status: 200,
      retries: 5,
      interval: 250,
      start_period: 100,
    });
  } finally {
    await rm(servicesRoot, { recursive: true, force: true });
  }
});

test("loadServiceManifest accepts bounded globalenv emission maps", async () => {
  const servicesRoot = await makeTempServicesRoot();
  const manifestPath = path.join(servicesRoot, "emitter-service", "service.json");

  try {
    await mkdir(path.dirname(manifestPath), { recursive: true });
    await writeFile(
      manifestPath,
      JSON.stringify({
        id: "emitter-service",
        name: "Emitter Service",
        description: "Service with bounded globalenv emission.",
        env: {
          ECHO_MESSAGE: "hello shared env",
        },
        globalenv: {
          SHARED_MESSAGE: "${ECHO_MESSAGE}",
        },
      }),
    );

    const manifest = await loadServiceManifest(manifestPath);

    assert.deepEqual(manifest.globalenv, {
      SHARED_MESSAGE: "${ECHO_MESSAGE}",
    });
  } finally {
    await rm(servicesRoot, { recursive: true, force: true });
  }
});

test("loadServiceManifest accepts bounded autostart flags", async () => {
  const servicesRoot = await makeTempServicesRoot();
  const manifestPath = path.join(servicesRoot, "autostart-service", "service.json");

  try {
    await mkdir(path.dirname(manifestPath), { recursive: true });
    await writeFile(
      manifestPath,
      JSON.stringify({
        id: "autostart-service",
        name: "Autostart Service",
        description: "Service opting into bounded autostart.",
        autostart: true,
      }),
    );

    const manifest = await loadServiceManifest(manifestPath);

    assert.equal(manifest.autostart, true);
  } finally {
    await rm(servicesRoot, { recursive: true, force: true });
  }
});

test("loadServiceManifest accepts provider service roles", async () => {
  const servicesRoot = await makeTempServicesRoot();
  const manifestPath = path.join(servicesRoot, "@node", "service.json");

  try {
    await mkdir(path.dirname(manifestPath), { recursive: true });
    await writeFile(
      manifestPath,
      JSON.stringify({
        id: "@node",
        name: "Node Runtime",
        description: "Local runtime provider.",
        role: "provider",
        executable: "node",
        args: ["--version"],
      }),
    );

    const manifest = await loadServiceManifest(manifestPath);

    assert.equal(manifest.role, "provider");
  } finally {
    await rm(servicesRoot, { recursive: true, force: true });
  }
});

test("loadServiceManifest accepts bounded recovery, doctor, and hook policies", async () => {
  const servicesRoot = await makeTempServicesRoot();
  const manifestPath = path.join(servicesRoot, "recovery-service", "service.json");

  try {
    await mkdir(path.dirname(manifestPath), { recursive: true });
    await writeFile(
      manifestPath,
      JSON.stringify({
        id: "recovery-service",
        name: "Recovery Service",
        description: "Service opting into bounded recovery policy.",
        monitoring: {
          enabled: true,
          intervalSeconds: 30,
          unhealthyThreshold: 2,
          startupGraceSeconds: 5,
        },
        restartPolicy: {
          enabled: true,
          onCrash: true,
          onUnhealthy: true,
          maxAttempts: 3,
          backoffSeconds: 10,
        },
        doctor: {
          enabled: true,
          timeoutSeconds: 15,
          failurePolicy: "block",
          steps: [
            {
              name: "validate-config",
              command: "node",
              args: ["./doctor/validate-config.mjs"],
              cwd: "./runtime",
              timeoutSeconds: 5,
              failurePolicy: "warn",
              env: {
                DOCTOR_MODE: "preflight",
              },
            },
          ],
        },
        hooks: {
          preRestart: [
            {
              name: "pre-restart",
              command: "node",
              args: ["./hooks/pre-restart.mjs"],
            },
          ],
          postUpgrade: [
            {
              name: "post-upgrade",
              command: "node",
              args: ["./hooks/post-upgrade.mjs"],
              failurePolicy: "block",
            },
          ],
          rollback: [
            {
              name: "rollback",
              command: "node",
              args: ["./hooks/rollback.mjs"],
              timeoutSeconds: 20,
            },
          ],
        },
      }),
    );

    const manifest = await loadServiceManifest(manifestPath);

    assert.deepEqual(manifest.monitoring, {
      enabled: true,
      intervalSeconds: 30,
      unhealthyThreshold: 2,
      startupGraceSeconds: 5,
    });
    assert.deepEqual(manifest.restartPolicy, {
      enabled: true,
      onCrash: true,
      onUnhealthy: true,
      maxAttempts: 3,
      backoffSeconds: 10,
    });
    assert.deepEqual(manifest.doctor, {
      enabled: true,
      timeoutSeconds: 15,
      failurePolicy: "block",
      steps: [
        {
          name: "validate-config",
          command: "node",
          args: ["./doctor/validate-config.mjs"],
          cwd: "./runtime",
          timeoutSeconds: 5,
          failurePolicy: "warn",
          env: {
            DOCTOR_MODE: "preflight",
          },
        },
      ],
    });
    assert.deepEqual(manifest.hooks, {
      preRestart: [
        {
          name: "pre-restart",
          command: "node",
          args: ["./hooks/pre-restart.mjs"],
          cwd: undefined,
          timeoutSeconds: undefined,
          failurePolicy: undefined,
          env: undefined,
        },
      ],
      postRestart: undefined,
      preUpgrade: undefined,
      postUpgrade: [
        {
          name: "post-upgrade",
          command: "node",
          args: ["./hooks/post-upgrade.mjs"],
          cwd: undefined,
          timeoutSeconds: undefined,
          failurePolicy: "block",
          env: undefined,
        },
      ],
      rollback: [
        {
          name: "rollback",
          command: "node",
          args: ["./hooks/rollback.mjs"],
          cwd: undefined,
          timeoutSeconds: 20,
          failurePolicy: undefined,
          env: undefined,
        },
      ],
      onFailure: undefined,
    });
  } finally {
    await rm(servicesRoot, { recursive: true, force: true });
  }
});

test("loadServiceManifest rejects unsafe recovery policy shapes", async () => {
  const servicesRoot = await makeTempServicesRoot();

  try {
    await writeManifest(servicesRoot, "bad-monitoring", {
      id: "bad-monitoring",
      name: "Bad Monitoring",
      description: "Invalid monitoring policy.",
      monitoring: {
        enabled: true,
        intervalSeconds: 0,
      },
    });
    await writeManifest(servicesRoot, "bad-hook", {
      id: "bad-hook",
      name: "Bad Hook",
      description: "Invalid hook policy.",
      hooks: {
        preRestart: [
          {
            name: "missing-command",
          },
        ],
      },
    });
    await writeManifest(servicesRoot, "bad-phase", {
      id: "bad-phase",
      name: "Bad Phase",
      description: "Invalid hook phase.",
      hooks: {
        duringRestart: [],
      },
    });

    await assert.rejects(
      () => loadServiceManifest(path.join(servicesRoot, "bad-monitoring", "service.json")),
      /monitoring\.intervalSeconds/i,
    );
    await assert.rejects(
      () => loadServiceManifest(path.join(servicesRoot, "bad-hook", "service.json")),
      /hooks\.preRestart\[0\]\.command/i,
    );
    await assert.rejects(
      () => loadServiceManifest(path.join(servicesRoot, "bad-phase", "service.json")),
      /unsupported hooks phase "duringRestart"/i,
    );
  } finally {
    await rm(servicesRoot, { recursive: true, force: true });
  }
});

test("loadServiceManifest accepts bounded ports declarations", async () => {
  const servicesRoot = await makeTempServicesRoot();
  const manifestPath = path.join(servicesRoot, "port-service", "service.json");

  try {
    await mkdir(path.dirname(manifestPath), { recursive: true });
    await writeFile(
      manifestPath,
      JSON.stringify({
        id: "port-service",
        name: "Port Service",
        description: "Service with bounded port declarations.",
        ports: {
          service: 43100,
          ui: 0,
        },
      }),
    );

    const manifest = await loadServiceManifest(manifestPath);

    assert.deepEqual(manifest.ports, {
      service: 43100,
      ui: 0,
    });
  } finally {
    await rm(servicesRoot, { recursive: true, force: true });
  }
});

test("loadServiceManifest accepts donor-style portmapping declarations", async () => {
  const servicesRoot = await makeTempServicesRoot();
  const manifestPath = path.join(servicesRoot, "mapped-service", "service.json");

  try {
    await mkdir(path.dirname(manifestPath), { recursive: true });
    await writeFile(
      manifestPath,
      JSON.stringify({
        id: "mapped-service",
        name: "Mapped Service",
        description: "Service with donor-style portmapping.",
        ports: {
          web: 18080,
          mongo: 19017,
        },
        portmapping: {
          HTTP: "${WEB_PORT}",
          TCP_MOGNO: "${MONGO_PORT}",
          LEGACY_LITERAL: 9250,
        },
      }),
    );

    const manifest = await loadServiceManifest(manifestPath);

    assert.deepEqual(manifest.portmapping, {
      HTTP: "${WEB_PORT}",
      TCP_MOGNO: "${MONGO_PORT}",
      LEGACY_LITERAL: "9250",
    });
  } finally {
    await rm(servicesRoot, { recursive: true, force: true });
  }
});

test("loadServiceManifest accepts platform commandline maps", async () => {
  const servicesRoot = await makeTempServicesRoot();
  const manifestPath = path.join(servicesRoot, "commandline-service", "service.json");

  try {
    await mkdir(path.dirname(manifestPath), { recursive: true });
    await writeFile(
      manifestPath,
      JSON.stringify({
        id: "commandline-service",
        name: "Commandline Service",
        description: "Service with donor-style commandline declarations.",
        executable: "service-binary",
        args: ["--fallback"],
        commandline: {
          win32: " --config=\"${SERVICE_ROOT}\\runtime\\service.yml\" --port=\":${SERVICE_PORT}\"",
          linux: " --config=\"${SERVICE_ROOT}/runtime/service.yml\" --port=\":${SERVICE_PORT}\"",
          default: " --config=\"${SERVICE_ROOT}/runtime/service.yml\" --port=\":${SERVICE_PORT}\"",
        },
      }),
    );

    const manifest = await loadServiceManifest(manifestPath);

    assert.deepEqual(manifest.commandline, {
      win32: " --config=\"${SERVICE_ROOT}\\runtime\\service.yml\" --port=\":${SERVICE_PORT}\"",
      linux: " --config=\"${SERVICE_ROOT}/runtime/service.yml\" --port=\":${SERVICE_PORT}\"",
      default: " --config=\"${SERVICE_ROOT}/runtime/service.yml\" --port=\":${SERVICE_PORT}\"",
    });
  } finally {
    await rm(servicesRoot, { recursive: true, force: true });
  }
});

test("loadServiceManifest accepts bounded install/config file materialization", async () => {
  const servicesRoot = await makeTempServicesRoot();
  const manifestPath = path.join(servicesRoot, "materialized-service", "service.json");

  try {
    await mkdir(path.dirname(manifestPath), { recursive: true });
    await writeFile(
      manifestPath,
      JSON.stringify({
        id: "materialized-service",
        name: "Materialized Service",
        description: "Service with bounded install/config file outputs.",
        install: {
          files: [
            {
              path: "./runtime/install.txt",
              content: "installed ${SERVICE_ID}",
            },
          ],
        },
        config: {
          files: [
            {
              path: "./runtime/config.json",
              content: "{\"port\":\"${SERVICE_PORT}\"}",
            },
          ],
        },
      }),
    );

    const manifest = await loadServiceManifest(manifestPath);

    assert.deepEqual(manifest.install, {
      files: [
        {
          path: "./runtime/install.txt",
          content: "installed ${SERVICE_ID}",
        },
      ],
    });
    assert.deepEqual(manifest.config, {
      files: [
        {
          path: "./runtime/config.json",
          content: "{\"port\":\"${SERVICE_PORT}\"}",
        },
      ],
    });
  } finally {
    await rm(servicesRoot, { recursive: true, force: true });
  }
});

test("loadServiceManifest accepts bounded manifest-owned archive artifact metadata", async () => {
  const servicesRoot = await makeTempServicesRoot();
  const manifestPath = path.join(servicesRoot, "artifact-service", "service.json");

  try {
    await mkdir(path.dirname(manifestPath), { recursive: true });
    await writeFile(
      manifestPath,
      JSON.stringify({
        id: "artifact-service",
        name: "Artifact Service",
        description: "Service with manifest-owned release metadata.",
        artifact: {
          kind: "archive",
          source: {
            type: "github-release",
            repo: "service-lasso/example-service",
            channel: "latest",
          },
          platforms: {
            default: {
              assetName: "artifact-service.zip",
              archiveType: "zip",
              command: process.execPath,
              args: ["./runtime/artifact-service.mjs"],
            },
          },
        },
      }),
    );

    const manifest = await loadServiceManifest(manifestPath);

    assert.deepEqual(manifest.artifact, {
      kind: "archive",
      source: {
        type: "github-release",
        repo: "service-lasso/example-service",
        channel: "latest",
        tag: undefined,
        serviceManifestAssetUrl: undefined,
        api_base_url: undefined,
      },
      platforms: {
        default: {
          assetName: "artifact-service.zip",
          assetUrl: undefined,
          archiveType: "zip",
          command: process.execPath,
          args: ["./runtime/artifact-service.mjs"],
        },
      },
    });
  } finally {
    await rm(servicesRoot, { recursive: true, force: true });
  }
});

test("GET /api/services returns manifest-backed data from the configured services root", async () => {
  const servicesRoot = await makeTempServicesRoot();
  const apiServer = await (async () => {
    await writeManifest(servicesRoot, "echo-service", {
      id: "echo-service",
      name: "Echo Service",
      description: "Sample service",
    });
    await writeManifest(servicesRoot, "@python", {
      id: "@python",
      name: "Python Runtime",
      description: "Runtime provider",
    });

    return startApiServer({ port: 0, servicesRoot, version: "test-version" });
  })();

  try {
    const response = await fetch(`${apiServer.url}/api/services`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.services.length, 2);
    assert.deepEqual(
      body.services.map((service) => service.id),
      ["@python", "echo-service"],
    );
    assert.equal(body.services[0].source, "manifest");
    assert.ok(body.services[0].manifestPath);
  } finally {
    await apiServer.stop();
    await rm(servicesRoot, { recursive: true, force: true });
  }
});

test("runtime startup fails explicitly when a manifest is malformed", async () => {
  const servicesRoot = await makeTempServicesRoot();
  await writeManifest(servicesRoot, "broken-service", {
    id: "broken-service",
    description: "Missing name should fail",
  });

  await assert.rejects(() => startApiServer({ port: 0, servicesRoot }), /expected non-empty string for "name"/i);
  await rm(servicesRoot, { recursive: true, force: true });
});
