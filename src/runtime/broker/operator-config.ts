import { randomBytes } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { DiscoveredService } from "../../contracts/service.js";
import { getLifecycleState } from "../lifecycle/store.js";
import { getServiceStatePaths } from "../state/paths.js";
import {
  isUnixSocketPath,
  isWindowsNamedPipePath,
  parseSecretsBrokerOperatorIpc,
  type SecretsBrokerTransportTarget,
} from "./ipc-transport.js";

export const SECRETSBROKER_SERVICE_ID = "@secretsbroker";
export const LAUNCH_LEASE_COMMAND_ENV = "SERVICE_LASSO_SECRETSBROKER_LAUNCH_LEASE_COMMAND";
export const LAUNCH_LEASE_ARGS_ENV = "SERVICE_LASSO_SECRETSBROKER_LAUNCH_LEASE_ARGS_JSON";
export const WORKSPACE_ID_ENV = "SERVICE_LASSO_WORKSPACE_ID";
export const NAMED_PIPE_ENV = "SECRETSBROKER_NAMED_PIPE";
export const UNIX_SOCKET_ENV = "SECRETSBROKER_UNIX_SOCKET";

/** Optional OS IPC metadata stored beside operator credentials. Paths are never logged. */
export interface SecretsBrokerOperatorIpc {
  kind: "loopback-http" | "unix-socket" | "windows-named-pipe";
  socketPath?: string;
}

/** Persisted operator credentials and paths for the local Secrets Broker daemon. */
export interface SecretsBrokerOperatorConfig {
  version: 1;
  storePath: string;
  auditPath: string;
  masterKeyFile: string;
  apiToken: string;
  initializedAt: string;
  ipc?: SecretsBrokerOperatorIpc;
}

/** Resolved on-disk paths for broker bootstrap state under a service root. */
export interface SecretsBrokerDataPaths {
  storePath: string;
  auditPath: string;
  masterKeyFile: string;
  brokerStateDir: string;
  operatorConfigPath: string;
}

/**
 * Resolve canonical broker data paths for a managed `@secretsbroker` service root.
 */
export function resolveSecretsBrokerDataPaths(serviceRoot: string): SecretsBrokerDataPaths {
  const statePaths = getServiceStatePaths(serviceRoot);
  const brokerStateDir = path.join(statePaths.stateRoot, "broker");

  return {
    storePath: path.join(serviceRoot, "data", "store.json"),
    auditPath: path.join(serviceRoot, "data", "audit.jsonl"),
    masterKeyFile: path.join(brokerStateDir, "master-key"),
    brokerStateDir,
    operatorConfigPath: path.join(brokerStateDir, "operator.json"),
  };
}

/**
 * Resolve the loopback port for a running or configured Secrets Broker service.
 */
export function resolveSecretsBrokerPort(
  service: DiscoveredService,
): number | null {
  const lifecycle = getLifecycleState(service.manifest.id);
  const manifestPort = service.manifest.ports?.service;
  if (
    !lifecycle.running &&
    typeof manifestPort === "number" &&
    Number.isInteger(manifestPort) &&
    manifestPort > 0
  ) {
    return manifestPort;
  }

  const runtimePort = lifecycle.runtime.ports.service;
  if (typeof runtimePort === "number" && Number.isInteger(runtimePort) && runtimePort > 0) {
    return runtimePort;
  }

  if (typeof manifestPort === "number" && Number.isInteger(manifestPort) && manifestPort > 0) {
    return manifestPort;
  }

  return null;
}

/**
 * True when the value is a non-array object record.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Prefer configured named-pipe or Unix-socket HTTP, then operator.json ipc, then loopback TCP.
 * Default Broker launch stays loopback HTTP so the live demo health URLs keep working.
 */
