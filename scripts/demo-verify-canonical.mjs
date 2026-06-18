import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  defaultDemoServicesRoot,
  defaultDemoWorkspaceRoot,
} from "./demo-instance-lib.mjs";

const scriptPath = fileURLToPath(import.meta.url);
export const canonicalDemoHost = "192.168.1.53";
export const canonicalRuntimePort = 17883;
export const canonicalServiceAdminPort = 17700;
export const canonicalServiceIds = ["@archive", "@java", "@localcert", "@nginx", "@traefik", "@node", "@python", "@secretsbroker", "echo-service", "@serviceadmin"];

function parseFlag(args, name) {
  const prefix = `--${name}=`;
  const value = args.find((entry) => entry.startsWith(prefix));
  return value ? value.slice(prefix.length) : undefined;
}

function parseNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeUrlBase(url) {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

function urlPort(url) {
  try {
    const parsed = new URL(url);
    if (parsed.port) {
      return Number(parsed.port);
    }
    return parsed.protocol === "https:" ? 443 : 80;
  } catch {
    return null;
  }
}

function normalizePathForCompare(value) {
  const resolved = path.resolve(String(value ?? ""));
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function check(checks, name, ok, code, detail = "") {
  checks.push({ name, ok, code: ok ? null : code, detail });
}

function checkEqual(checks, name, actual, expected, code, detailPrefix = "") {
  const ok = actual === expected;
  const detail = ok
    ? `${actual}`
    : `${detailPrefix}${detailPrefix ? ": " : ""}expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`;
  check(checks, name, ok, code, detail);
}

async function fetchJson(url, fetchImpl, timeoutMs) {
  try {
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
    const body = await response.json();
    return { ok: response.status >= 200 && response.status < 300, status: response.status, body };
  } catch (error) {
    return { ok: false, status: null, error: error.message, body: null };
  }
}

async function fetchText(url, fetchImpl, timeoutMs) {
  try {
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
    const body = await response.text();
    return { ok: response.status >= 200 && response.status < 300, status: response.status, body };
  } catch (error) {
    return { ok: false, status: null, error: error.message, body: "" };
  }
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

export function resolveCanonicalVerifierOptions(args = process.argv.slice(2), env = process.env) {
  const host = parseFlag(args, "host") ?? env.SERVICE_LASSO_DEMO_HOST ?? canonicalDemoHost;
  const runtimePort = parseNumber(
    parseFlag(args, "runtime-port") ?? parseFlag(args, "port") ?? env.SERVICE_LASSO_PORT,
    canonicalRuntimePort,
  );
  const serviceAdminPort = parseNumber(
    parseFlag(args, "service-admin-port") ?? env.SERVICE_LASSO_DEMO_SERVICEADMIN_PORT,
    canonicalServiceAdminPort,
  );

  const runtimeUrl = normalizeUrlBase(
    parseFlag(args, "runtime-url")
      ?? env.SERVICE_LASSO_DEMO_RUNTIME_URL
      ?? `http://${host}:${runtimePort}`,
  );
  const serviceAdminUrl =
    parseFlag(args, "service-admin-url")
    ?? env.SERVICE_LASSO_DEMO_SERVICEADMIN_URL
    ?? `http://${host}:${serviceAdminPort}/`;

  return {
    host,
    runtimePort,
    serviceAdminPort,
    runtimeUrl,
    serviceAdminUrl,
    runtimeHealthUrl: `${runtimeUrl}/api/health`,
    runtimeSummaryUrl: `${runtimeUrl}/api/runtime`,
    runtimeServicesUrl: `${runtimeUrl}/api/services`,
    servicesRoot: path.resolve(parseFlag(args, "services-root") ?? env.SERVICE_LASSO_SERVICES_ROOT ?? defaultDemoServicesRoot),
    workspaceRoot: path.resolve(parseFlag(args, "workspace-root") ?? env.SERVICE_LASSO_WORKSPACE_ROOT ?? defaultDemoWorkspaceRoot),
    timeoutMs: parseNumber(parseFlag(args, "timeout-ms") ?? env.SERVICE_LASSO_DEMO_VERIFY_TIMEOUT_MS, 10_000),
    serviceIds: canonicalServiceIds,
  };
}

export async function readExpectedDemoServices(servicesRoot, serviceIds = canonicalServiceIds) {
  const expected = new Map();

  for (const serviceId of serviceIds) {
    const manifest = await readJson(path.join(servicesRoot, serviceId, "service.json"));
    const platform = manifest.artifact?.platforms?.[process.platform];
    expected.set(serviceId, {
      id: serviceId,
      providerRole: manifest.role === "provider",
      repo: manifest.artifact?.source?.repo ?? null,
      tag: manifest.artifact?.source?.tag ?? null,
      assetName: platform?.assetName ?? null,
      ports: manifest.ports ?? {},
      serviceRoot: path.join(servicesRoot, serviceId),
    });
  }

  return expected;
}

function serviceSummary(service, expected) {
  return {
    id: service.id,
    installed: service.lifecycle?.installed === true,
    configured: service.lifecycle?.configured === true,
    running: service.lifecycle?.running === true,
    healthy: service.health?.healthy === true,
    catalogTag: service.catalogProvenance?.releaseTag ?? null,
    installedTag: service.lifecycle?.installArtifacts?.artifact?.tag ?? null,
    expectedTag: expected.tag,
  };
}

export async function verifyCanonicalDemo(options = {}, deps = {}) {
  const resolved = {
    ...resolveCanonicalVerifierOptions([], {}),
    ...options,
  };
  const fetchImpl = deps.fetch ?? fetch;
  const checks = [];
  const expectedServices = await readExpectedDemoServices(resolved.servicesRoot, resolved.serviceIds);

  checkEqual(
    checks,
    "runtime port is canonical",
    urlPort(resolved.runtimeUrl),
    resolved.runtimePort,
    "wrong_runtime_port",
  );
  checkEqual(
    checks,
    "Service Admin port is canonical",
    urlPort(resolved.serviceAdminUrl),
    resolved.serviceAdminPort,
    "wrong_serviceadmin_port",
  );

  const [serviceAdmin, runtimeHealth, runtimeSummary, runtimeServices] = await Promise.all([
    fetchText(resolved.serviceAdminUrl, fetchImpl, resolved.timeoutMs),
    fetchJson(resolved.runtimeHealthUrl, fetchImpl, resolved.timeoutMs),
    fetchJson(resolved.runtimeSummaryUrl, fetchImpl, resolved.timeoutMs),
    fetchJson(resolved.runtimeServicesUrl, fetchImpl, resolved.timeoutMs),
  ]);

  check(
    checks,
    "Service Admin LAN reachable",
    serviceAdmin.ok,
    "unreachable_lan",
    serviceAdmin.ok ? `HTTP ${serviceAdmin.status}` : `${resolved.serviceAdminUrl}: ${serviceAdmin.error ?? `HTTP ${serviceAdmin.status}`}`,
  );
  check(
    checks,
    "runtime health LAN reachable",
    runtimeHealth.ok && runtimeHealth.body?.status === "ok",
    "unreachable_lan",
    runtimeHealth.ok
      ? `HTTP ${runtimeHealth.status}, status=${JSON.stringify(runtimeHealth.body?.status ?? null)}`
      : `${resolved.runtimeHealthUrl}: ${runtimeHealth.error ?? `HTTP ${runtimeHealth.status}`}`,
  );
  check(
    checks,
    "runtime summary reachable",
    Boolean(runtimeSummary.ok && runtimeSummary.body?.runtime),
    "missing_runtime_metadata",
    runtimeSummary.ok ? `HTTP ${runtimeSummary.status}` : `${resolved.runtimeSummaryUrl}: ${runtimeSummary.error ?? `HTTP ${runtimeSummary.status}`}`,
  );
  check(
    checks,
    "runtime services reachable",
    Boolean(runtimeServices.ok && Array.isArray(runtimeServices.body?.services)),
    "missing_runtime_services",
    runtimeServices.ok ? `HTTP ${runtimeServices.status}` : `${resolved.runtimeServicesUrl}: ${runtimeServices.error ?? `HTTP ${runtimeServices.status}`}`,
  );

  const runtime = runtimeSummary.body?.runtime;
  if (runtime) {
    checkEqual(
      checks,
      "runtime services root matches canonical repo",
      normalizePathForCompare(runtime.servicesRoot),
      normalizePathForCompare(resolved.servicesRoot),
      "wrong_lane",
    );
    checkEqual(
      checks,
      "runtime workspace root matches canonical demo",
      normalizePathForCompare(runtime.workspaceRoot),
      normalizePathForCompare(resolved.workspaceRoot),
      "wrong_lane",
    );
  }

  const liveServices = new Map((runtimeServices.body?.services ?? []).map((service) => [service.id, service]));
  const serviceSummaries = [];

  for (const [serviceId, expected] of expectedServices.entries()) {
    const live = liveServices.get(serviceId);
    check(checks, `${serviceId} is present`, Boolean(live), "missing_service", serviceId);
    if (!live) {
      continue;
    }

    serviceSummaries.push(serviceSummary(live, expected));
    check(checks, `${serviceId} is installed`, live.lifecycle?.installed === true, "unprepared_service", `installed=${live.lifecycle?.installed === true}`);
    check(checks, `${serviceId} is configured`, live.lifecycle?.configured === true, "unprepared_service", `configured=${live.lifecycle?.configured === true}`);
    check(
      checks,
      expected.providerRole ? `${serviceId} provider daemon is not required` : `${serviceId} is running`,
      live.lifecycle?.running === !expected.providerRole,
      "unhealthy_service",
      `running=${live.lifecycle?.running === true}`,
    );
    check(checks, `${serviceId} is healthy`, live.health?.healthy === true, "unhealthy_service", `healthy=${live.health?.healthy === true}`);
    checkEqual(
      checks,
      `${serviceId} service root matches canonical services root`,
      normalizePathForCompare(live.serviceRoot),
      normalizePathForCompare(expected.serviceRoot),
      "wrong_lane",
    );
    checkEqual(checks, `${serviceId} catalog repo matches manifest`, live.catalogProvenance?.repo ?? null, expected.repo, "stale_release_pin");
    checkEqual(checks, `${serviceId} catalog release tag matches manifest`, live.catalogProvenance?.releaseTag ?? null, expected.tag, "stale_release_pin");
    checkEqual(checks, `${serviceId} installed artifact repo matches manifest`, live.lifecycle?.installArtifacts?.artifact?.repo ?? null, expected.repo, "stale_installed_artifact");
    checkEqual(checks, `${serviceId} installed artifact tag matches manifest`, live.lifecycle?.installArtifacts?.artifact?.tag ?? null, expected.tag, "stale_installed_artifact");
    if (expected.assetName) {
      checkEqual(
        checks,
        `${serviceId} installed artifact asset matches platform`,
        live.lifecycle?.installArtifacts?.artifact?.assetName ?? null,
        expected.assetName,
        "stale_installed_artifact",
      );
    }

    for (const [portName, port] of Object.entries(expected.ports)) {
      checkEqual(
        checks,
        `${serviceId} runtime port ${portName} matches manifest`,
        live.lifecycle?.runtime?.ports?.[portName] ?? null,
        port,
        "wrong_service_port",
      );
    }
  }

  return {
    ok: checks.every((entry) => entry.ok),
    checks,
    failures: checks.filter((entry) => !entry.ok),
    summary: {
      runtimeUrl: resolved.runtimeUrl,
      serviceAdminUrl: resolved.serviceAdminUrl,
      servicesRoot: resolved.servicesRoot,
      workspaceRoot: resolved.workspaceRoot,
      services: serviceSummaries,
    },
  };
}

export function formatCanonicalVerifierResult(result) {
  const lines = [
    `[service-lasso demo] canonical verifier ${result.ok ? "passed" : "failed"}`,
    `- runtime: ${result.summary.runtimeUrl}`,
    `- serviceAdmin: ${result.summary.serviceAdminUrl}`,
    `- servicesRoot: ${result.summary.servicesRoot}`,
    `- workspaceRoot: ${result.summary.workspaceRoot}`,
  ];

  if (result.summary.services.length > 0) {
    lines.push("- release pins:");
    for (const service of result.summary.services) {
      lines.push(
        `  - ${service.id}: expected=${service.expectedTag} catalog=${service.catalogTag} installed=${service.installedTag} prepared=${service.installed}/${service.configured} running=${service.running} healthy=${service.healthy}`,
      );
    }
  }

  lines.push("- checks:");
  for (const checkResult of result.checks) {
    lines.push(
      `  - ${checkResult.ok ? "ok" : "FAIL"} ${checkResult.name}${checkResult.ok ? "" : ` [${checkResult.code}]`}: ${checkResult.detail}`,
    );
  }

  return lines.join("\n");
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  const result = await verifyCanonicalDemo(resolveCanonicalVerifierOptions());
  console.log(formatCanonicalVerifierResult(result));
  process.exitCode = result.ok ? 0 : 1;
}
