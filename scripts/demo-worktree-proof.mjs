import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { access, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import {
  defaultDemoServicesRoot,
  defaultDemoWorkspaceRoot,
  repoRoot,
  resetDemoInstance,
  stopDemoManagedProcesses,
} from "./demo-instance-lib.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const defaultPortRangeStart = 18100;
const defaultPortRangeEnd = 18980;
const manifestPortRequests = [
  { serviceId: "@serviceadmin", kind: "ports", name: "ui" },
  { serviceId: "@secretsbroker", kind: "ports", name: "service" },
  { serviceId: "@nginx", kind: "ports", name: "http" },
  { serviceId: "echo-service", kind: "ports", name: "service" },
  { serviceId: "echo-service", kind: "ports", name: "health" },
  { serviceId: "@traefik", kind: "endpoint", name: "web" },
  { serviceId: "@traefik", kind: "endpoint", name: "websecure" },
  { serviceId: "@traefik", kind: "endpoint", name: "admin" },
  { serviceId: "@traefik", kind: "endpoint", name: "https_traefik" },
  { serviceId: "@traefik", kind: "endpoint", name: "https_nginx" },
  { serviceId: "@traefik", kind: "endpoint", name: "https_cms" },
  { serviceId: "@traefik", kind: "endpoint", name: "https_flow" },
  { serviceId: "@traefik", kind: "endpoint", name: "https_flowtms" },
  { serviceId: "@traefik", kind: "endpoint", name: "https_api" },
  { serviceId: "@traefik", kind: "endpoint", name: "https_files" },
  { serviceId: "@traefik", kind: "endpoint", name: "https_bpmn" },
  { serviceId: "@traefik", kind: "endpoint", name: "mongo" },
  { serviceId: "@traefik", kind: "endpoint", name: "typedb" },
];

function parseFlag(args, name) {
  const prefix = `--${name}=`;
  for (let index = 0; index < args.length; index += 1) {
    const entry = args[index];
    if (entry.startsWith(prefix)) return entry.slice(prefix.length);
    if (entry === `--${name}` && args[index + 1] && !args[index + 1].startsWith("--")) return args[index + 1];
  }
  return undefined;
}

function parseNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseNpmConfigValue(env, name) {
  const key = `npm_config_${name.replaceAll("-", "_")}`;
  const value = env[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function parseNpmBooleanFlag(env, name) {
  const key = `npm_config_${name.replaceAll("-", "_")}`;
  return env[key] === "true";
}

function hasFlag(args, name) {
  return args.includes(`--${name}`);
}

function slugify(value) {
  const slug = String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug || "worktree";
}

async function commandOutput(command, args) {
  return await new Promise((resolve) => {
    const child = spawn(command, args, { cwd: repoRoot, stdio: ["ignore", "pipe", "ignore"], windowsHide: true });
    let stdout = "";
    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.once("close", (code) => resolve(code === 0 ? stdout.trim() : ""));
    child.once("error", () => resolve(""));
  });
}

async function pathExists(targetPath) {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function canBindPort(host, port) {
  const server = net.createServer();
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, host, resolve);
    });
    return true;
  } catch {
    return false;
  } finally {
    if (server.listening) {
      await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))).catch(() => undefined);
    }
  }
}

async function allocatePort({ host, rangeStart, rangeEnd, reserved }) {
  for (let port = rangeStart; port <= rangeEnd; port += 1) {
    if (reserved.has(port)) continue;
    if (await canBindPort(host, port)) {
      reserved.add(port);
      return port;
    }
  }
  throw new Error(`No free TCP ports found for ${host} in ${rangeStart}-${rangeEnd}.`);
}