export function resolveSecretsBrokerTransport(
  service: DiscoveredService,
  env: NodeJS.ProcessEnv = process.env,
  operatorConfig: SecretsBrokerOperatorConfig | null = null,
): SecretsBrokerTransportTarget | null {
  const namedPipe = env[NAMED_PIPE_ENV]?.trim() ?? "";
  if (namedPipe.length > 0 && isWindowsNamedPipePath(namedPipe)) {
    return { kind: "windows-named-pipe", socketPath: namedPipe };
  }

  const unixSocket = env[UNIX_SOCKET_ENV]?.trim() ?? "";
  if (unixSocket.length > 0 && isUnixSocketPath(unixSocket)) {
    return { kind: "unix-socket", socketPath: unixSocket };
  }

  const ipc = operatorConfig?.ipc;
  if (ipc?.kind === "windows-named-pipe" && ipc.socketPath && isWindowsNamedPipePath(ipc.socketPath)) {
    return { kind: "windows-named-pipe", socketPath: ipc.socketPath };
  }
  if (ipc?.kind === "unix-socket" && ipc.socketPath && isUnixSocketPath(ipc.socketPath)) {
    return { kind: "unix-socket", socketPath: ipc.socketPath };
  }

  const port = resolveSecretsBrokerPort(service);
  if (port !== null) {
    return { kind: "loopback-http", port };
  }
  return null;
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Read persisted operator config when present and structurally valid.
 */
export async function readSecretsBrokerOperatorConfig(
  serviceRoot: string,
): Promise<SecretsBrokerOperatorConfig | null> {
  const { operatorConfigPath } = resolveSecretsBrokerDataPaths(serviceRoot);
  if (!(await pathExists(operatorConfigPath))) {
    return null;
  }

  const raw = await readFile(operatorConfigPath, "utf8");
  let parsedUnknown: unknown;
  try {
    parsedUnknown = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(parsedUnknown)) {
    return null;
  }

  const version = parsedUnknown.version;
  const apiToken = parsedUnknown.apiToken;
  const storePath = parsedUnknown.storePath;
  const auditPath = parsedUnknown.auditPath;
  const masterKeyFile = parsedUnknown.masterKeyFile;
  const initializedAt = parsedUnknown.initializedAt;
  if (
    version !== 1 ||
    typeof apiToken !== "string" ||
    apiToken.trim().length === 0 ||
    typeof storePath !== "string" ||
    typeof auditPath !== "string" ||
    typeof masterKeyFile !== "string"
  ) {
    return null;
  }

  const ipc = parseSecretsBrokerOperatorIpc(parsedUnknown.ipc);
  return {
    version: 1,
    storePath,
    auditPath,
    masterKeyFile,
    apiToken,
    initializedAt: typeof initializedAt === "string" ? initializedAt : "",
    ...(ipc ? { ipc } : {}),
  };
}

/**
 * Persist operator config with restrictive file permissions.
 */
export async function writeSecretsBrokerOperatorConfig(
  serviceRoot: string,
  config: SecretsBrokerOperatorConfig,
): Promise<void> {
  const { brokerStateDir, operatorConfigPath } = resolveSecretsBrokerDataPaths(serviceRoot);
  await mkdir(brokerStateDir, { recursive: true });
  await writeFile(operatorConfigPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
}

/**
 * Build process env overrides for a ready, authenticated local broker daemon.
 */
export function buildSecretsBrokerRuntimeEnv(
  config: SecretsBrokerOperatorConfig,
  paths: SecretsBrokerDataPaths,
): Record<string, string> {
  return {
    SECRETSBROKER_STATE: "ready",
    SECRETSBROKER_MASTER_KEY_FILE: paths.masterKeyFile,
    SECRETSBROKER_API_TOKEN: config.apiToken,
    SECRETSBROKER_STORE_PATH: paths.storePath,
    SECRETSBROKER_AUDIT_PATH: paths.auditPath,
    SECRETSBROKER_LAUNCH_IDENTITY_SIGNING_KEY: config.apiToken,
  };
}

/** Generate a high-entropy credential suitable for broker master keys or API tokens. */
export function generateSecretsBrokerCredential(): string {
  return randomBytes(32).toString("base64url");
}

export interface SecretsBrokerCliCommand {
  command: string;
  cwd: string;
  args: string[];
}

/**
 * Resolve the installed Secrets Broker CLI from lifecycle install artifacts.
 * Serve-only artifact args are omitted so backup/admin subcommands can run.
 */
export function resolveSecretsBrokerCli(service: DiscoveredService): SecretsBrokerCliCommand | null {
  if (service.manifest.id !== SECRETSBROKER_SERVICE_ID) {
    return null;
  }

  const artifact = getLifecycleState(service.manifest.id).installArtifacts.artifact;
  if (!artifact?.command || !artifact.extractedPath) {
    return null;
  }

  const normalizedCommand = artifact.command.replace(/^\.\\/, "").replace(/^\.\//, "");
  return {
    command: path.resolve(artifact.extractedPath, normalizedCommand),
    cwd: artifact.extractedPath,
    args: (artifact.args ?? []).filter((value) => value !== "serve"),
  };
}

/**
 * Fill operator-owned broker env only when the host process has not already set the key.
 */
export function mergeSecretsBrokerOperatorEnv(
  operatorEnv: Record<string, string>,
  hostEnv: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const merged: NodeJS.ProcessEnv = { ...hostEnv };
  for (const [key, value] of Object.entries(operatorEnv)) {
    if (!merged[key] || merged[key]?.trim() === "") {
      merged[key] = value;
    }
  }
  return merged;
}
