import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, readdir, rm, writeFile } from "node:fs/promises";

async function removeDirectoryWithRetry(targetPath, attempts = 5) {
  for (let index = 0; index < attempts; index += 1) {
    try {
      await rm(targetPath, { recursive: true, force: true });
      return;
    } catch (error) {
      if (!error || typeof error !== "object" || !("code" in error)) {
        throw error;
      }

      if ((error.code !== "EPERM" && error.code !== "EBUSY") || index === attempts - 1) {
        throw error;
      }

      await new Promise((resolve) => setTimeout(resolve, 50 * (index + 1)));
    }
  }
}

export async function clearPersistedFixtureState(servicesRoot) {
  const entries = await readdir(servicesRoot, { withFileTypes: true });

  await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .flatMap((entry) => [
        removeDirectoryWithRetry(path.join(servicesRoot, entry.name, ".state")),
        removeDirectoryWithRetry(path.join(servicesRoot, entry.name, "logs")),
      ]),
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
    readyFileAfterMs = null,
    readyFileRelativePath = "./runtime/ready.txt",
    captureEnvKeys = [],
    captureEnvFileRelativePath = "./runtime/env.json",
    stdoutLines = [],
    stderrLines = [],
    env = {},
    globalenv = {},
    autostart = undefined,
    monitoring = undefined,
    restartPolicy = undefined,
    doctor = undefined,
    ports = undefined,
    depend_on = undefined,
    urls = undefined,
    install = undefined,
    config = undefined,
    setup = undefined,
    role = undefined,
    enabled = undefined,
    broker = undefined,
  } = options;

  const serviceRoot = path.join(servicesRoot, serviceId);
  const runtimeRoot = path.join(serviceRoot, "runtime");
  await mkdir(runtimeRoot, { recursive: true });

  const scriptPath = path.join(runtimeRoot, "fixture-service.mjs");
  const scriptSource = `
import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";

const heartbeat = setInterval(() => {}, 1000);
const exitCode = Number(process.env.FIXTURE_EXIT_CODE ?? "${exitCode}");
const autoExitMs = Number(process.env.FIXTURE_AUTO_EXIT_MS ?? "${autoExitMs ?? ""}");
const readyFileRelativePath = process.env.FIXTURE_READY_FILE ?? "";
const readyFileDelayMs = Number(process.env.FIXTURE_READY_FILE_DELAY_MS ?? "");
const captureEnvPath = process.env.FIXTURE_CAPTURE_ENV_FILE ?? "";
const captureEnvKeys = process.env.FIXTURE_CAPTURE_ENV_KEYS
  ? JSON.parse(process.env.FIXTURE_CAPTURE_ENV_KEYS)
  : [];
const stdoutLines = process.env.FIXTURE_STDOUT_LINES
  ? JSON.parse(process.env.FIXTURE_STDOUT_LINES)
  : [];
const stderrLines = process.env.FIXTURE_STDERR_LINES
  ? JSON.parse(process.env.FIXTURE_STDERR_LINES)
  : [];

function shutdown() {
  clearInterval(heartbeat);
  process.exit(0);
}

async function writeReadyFile() {
  const targetPath = path.resolve(process.cwd(), readyFileRelativePath);
  await mkdir(path.dirname(targetPath), { recursive: true });
  await writeFile(targetPath, "ready");
}

async function writeEnvSnapshot() {
  const targetPath = path.resolve(process.cwd(), captureEnvPath);
  await mkdir(path.dirname(targetPath), { recursive: true });
  const payload = Object.fromEntries(captureEnvKeys.map((key) => [key, process.env[key] ?? null]));
  await writeFile(targetPath, JSON.stringify(payload, null, 2));
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

if (captureEnvPath && Array.isArray(captureEnvKeys) && captureEnvKeys.length > 0) {
  void writeEnvSnapshot();
}

for (const line of stdoutLines) {
  console.log(String(line));
}

for (const line of stderrLines) {
  console.error(String(line));
}

if (readyFileRelativePath && Number.isFinite(readyFileDelayMs) && readyFileDelayMs >= 0) {
  setTimeout(() => {
    void writeReadyFile();
  }, readyFileDelayMs);
}

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
    role,
    enabled,
    executable: process.execPath,
    args: [path.relative(serviceRoot, scriptPath)],
    env: {
      FIXTURE_EXIT_CODE: String(exitCode),
      ...env,
      ...(autoExitMs !== null ? { FIXTURE_AUTO_EXIT_MS: String(autoExitMs) } : {}),
      ...(readyFileAfterMs !== null
        ? {
            FIXTURE_READY_FILE: readyFileRelativePath,
            FIXTURE_READY_FILE_DELAY_MS: String(readyFileAfterMs),
          }
        : {}),
      ...(captureEnvKeys.length > 0
        ? {
            FIXTURE_CAPTURE_ENV_FILE: captureEnvFileRelativePath,
            FIXTURE_CAPTURE_ENV_KEYS: JSON.stringify(captureEnvKeys),
          }
        : {}),
      ...(stdoutLines.length > 0
        ? {
            FIXTURE_STDOUT_LINES: JSON.stringify(stdoutLines),
          }
        : {}),
      ...(stderrLines.length > 0
        ? {
            FIXTURE_STDERR_LINES: JSON.stringify(stderrLines),
          }
        : {}),
    },
    globalenv,
    autostart,
    monitoring,
    restartPolicy,
    doctor,
    ports,
    depend_on,
    urls,
    install,
    config,
    setup,
    broker,
    healthcheck: healthcheck === null ? undefined : healthcheck,
  });

  return { serviceRoot, scriptPath };
}