export function resolveWorktreeProofOptions(args = process.argv.slice(2), env = process.env) {
  const branchHint = parseFlag(args, "id") ?? parseNpmConfigValue(env, "id") ?? env.SERVICE_LASSO_WORKTREE_PROOF_ID ?? env.GITHUB_HEAD_REF ?? "";
  const worktreeId = slugify(branchHint || path.basename(process.cwd()));
  const bindHost = parseFlag(args, "host") ?? parseNpmConfigValue(env, "host") ?? env.SERVICE_LASSO_WORKTREE_PROOF_HOST ?? "127.0.0.1";
  const urlHost = parseFlag(args, "url-host") ?? parseNpmConfigValue(env, "url-host") ?? env.SERVICE_LASSO_WORKTREE_PROOF_URL_HOST ?? (bindHost === "0.0.0.0" ? "127.0.0.1" : bindHost);
  const proofRoot = path.resolve(parseFlag(args, "proof-root") ?? parseNpmConfigValue(env, "proof-root") ?? env.SERVICE_LASSO_WORKTREE_PROOF_ROOT ?? path.join(defaultDemoWorkspaceRoot, "worktree-proof", worktreeId));
  const servicesRoot = path.resolve(parseFlag(args, "services-root") ?? parseNpmConfigValue(env, "services-root") ?? env.SERVICE_LASSO_SERVICES_ROOT ?? path.join(proofRoot, "services"));
  const workspaceRoot = path.resolve(parseFlag(args, "workspace-root") ?? parseNpmConfigValue(env, "workspace-root") ?? env.SERVICE_LASSO_WORKSPACE_ROOT ?? path.join(proofRoot, "workspace"));
  const demoLogRoot = path.resolve(parseFlag(args, "demo-log-root") ?? parseNpmConfigValue(env, "demo-log-root") ?? env.SERVICE_LASSO_DEMO_LOG_ROOT ?? path.join(repoRoot, ".demo-logs", "worktree-proof", worktreeId));
  const summaryPath = path.resolve(parseFlag(args, "summary") ?? parseNpmConfigValue(env, "summary") ?? path.join(demoLogRoot, "worktree-proof-summary.json"));

  return {
    action: hasFlag(args, "cleanup") || parseNpmBooleanFlag(env, "cleanup") ? "cleanup" : "prepare",
    worktreeId,
    bindHost,
    urlHost,
    proofRoot,
    servicesRoot,
    workspaceRoot,
    demoLogRoot,
    summaryPath,
    runtimePort: parseNumber(parseFlag(args, "runtime-port") ?? parseFlag(args, "port") ?? parseNpmConfigValue(env, "runtime-port") ?? parseNpmConfigValue(env, "port") ?? env.SERVICE_LASSO_PORT, 0),
    serviceAdminPort: parseNumber(parseFlag(args, "service-admin-port") ?? parseNpmConfigValue(env, "service-admin-port") ?? env.SERVICE_LASSO_WORKTREE_SERVICEADMIN_PORT, 0),
    portRangeStart: parseNumber(parseFlag(args, "port-range-start") ?? parseNpmConfigValue(env, "port-range-start") ?? env.SERVICE_LASSO_WORKTREE_PORT_RANGE_START, defaultPortRangeStart),
    portRangeEnd: parseNumber(parseFlag(args, "port-range-end") ?? parseNpmConfigValue(env, "port-range-end") ?? env.SERVICE_LASSO_WORKTREE_PORT_RANGE_END, defaultPortRangeEnd),
    replace: hasFlag(args, "replace") || parseNpmBooleanFlag(env, "replace") || env.SERVICE_LASSO_WORKTREE_PROOF_REPLACE === "1",
    preserveState: hasFlag(args, "preserve-state") || parseNpmBooleanFlag(env, "preserve-state"),
    json: hasFlag(args, "json") || parseNpmBooleanFlag(env, "json"),
  };
}

