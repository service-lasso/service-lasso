import { execFile } from "node:child_process";
import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { DiscoveredService } from "../../contracts/service.js";
import { getLifecycleState } from "../lifecycle/store.js";
import {
  buildSecretsBrokerRuntimeEnv,
  generateSecretsBrokerCredential,
  readSecretsBrokerOperatorConfig,
  resolveSecretsBrokerDataPaths,
  SECRETSBROKER_SERVICE_ID,
  writeSecretsBrokerOperatorConfig,
  type SecretsBrokerOperatorConfig,
} from "./operator-config.js";

const execFileAsync = promisify(execFile);

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function resolveBrokerExecutable(service: DiscoveredService): { command: string; cwd: string } {
  const artifact = getLifecycleState(service.manifest.id).installArtifacts.artifact;
  if (!artifact?.extractedPath || !artifact.command) {
    throw new Error(`Cannot bootstrap ${service.manifest.id} before install artifacts are available.`);
  }

  const normalizedCommand = artifact.command.replace(/^\.\\/, "").replace(/^\.\//, "");
  return {
    command: path.resolve(artifact.extractedPath, normalizedCommand),
    cwd: artifact.extractedPath,
  };
}

/**
 * Ensure the local encrypted store, master key, and API token exist for `@secretsbroker`.
 * Safe to call repeatedly; initialization runs only while the store file is missing.
 */
export async function ensureSecretsBrokerBootstrap(
  service: DiscoveredService,
): Promise<SecretsBrokerOperatorConfig> {
  if (service.manifest.id !== SECRETSBROKER_SERVICE_ID) {
    throw new Error(`Secrets Broker bootstrap is only supported for ${SECRETSBROKER_SERVICE_ID}.`);
  }

  const paths = resolveSecretsBrokerDataPaths(service.serviceRoot);
  const existing = await readSecretsBrokerOperatorConfig(service.serviceRoot);
  if (existing && (await pathExists(paths.storePath))) {
    return existing;
  }

  await mkdir(paths.brokerStateDir, { recursive: true });
  await mkdir(path.dirname(paths.storePath), { recursive: true });

  const masterKey = generateSecretsBrokerCredential();
  const apiToken = generateSecretsBrokerCredential();
  await writeFile(paths.masterKeyFile, `${masterKey}\n`, { mode: 0o600 });

  const { command, cwd } = resolveBrokerExecutable(service);
  await execFileAsync(
    command,
    [
      "key",
      "initialize",
      "--master-key-file",
      paths.masterKeyFile,
      "--store",
      paths.storePath,
      "--audit",
      paths.auditPath,
    ],
    {
      cwd,
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    },
  );

  const config: SecretsBrokerOperatorConfig = {
    version: 1,
    storePath: paths.storePath,
    auditPath: paths.auditPath,
    masterKeyFile: paths.masterKeyFile,
    apiToken,
    initializedAt: new Date().toISOString(),
  };
  await writeSecretsBrokerOperatorConfig(service.serviceRoot, config);
  return config;
}

/**
 * Resolve launch env for `@secretsbroker`, bootstrapping first-run state when needed.
 */
export async function resolveSecretsBrokerLaunchEnv(
  service: DiscoveredService,
): Promise<Record<string, string>> {
  const config = await ensureSecretsBrokerBootstrap(service);
  const paths = resolveSecretsBrokerDataPaths(service.serviceRoot);
  return buildSecretsBrokerRuntimeEnv(config, paths);
}
