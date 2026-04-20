import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, readdir, rm, writeFile } from "node:fs/promises";

export async function clearPersistedFixtureState(servicesRoot) {
  const entries = await readdir(servicesRoot, { withFileTypes: true });

  await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => rm(path.join(servicesRoot, entry.name, ".state"), { recursive: true, force: true })),
  );
}

export async function makeTempServicesRoot(prefix = "service-lasso-fixture-") {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), prefix));
  const servicesRoot = path.join(tempRoot, "services");
  await mkdir(servicesRoot, { recursive: true });
  return { tempRoot, servicesRoot };
}

export async function writeManifest(servicesRoot, serviceId, body) {
  const serviceRoot = path.join(servicesRoot, serviceId);
  await mkdir(serviceRoot, { recursive: true });
  await writeFile(path.join(serviceRoot, "service.json"), JSON.stringify(body, null, 2));
  return serviceRoot;
}

export async function writeExecutableFixtureService(
  servicesRoot,
  serviceId,
  options = {},
) {
  const {
    autoExitMs = null,
    exitCode = 0,
    healthcheck = { type: "process" },
  } = options;

  const serviceRoot = path.join(servicesRoot, serviceId);
  const runtimeRoot = path.join(serviceRoot, "runtime");
  await mkdir(runtimeRoot, { recursive: true });

  const scriptPath = path.join(runtimeRoot, "fixture-service.mjs");
  const scriptSource = `
const heartbeat = setInterval(() => {}, 1000);
const exitCode = Number(process.env.FIXTURE_EXIT_CODE ?? "${exitCode}");
const autoExitMs = Number(process.env.FIXTURE_AUTO_EXIT_MS ?? "${autoExitMs ?? ""}");

function shutdown() {
  clearInterval(heartbeat);
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

if (Number.isFinite(autoExitMs) && autoExitMs > 0) {
  setTimeout(() => {
    clearInterval(heartbeat);
    process.exit(exitCode);
  }, autoExitMs);
}
`.trim();

  await writeFile(scriptPath, scriptSource);
  await writeManifest(servicesRoot, serviceId, {
    id: serviceId,
    name: serviceId,
    description: `Executable fixture for ${serviceId}.`,
    executable: process.execPath,
    args: [path.relative(serviceRoot, scriptPath)],
    env: {
      FIXTURE_EXIT_CODE: String(exitCode),
      ...(autoExitMs !== null ? { FIXTURE_AUTO_EXIT_MS: String(autoExitMs) } : {}),
    },
    healthcheck,
  });

  return { serviceRoot, scriptPath };
}