export async function allocateWorktreeProofPorts(options) {
  const reserved = new Set();
  const runtimePort = options.runtimePort > 0 ? options.runtimePort : await allocatePort({ host: options.bindHost, rangeStart: options.portRangeStart, rangeEnd: options.portRangeEnd, reserved });
  reserved.add(runtimePort);
  const serviceAdminPort = options.serviceAdminPort > 0 ? options.serviceAdminPort : await allocatePort({ host: options.bindHost, rangeStart: options.portRangeStart, rangeEnd: options.portRangeEnd, reserved });
  reserved.add(serviceAdminPort);

  const manifestPorts = {};
  for (const request of manifestPortRequests) {
    const port = request.serviceId === "@serviceadmin" && request.name === "ui"
      ? serviceAdminPort
      : await allocatePort({ host: options.bindHost, rangeStart: options.portRangeStart, rangeEnd: options.portRangeEnd, reserved });
    manifestPorts[`${request.serviceId}:${request.kind}:${request.name}`] = port;
  }

  return { runtime: runtimePort, serviceAdmin: serviceAdminPort, manifest: manifestPorts };
}

export function patchWorktreeDemoManifest(serviceId, manifest, { runtimeUrl, ports }) {
  const next = structuredClone(manifest);
  for (const [key, port] of Object.entries(ports.manifest ?? {})) {
    const [requestServiceId, kind, name] = key.split(":");
    if (requestServiceId !== serviceId) continue;
    if (kind === "ports" && next.ports && Object.hasOwn(next.ports, name)) next.ports[name] = port;
    if (kind === "endpoint" && Array.isArray(next.endpoints)) {
      const endpoint = next.endpoints.find((entry) => entry.id === name);
      if (endpoint?.port) endpoint.port.default = port;
    }
  }

  if (serviceId === "@serviceadmin") {
    next.env = {
      ...(next.env ?? {}),
      SERVICE_LASSO_API_BASE_URL: runtimeUrl,
      SERVICE_LASSO_RUNTIME_API_BASE_URL: runtimeUrl,
    };
  }
  return next;
}

async function copyDemoServicesRoot(targetRoot, { replace }) {
  if (replace) await rm(targetRoot, { recursive: true, force: true });
  if (await pathExists(path.join(targetRoot, "@serviceadmin", "service.json"))) return;
  await mkdir(path.dirname(targetRoot), { recursive: true });
  await cp(defaultDemoServicesRoot, targetRoot, {
    recursive: true,
    force: true,
    filter: (source) => {
      const relativePath = path.relative(defaultDemoServicesRoot, source);
      if (!relativePath) return true;
      const segments = relativePath.split(path.sep);
      return !segments.some((segment) => segment === ".state" || segment === "logs" || segment === "temp");
    },
  });
}

