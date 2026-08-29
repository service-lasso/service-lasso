import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { discoverServices } from "../dist/runtime/discovery/discoverServices.js";
import { createServiceRegistry, DependencyGraph } from "../dist/runtime/manager/DependencyGraph.js";
import { collectRuntimeGlobalEnv } from "../dist/runtime/operator/variables.js";
import { appendAuditEvent } from "../dist/runtime/audit/store.js";
import { writeServiceUpdateState } from "../dist/runtime/updates/state.js";
import { appendServiceRecoveryHistoryEvents } from "../dist/runtime/recovery/history.js";
import { getServiceRuntimeLogPaths } from "../dist/runtime/operator/logs.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  buildMcpAuditPayload,
  buildMcpConfigDriftPayload,
  buildMcpDependencyStatusPayload,
  buildMcpDiagnosticsSummaryPayload,
  buildMcpHealthPayload,
  buildMcpLogsSummaryPayload,
  buildMcpOperationStatusPayload,
  buildMcpRecoveryPayload,
  buildMcpRoutesPayload,
  buildMcpRuntimeStatusPayload,
  buildMcpServiceDetailPayload,
  buildMcpServicesPayload,
  buildMcpSecretMetadataPayload,
  buildMcpUpdatesPayload,
  createServiceLassoMcpServer,
  getServiceLassoMcpCapabilities,
} from "../dist/runtime/operator/mcp.js";
import {
  assertNoSecretMaterial,
  serviceLassoSecretLeakSentinels,
} from "../dist/testing/secretLeakHarness.js";
import { makeTempServicesRoot, writeExecutableFixtureService } from "./test-helpers.js";

async function fixtureContext(servicesRoot, workspaceRoot) {
  const discovered = await discoverServices(servicesRoot);
  const registry = createServiceRegistry(discovered);
  return {
    version: "mcp-read-test",
    servicesRoot,
    workspaceRoot,
    discovered,
    registry,
    graph: new DependencyGraph(registry),
    sharedGlobalEnv: collectRuntimeGlobalEnv(discovered),
  };
}

