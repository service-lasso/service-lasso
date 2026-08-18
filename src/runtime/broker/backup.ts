import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { DiscoveredService } from "../../contracts/service.js";
import { ApiError } from "../../server/errors.js";
import {
  buildSecretsBrokerRuntimeEnv,
  mergeSecretsBrokerOperatorEnv,
  readSecretsBrokerOperatorConfig,
  resolveSecretsBrokerCli,
  resolveSecretsBrokerDataPaths,
  SECRETSBROKER_SERVICE_ID,
} from "./operator-config.js";

const execFileAsync = promisify(execFile);

export interface SecretsBrokerBackupResult {
  action: "backup" | "restore";
  ok: true;
  serviceId: typeof SECRETSBROKER_SERVICE_ID;
  archivePath: string;
  storePath: string;
}

function requireBrokerService(service: DiscoveredService): void {
  if (service.manifest.id !== SECRETSBROKER_SERVICE_ID) {
    throw new ApiError(
      "unsupported_service",
      404,
      `Broker backup is not available for "${service.manifest.id}".`,
    );
  }
}

function defaultBackupPath(serviceRoot: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return path.join(serviceRoot, ".state", "backups", `secretsbroker-backup-${stamp}.json`);
}

async function runBrokerBackupCommand(
  service: DiscoveredService,
  args: string[],
): Promise<void> {
  const cli = resolveSecretsBrokerCli(service);
  const operatorConfig = await readSecretsBrokerOperatorConfig(service.serviceRoot);
  if (!cli || !operatorConfig) {
    throw new ApiError(
      "broker_unavailable",
      503,
      "Secrets Broker CLI and operator config are required before backup or restore.",
    );
  }

  const paths = resolveSecretsBrokerDataPaths(service.serviceRoot);
  const env = mergeSecretsBrokerOperatorEnv(buildSecretsBrokerRuntimeEnv(operatorConfig, paths));
  try {
    await execFileAsync(cli.command, [...cli.args, ...args], {
      cwd: cli.cwd,
      env,
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Broker backup command failed.";
    throw new ApiError("broker_backup_failed", 500, message);
  }
}

/**
 * Create an encrypted local-store backup through the installed Secrets Broker CLI.
 */
export async function createSecretsBrokerBackup(
  service: DiscoveredService,
  options: { outputPath?: string } = {},
): Promise<SecretsBrokerBackupResult> {
  requireBrokerService(service);
  const paths = resolveSecretsBrokerDataPaths(service.serviceRoot);
  const archivePath = path.resolve(options.outputPath?.trim() || defaultBackupPath(service.serviceRoot));
  await mkdir(path.dirname(archivePath), { recursive: true });
  await runBrokerBackupCommand(service, [
    "backup",
    "create",
    "--store",
    paths.storePath,
    "--audit",
    paths.auditPath,
    "--master-key-file",
    paths.masterKeyFile,
    "--out",
    archivePath,
  ]);

  return {
    action: "backup",
    ok: true,
    serviceId: SECRETSBROKER_SERVICE_ID,
    archivePath,
    storePath: paths.storePath,
  };
}

/**
 * Restore an encrypted local-store backup through the installed Secrets Broker CLI.
 */
export async function restoreSecretsBrokerBackup(
  service: DiscoveredService,
  archivePath: string,
): Promise<SecretsBrokerBackupResult> {
  requireBrokerService(service);
  const trimmed = archivePath.trim();
  if (!trimmed) {
    throw new ApiError("invalid_request", 400, "Broker restore requires an archive path.");
  }

  const paths = resolveSecretsBrokerDataPaths(service.serviceRoot);
  const resolvedArchive = path.resolve(trimmed);
  await runBrokerBackupCommand(service, [
    "backup",
    "restore",
    "--store",
    paths.storePath,
    "--audit",
    paths.auditPath,
    "--master-key-file",
    paths.masterKeyFile,
    "--in",
    resolvedArchive,
  ]);

  return {
    action: "restore",
    ok: true,
    serviceId: SECRETSBROKER_SERVICE_ID,
    archivePath: resolvedArchive,
    storePath: paths.storePath,
  };
}