export async function patchWorktreeDemoServicesRoot({ servicesRoot, runtimeUrl, ports }) {
  for (const serviceId of new Set(manifestPortRequests.map((entry) => entry.serviceId))) {
    const manifestPath = path.join(servicesRoot, serviceId, "service.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    const patched = patchWorktreeDemoManifest(serviceId, manifest, { runtimeUrl, ports });
    await writeFile(manifestPath, `${JSON.stringify(patched, null, 2)}\n`);
  }
}

function quote(value) {
  return `"${String(value).replaceAll('"', '\\"')}"`;
}

export function buildWorktreeProofCommands(options, ports) {
  const runtimeUrl = `http://${options.urlHost}:${ports.runtime}`;
  const serviceAdminUrl = `http://${options.urlHost}:${ports.serviceAdmin}/`;
  return {
    start: `npm run demo:recycle -- --port=${ports.runtime} --host=${options.bindHost} --runtime-url=${runtimeUrl} --admin-url=${serviceAdminUrl} --workspace-root=${quote(options.workspaceRoot)} --services-root=${quote(options.servicesRoot)} --demo-log-root=${quote(options.demoLogRoot)}`,
    gate: `node scripts/demo-gate.mjs --host=${options.bindHost} --runtime-url=${runtimeUrl} --port=${ports.runtime} --admin-url=${serviceAdminUrl} --workspace-root=${quote(options.workspaceRoot)} --services-root=${quote(options.servicesRoot)} --demo-log-root=${quote(options.demoLogRoot)} --json`,
    verify: `node scripts/demo-verify-canonical.mjs --runtime-url=${runtimeUrl} --port=${ports.runtime} --service-admin-url=${serviceAdminUrl} --service-admin-port=${ports.serviceAdmin} --workspace-root=${quote(options.workspaceRoot)} --services-root=${quote(options.servicesRoot)}`,
    cleanup: `node scripts/demo-worktree-proof.mjs --cleanup --summary=${quote(options.summaryPath)}`,
  };
}

export async function prepareWorktreeProof(options = resolveWorktreeProofOptions()) {
  await mkdir(options.demoLogRoot, { recursive: true });
  const ports = await allocateWorktreeProofPorts(options);
  const runtimeUrl = `http://${options.urlHost}:${ports.runtime}`;
  const serviceAdminUrl = `http://${options.urlHost}:${ports.serviceAdmin}/`;

  await copyDemoServicesRoot(options.servicesRoot, { replace: options.replace });
  await patchWorktreeDemoServicesRoot({ servicesRoot: options.servicesRoot, runtimeUrl, ports });

  const [branch, commit] = await Promise.all([
    commandOutput("git", ["branch", "--show-current"]),
    commandOutput("git", ["rev-parse", "HEAD"]),
  ]);
  const summary = {
    schemaVersion: 1,
    preparedAt: new Date().toISOString(),
    mode: "worktree-auto-port",
    owner: { repoRoot, worktreeId: options.worktreeId, branch: branch || null, commit: commit || null, processId: process.pid },
    urls: { runtime: runtimeUrl, serviceAdmin: serviceAdminUrl },
    ports,
    paths: {
      proofRoot: options.proofRoot,
      servicesRoot: options.servicesRoot,
      workspaceRoot: options.workspaceRoot,
      demoLogRoot: options.demoLogRoot,
      summaryPath: options.summaryPath,
    },
    commands: buildWorktreeProofCommands(options, ports),
  };
  await writeFile(options.summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
  return summary;
}

export async function cleanupWorktreeProof(summaryPath, options = {}) {
  const summary = JSON.parse(await readFile(summaryPath, "utf8"));
  const stopped = await stopDemoManagedProcesses({ servicesRoot: summary.paths.servicesRoot, workspaceRoot: summary.paths.workspaceRoot });
  if (options.preserveState !== true) {
    await resetDemoInstance({ servicesRoot: summary.paths.servicesRoot, workspaceRoot: summary.paths.workspaceRoot });
  }
  const cleanup = { cleanedAt: new Date().toISOString(), summaryPath, preserveState: options.preserveState === true, stopped };
  const cleanupPath = path.join(path.dirname(summaryPath), "worktree-proof-cleanup.json");
  await writeFile(cleanupPath, `${JSON.stringify(cleanup, null, 2)}\n`);
  return { ...cleanup, cleanupPath };
}

function printPrepared(summary, json) {
  if (json) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }
  console.log("[service-lasso demo] worktree proof prepared");
  console.log(`- runtime: ${summary.urls.runtime}`);
  console.log(`- serviceAdmin: ${summary.urls.serviceAdmin}`);
  console.log(`- servicesRoot: ${summary.paths.servicesRoot}`);
  console.log(`- workspaceRoot: ${summary.paths.workspaceRoot}`);
  console.log(`- summary: ${summary.paths.summaryPath}`);
  console.log(`- gate: ${summary.commands.gate}`);
  console.log(`- verify: ${summary.commands.verify}`);
  console.log(`- cleanup: ${summary.commands.cleanup}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  try {
    const options = resolveWorktreeProofOptions();
    if (options.action === "cleanup") {
      const summaryPath = parseFlag(process.argv.slice(2), "summary");
      if (!summaryPath) throw new Error("Cleanup requires --summary=<worktree-proof-summary.json>.");
      console.log(JSON.stringify(await cleanupWorktreeProof(path.resolve(summaryPath), options), null, 2));
    } else {
      printPrepared(await prepareWorktreeProof(options), options.json);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