test("MCP read contracts paginate deterministically and omit sensitive paths and values", async () => {
  const { tempRoot, servicesRoot, workspaceRoot } = await makeTempServicesRoot("service-lasso-mcp-read-");
  const secret = serviceLassoSecretLeakSentinels[0].value;
  const hostilePosixPath = "/opt/service-lasso/private-mcp-version.txt";
  const hostileForwardSlashWindowsPath = "C:/service-lasso/private-mcp-version.txt";
  const hostileManifestVersion = `manifest-${secret}-${hostilePosixPath}-${hostileForwardSlashWindowsPath}-${path.join(tempRoot, "manifest-version.txt")}`;
  const hostileAvailableTag = `available-tag-${secret}-${hostilePosixPath}-${hostileForwardSlashWindowsPath}-${path.join(tempRoot, "available-tag.txt")}`;
  const hostileAvailableVersion = `available-version-${secret}-${hostilePosixPath}-${hostileForwardSlashWindowsPath}-${path.join(tempRoot, "available-version.txt")}`;
  const hostileCandidateTag = `candidate-tag-${secret}-${hostilePosixPath}-${hostileForwardSlashWindowsPath}-${path.join(tempRoot, "candidate-tag.txt")}`;
  const hostileCandidateVersion = `candidate-version-${secret}-${hostilePosixPath}-${hostileForwardSlashWindowsPath}-${path.join(tempRoot, "candidate-version.txt")}`;
  const hostileValues = [
    hostileManifestVersion,
    hostileAvailableTag,
    hostileAvailableVersion,
    hostileCandidateTag,
    hostileCandidateVersion,
  ];
  const assertNoHostileMcpText = (value) => {
    const text = JSON.stringify(value);
    assert.equal(text.includes(secret), false);
    assert.equal(text.includes(tempRoot), false);
    assert.equal(text.includes(hostilePosixPath), false);
    assert.equal(text.includes(hostileForwardSlashWindowsPath), false);
    for (const hostileValue of hostileValues) {
      assert.equal(text.includes(hostileValue), false);
    }
  };

  try {
    await writeExecutableFixtureService(servicesRoot, "alpha-service", {
      env: { PRIVATE_TOKEN: secret },
      ports: { web: 43150 },
      endpoints: [{
        id: "web",
        kind: "network",
        label: "web",
        protocol: "http",
        bind: "127.0.0.1",
        port: { strategy: "preferred", default: 43150 },
        exposure: "lan",
      }],
      urls: [
        {
          label: "admin",
          url: "https://user:password@example.invalid:43150/admin?access_token=keep-out#frag",
        },
        {
          label: "public",
          url: "https://example.invalid:43150/public",
        },
      ],
      config: {
        files: [{ path: "runtime/private.ini", content: `token=${secret}\n` }],
      },
    });
    await writeExecutableFixtureService(servicesRoot, "beta-service", {
      depend_on: ["alpha-service"],
    });

    const alphaManifestPath = path.join(servicesRoot, "alpha-service", "service.json");
    const alphaManifest = JSON.parse(await readFile(alphaManifestPath, "utf8"));
    await writeFile(alphaManifestPath, JSON.stringify({
      ...alphaManifest,
      version: hostileManifestVersion,
    }, null, 2));
    const betaManifestPath = path.join(servicesRoot, "beta-service", "service.json");
    const betaManifest = JSON.parse(await readFile(betaManifestPath, "utf8"));
    await writeFile(betaManifestPath, JSON.stringify({
      ...betaManifest,
      description: "See https://example.invalid/releases/tag/v2 for details.",
      version: "release/v2.0.0",
    }, null, 2));

    const context = await fixtureContext(servicesRoot, workspaceRoot);
    const alpha = context.registry.getById("alpha-service");
    assert.ok(alpha);

    await appendAuditEvent({
      workspaceRoot,
      source: "mcp-read-test",
      action: "fixture.read",
      actor: "fixture-actor",
      subject: alpha.serviceRoot,
      serviceId: alpha.manifest.id,
      outcome: "failure",
      statusCode: 503,
      summary: `Read failed beneath ${alpha.serviceRoot}.`,
      reason: `workspace ${workspaceRoot} and /opt/private/secret.ini unavailable`,
      metadata: { safeCategory: "fixture" },
    });

    await writeServiceUpdateState(alpha, {
      serviceId: alpha.manifest.id,
      state: "downloadedCandidate",
      updatedAt: "2026-08-25T00:00:00.000Z",
      lastCheck: {
        checkedAt: "2026-08-25T00:00:00.000Z",
        status: "update_available",
        reason: `token=${secret}`,
        sourceRepo: "private/example",
        track: "latest",
        installedTag: "v1",
        manifestTag: "v1",
        latestTag: "v2",
      },
      provenance: null,
      available: {
        tag: hostileAvailableTag,
        version: hostileAvailableVersion,
        releaseUrl: "https://example.invalid/private-release",
        publishedAt: "2026-08-25T00:00:00.000Z",
        assetName: "private.zip",
        assetUrl: "https://example.invalid/private.zip",
      },
      downloadedCandidate: {
        tag: hostileCandidateTag,
        version: hostileCandidateVersion,
        assetName: "private.zip",
        assetUrl: "https://example.invalid/private.zip",
        archivePath: path.join(tempRoot, "private.zip"),
        extractedPath: path.join(tempRoot, "private"),
        downloadedAt: "2026-08-25T00:01:00.000Z",
      },
      installDeferred: null,
      failed: null,
      hookResults: [{
        phase: "preUpgrade",
        ok: false,
        blocked: true,
        recordedAt: "2026-08-25T00:02:00.000Z",
        steps: [{
          phase: "preUpgrade",
          name: "private-step",
          command: `read ${alpha.serviceRoot}`,
          ok: false,
          exitCode: 1,
          timedOut: false,
          failurePolicy: "block",
          stdout: secret,
          stderr: alpha.serviceRoot,
          startedAt: "2026-08-25T00:01:30.000Z",
          finishedAt: "2026-08-25T00:01:31.000Z",
        }],
      }],
    });

    await appendServiceRecoveryHistoryEvents(alpha, [{
      kind: "hook",
      serviceId: alpha.manifest.id,
      phase: "postInstall",
      ok: false,
      blocked: true,
      at: "2026-08-25T00:03:00.000Z",
      steps: [{
        phase: "postInstall",
        name: "private-step",
        command: `read ${alpha.serviceRoot}`,
        ok: false,
        exitCode: 1,
        timedOut: true,
        failurePolicy: "block",
        stdout: secret,
        stderr: alpha.serviceRoot,
        startedAt: "2026-08-25T00:02:30.000Z",
        finishedAt: "2026-08-25T00:02:31.000Z",
      }],
    }]);

    const logPaths = getServiceRuntimeLogPaths(alpha.serviceRoot);
    await mkdir(path.dirname(logPaths.logPath), { recursive: true });
    await writeFile(logPaths.logPath, `token=${secret} path=${alpha.serviceRoot}\nsecond safe line\n`, "utf8");

    const firstPage = await buildMcpServicesPayload(context, { limit: 1 });
    const secondPage = await buildMcpServicesPayload(context, { cursor: firstPage.pagination.nextCursor, limit: 1 });
    assert.deepEqual(firstPage.services.map((service) => service.id), ["alpha-service"]);
    assert.deepEqual(secondPage.services.map((service) => service.id), ["beta-service"]);
    assert.equal(secondPage.pagination.nextCursor, null);
    assert.equal(secondPage.services[0].version, "release/v2.0.0");
    assert.equal(secondPage.services[0].description, "See https://example.invalid/releases/tag/v2 for details.");

    const outputs = {
      runtime: await buildMcpRuntimeStatusPayload(context),
      service: await buildMcpServiceDetailPayload(context, "alpha-service"),
      health: await buildMcpHealthPayload(context, "alpha-service"),
      routes: await buildMcpRoutesPayload(context, "alpha-service"),
      dependencies: await buildMcpDependencyStatusPayload(context, "alpha-service"),
      logs: await buildMcpLogsSummaryPayload(context, "alpha-service", { limit: 1 }),
      redactedLog: await buildMcpLogsSummaryPayload(context, "alpha-service", { cursor: "1", limit: 1 }),
      audit: await buildMcpAuditPayload(context, { serviceId: "alpha-service", limit: 10 }),
      updates: await buildMcpUpdatesPayload(context, { serviceId: "alpha-service" }),
      drift: await buildMcpConfigDriftPayload(context, "alpha-service"),
      recovery: await buildMcpRecoveryPayload(context, "alpha-service", { limit: 10 }),
      diagnostics: await buildMcpDiagnosticsSummaryPayload(context, "alpha-service"),
      secretMetadata: await buildMcpSecretMetadataPayload(context, "alpha-service"),
    };
    const serialized = JSON.stringify({ firstPage, outputs });

    assert.equal(outputs.logs.log.entries[0].summary.includes("[REDACTED]"), false);
    assert.equal(outputs.logs.log.entries[0].summary, "second safe line");
    assert.equal(outputs.redactedLog.log.entries[0].summary.includes(secret), false);
    assert.equal(outputs.redactedLog.log.entries[0].summary.includes(alpha.serviceRoot), false);
    assert.match(outputs.redactedLog.log.entries[0].summary, /\[REDACTED/);
    assert.equal(outputs.audit.events[0].subject, "[REDACTED_PATH]");
    assert.match(firstPage.services[0].version, /\[REDACTED/);
    assert.match(outputs.service.service.version, /\[REDACTED/);
    assert.match(outputs.updates.services[0].declaredVersion, /\[REDACTED/);
    assert.match(outputs.updates.services[0].available.tag, /\[REDACTED/);
    assert.match(outputs.updates.services[0].available.version, /\[REDACTED/);
    assert.match(outputs.updates.services[0].downloadedCandidate.tag, /\[REDACTED/);
    assert.match(outputs.updates.services[0].downloadedCandidate.version, /\[REDACTED/);
    assert.match(outputs.drift.artifacts[0].artifactId, /^config-[a-f0-9]{16}$/);
    assert.equal(outputs.recovery.events[0].stepSummary.timedOut, 1);
    assert.equal(outputs.routes.services[0].routes[0].provider, "traefik");
    assert.deepEqual(outputs.routes.services[0].routes.find((route) => route.endpoint.label === "admin")?.target, {});
    assert.equal(outputs.routes.services[0].routes.find((route) => route.endpoint.label === "admin")?.state, "invalid");
    assert.deepEqual(
      outputs.routes.services[0].routes.find((route) => route.endpoint.label === "public")?.target,
      {
        protocol: "https",
        host: "example.invalid:43150",
        path: "/public",
        pathPrefix: "/public",
      },
    );
    assertNoSecretMaterial(outputs);
    assertNoHostileMcpText({ firstPage, outputs });
    assert.equal(serialized.includes(alpha.serviceRoot), false);
    assert.equal(serialized.includes("/opt/private/secret.ini"), false);
    assert.equal(serialized.includes("private.ini"), false);
    assert.equal(serialized.includes("archivePath"), false);
    assert.equal(serialized.includes('"command":'), false);
    assert.equal(serialized.includes('"stdout":'), false);
    assert.equal(serialized.includes('"stderr":'), false);

    const capabilities = getServiceLassoMcpCapabilities(context);
    assert.equal(capabilities.tools.every((tool) => tool.inputSchema.additionalProperties === false), true);
    assert.equal(capabilities.tools.every((tool) => tool.outputSchema.additionalProperties === false), true);
    assert.equal(capabilities.tools.every((tool) => tool.annotations.readOnlyHint === true), true);
    assert.equal(capabilities.resourceTemplates.length, 7);

    const server = createServiceLassoMcpServer(context);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "mcp-read-contract-test", version: "1.0.0" });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      const advertisedTools = await client.listTools();
      assert.equal(advertisedTools.tools.length, 15);
      assert.equal(advertisedTools.tools.every((tool) => tool.annotations?.readOnlyHint === true), true);
      assert.equal(advertisedTools.tools.every((tool) => tool.outputSchema?.additionalProperties === false), true);

      const result = await client.callTool({
        name: "service_lasso_list_services",
        arguments: { limit: 1 },
      });
      assert.equal(result.isError, undefined);
      assert.deepEqual(result.structuredContent, JSON.parse(result.content[0].text));
      assert.equal(result.structuredContent.pagination.nextCursor, "1");
      assertNoSecretMaterial(result.structuredContent);
      assertNoHostileMcpText(result.structuredContent);

      for (const [name, args] of [
        ["service_lasso_runtime_status", {}],
        ["service_lasso_get_service", { serviceId: "alpha-service" }],
        ["service_lasso_get_health", { serviceId: "alpha-service" }],
        ["service_lasso_list_routes", { serviceId: "alpha-service" }],
        ["service_lasso_dependency_status", { serviceId: "alpha-service" }],
        ["service_lasso_logs_summary", { serviceId: "alpha-service", limit: 1 }],
        ["service_lasso_audit_search", { serviceId: "alpha-service", limit: 1 }],
        ["service_lasso_update_status", { serviceId: "alpha-service", limit: 1 }],
        ["service_lasso_config_drift", { serviceId: "alpha-service" }],
        ["service_lasso_recovery_status", { serviceId: "alpha-service", limit: 1 }],
        ["service_lasso_diagnostics_summary", { serviceId: "alpha-service" }],
        ["service_lasso_secret_metadata", { serviceId: "alpha-service" }],
      ]) {
        const toolResult = await client.callTool({ name, arguments: args });
        assert.equal(toolResult.isError, undefined, `${name} should return a schema-valid read result`);
        assert.deepEqual(toolResult.structuredContent, JSON.parse(toolResult.content[0].text));
        assertNoSecretMaterial(toolResult.structuredContent);
        assertNoHostileMcpText(toolResult.structuredContent);
      }

      const invalidCursor = await client.callTool({
        name: "service_lasso_list_services",
        arguments: { cursor: "01" },
      });
      assert.equal(invalidCursor.isError, true);
      assert.equal(JSON.parse(invalidCursor.content[0].text).error.code, "invalid_cursor");

      const templates = await client.listResourceTemplates();
      assert.equal(templates.resourceTemplates.length, 7);
      const detailResource = await client.readResource({ uri: "servicelasso://services/alpha-service" });
      const resourcePayload = JSON.parse(detailResource.contents[0].text);
      assert.equal(resourcePayload.service.id, "alpha-service");
      assert.equal(JSON.stringify(resourcePayload).includes(alpha.serviceRoot), false);
      assertNoSecretMaterial(resourcePayload);
      assertNoHostileMcpText(resourcePayload);
    } finally {
      await client.close();
      await server.close();
    }

    await assert.rejects(
      buildMcpServicesPayload(context, { cursor: "01" }),
      (error) => error.code === "invalid_cursor",
    );
    await assert.rejects(
      buildMcpLogsSummaryPayload(context, "alpha-service", { cursor: "999" }),
      (error) => error.code === "invalid_cursor",
    );
    await assert.rejects(
      buildMcpServiceDetailPayload(context, "missing-service"),
      (error) => error.code === "unknown_service",
    );
    await assert.rejects(
      buildMcpOperationStatusPayload(context, "mcp-operation-00000000-0000-4000-8000-000000000000"),
      (error) => error.code === "authorization_required",
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
