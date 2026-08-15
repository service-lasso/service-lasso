import { createHash, randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import { lstat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import type { ServiceRegistry } from "../manager/ServiceRegistry.js";
import { getLifecycleState } from "../lifecycle/store.js";
import { readPrivateJson, resolveCurrentWindowsSid, writePrivateJson } from "../security/private-json.js";
import { BROKER_IDENTITY_LEASE_ENV, issueScopedBrokerIdentity } from "./identity.js";
import { compileServiceStartupBrokerPlan } from "./launch-resolution.js";
import {
  createSecretsBrokerLaunchLookup,
  createSecretsBrokerWriteback,
  probeSecretsBroker,
  requestSecretsBrokerManagement,
  type SecretsBrokerClientTransport,
  type SecretsBrokerManagementRequest,
  type SecretsBrokerManagementResponse,
  type SecretsBrokerProbeResult,
  type SecretsBrokerWritebackRequest,
  type SecretsBrokerWritebackResult,
} from "./client.js";
import type { BrokerTransportBinding, SecretsBrokerLaunchLeaseIssuer } from "./identity.js";
import type { BrokerLaunchLookup } from "./launch-resolution.js";

const execFileAsync = promisify(execFile);
const CREDENTIALS_VERSION = 1;
const BROKER_SERVICE_ID = "@secretsbroker";
const TOKEN_BYTES = 32;
const MAX_COMMAND_OUTPUT_BYTES = 1024 * 1024;
// Darwin's sockaddr_un.sun_path is 104 bytes (including the terminator), while
// Linux allows 108. Keep generated paths below the stricter portable bound.
const MAX_PORTABLE_UNIX_SOCKET_PATH_BYTES = 100;

interface SecretsBrokerRuntimeCredentials {
  version: 1;
  workspaceId: string;
  createdAt: string;
  apiToken: string;
  launchSigningKey: string;
  masterKey: string;
  transport: SecretsBrokerClientTransport;
  transportBinding: BrokerTransportBinding | null;
  storePath: string;
  auditPath: string;
  eventsPath: string;
  wrapperPath: string;
}

export interface SecretsBrokerRuntimeContext {
  lookup: BrokerLaunchLookup;
  probe: () => Promise<SecretsBrokerProbeResult>;
  writeback: (input: SecretsBrokerWritebackRequest) => Promise<SecretsBrokerWritebackResult>;
  management: (input: SecretsBrokerManagementRequest) => Promise<SecretsBrokerManagementResponse>;
  serverEnv: Record<string, string>;
  launchLeaseIssuer?: SecretsBrokerLaunchLeaseIssuer;
  transportBinding: BrokerTransportBinding | null;
}

export interface SecretsBrokerBootstrapResult {
  ok: true;
  state: "setup_complete";
  workspaceId: string;
  keyId: string;
  keyVersion: string;
  transportKind: SecretsBrokerClientTransport["kind"];
}

export interface SecretsBrokerProvisioningResult {
  serviceId: string;
  ref: string;
  status: "existing" | "created";
}

interface BrokerKeyStatus {
  available?: unknown;
  keyId?: unknown;
  keyVersion?: unknown;
  state?: unknown;
  source?: unknown;
  wrapper?: {
    keyId?: unknown;
    keyVersion?: unknown;
  };
}

export interface SecretsBrokerBootstrapOptions {
  brokerCommand?: { command: string; cwd: string };
  runCommand?: (
    command: string,
    cwd: string,
    args: string[],
    environment: Record<string, string>,
  ) => Promise<string>;
}

function privateStateRoot(workspaceRoot: string): string {
  return path.join(path.resolve(workspaceRoot), ".service-lasso");
}

export function secretsBrokerCredentialsPath(workspaceRoot: string): string {
  return path.join(privateStateRoot(workspaceRoot), "secretsbroker", "runtime-credentials.json");
}

function workspaceIdFor(workspaceRoot: string): string {
  return `slw_${createHash("sha256").update(path.resolve(workspaceRoot).toLowerCase()).digest("hex").slice(0, 24)}`;
}

function randomSecret(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

export function secretsBrokerUnixSocketPath(workspaceId: string, tempRoot = os.tmpdir()): string {
  const fileName = `service-lasso-secretsbroker-${workspaceId}.sock`;
  const candidate = path.join(tempRoot, fileName);
  if (Buffer.byteLength(candidate, "utf8") <= MAX_PORTABLE_UNIX_SOCKET_PATH_BYTES) {
    return candidate;
  }
  return path.posix.join("/tmp", `service-lasso-sb-${workspaceId}.sock`);
}

function runtimePaths(workspaceRoot: string, workspaceId: string) {
  const root = path.join(privateStateRoot(workspaceRoot), "secretsbroker");
  const transport: SecretsBrokerClientTransport = process.platform === "win32"
    ? { kind: "windows-named-pipe", socketPath: `\\\\.\\pipe\\service-lasso-secretsbroker-${workspaceId}` }
    : { kind: "unix-socket", socketPath: secretsBrokerUnixSocketPath(workspaceId) };
  return {
    root,
    storePath: path.join(root, "store.json"),
    auditPath: path.join(root, "audit.jsonl"),
    eventsPath: path.join(root, "events.jsonl"),
    wrapperPath: path.join(root, "master-key-wrapper.json"),
    transport,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validateCredentials(value: unknown, workspaceRoot: string): SecretsBrokerRuntimeCredentials {
  if (!isRecord(value) || value.version !== CREDENTIALS_VERSION || typeof value.workspaceId !== "string" ||
    typeof value.createdAt !== "string" || typeof value.apiToken !== "string" || typeof value.launchSigningKey !== "string" ||
    typeof value.masterKey !== "string" || !isRecord(value.transport) || typeof value.transport.kind !== "string" ||
    typeof value.storePath !== "string" || typeof value.auditPath !== "string" || typeof value.eventsPath !== "string" ||
    typeof value.wrapperPath !== "string") {
    throw new Error("Secrets Broker private runtime credentials are invalid.");
  }
  const expectedWorkspaceId = workspaceIdFor(workspaceRoot);
  const expected = runtimePaths(workspaceRoot, expectedWorkspaceId);
  const transport = value.transport as unknown as SecretsBrokerClientTransport;
  const expectedTransport = expected.transport;
  const transportAgrees =
    (transport.kind === "windows-named-pipe" || transport.kind === "unix-socket") &&
    transport.kind === expectedTransport.kind &&
    transport.socketPath === expectedTransport.socketPath;
  if (value.workspaceId !== expectedWorkspaceId || value.apiToken.length < 32 || value.launchSigningKey.length < 32 || value.masterKey.length < 32 ||
    path.resolve(value.storePath) !== path.resolve(expected.storePath) || path.resolve(value.auditPath) !== path.resolve(expected.auditPath) ||
    path.resolve(value.eventsPath) !== path.resolve(expected.eventsPath) || path.resolve(value.wrapperPath) !== path.resolve(expected.wrapperPath) ||
    !transportAgrees) {
    throw new Error("Secrets Broker private runtime credentials do not match this workspace.");
  }
  const transportBinding = value.transportBinding;
  if (transportBinding !== null && (!isRecord(transportBinding) || typeof transportBinding.kind !== "string" || typeof transportBinding.subject !== "string")) {
    throw new Error("Secrets Broker transport identity is invalid.");
  }
  return value as unknown as SecretsBrokerRuntimeCredentials;
}

async function createCredentials(workspaceRoot: string): Promise<SecretsBrokerRuntimeCredentials> {
  const workspaceId = workspaceIdFor(workspaceRoot);
  const paths = runtimePaths(workspaceRoot, workspaceId);
  const windowsSid = await resolveCurrentWindowsSid();
  const transportBinding: BrokerTransportBinding | null = process.platform === "win32"
    ? { kind: "windows-sid", subject: windowsSid! }
    : typeof process.getuid === "function"
      ? { kind: "unix-uid", subject: String(process.getuid()) }
      : null;
  const credentials: SecretsBrokerRuntimeCredentials = {
    version: CREDENTIALS_VERSION,
    workspaceId,
    createdAt: new Date().toISOString(),
    apiToken: randomSecret(),
    launchSigningKey: randomSecret(),
    masterKey: randomSecret(),
    transport: paths.transport,
    transportBinding,
    storePath: paths.storePath,
    auditPath: paths.auditPath,
    eventsPath: paths.eventsPath,
    wrapperPath: paths.wrapperPath,
  };
  await writePrivateJson(privateStateRoot(workspaceRoot), secretsBrokerCredentialsPath(workspaceRoot), credentials);
  return credentials;
}

export async function readSecretsBrokerRuntimeCredentials(workspaceRoot: string): Promise<SecretsBrokerRuntimeCredentials | null> {
  const value = await readPrivateJson(privateStateRoot(workspaceRoot), secretsBrokerCredentialsPath(workspaceRoot));
  return value === null ? null : validateCredentials(value, workspaceRoot);
}

async function resolveBrokerCommand(registry: ServiceRegistry): Promise<{ command: string; cwd: string } | null> {
  const service = registry.getById(BROKER_SERVICE_ID);
  const artifact = getLifecycleState(BROKER_SERVICE_ID).installArtifacts.artifact;
  if (!service || !artifact?.command || !artifact.extractedPath) {
    return null;
  }
  const root = path.resolve(artifact.extractedPath);
  const command = path.isAbsolute(artifact.command) ? artifact.command : path.resolve(root, artifact.command);
  const relative = path.relative(root, command);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Secrets Broker executable escapes its installed artifact.");
  }
  const info = await lstat(command);
  if (!info.isFile() || info.isSymbolicLink()) {
    throw new Error("Secrets Broker executable is redirected or unavailable.");
  }
  return { command, cwd: root };
}

async function requireBrokerCommand(registry: ServiceRegistry): Promise<{ command: string; cwd: string }> {
  const command = await resolveBrokerCommand(registry);
  if (!command) {
    throw new Error("Secrets Broker must be installed before vault bootstrap.");
  }
  return command;
}

async function runBrokerCommand(
  command: string,
  cwd: string,
  args: string[],
  environment: Record<string, string>,
): Promise<string> {
  try {
    const { stdout } = await execFileAsync(command, args, {
      cwd,
      env: { ...process.env, ...environment },
      windowsHide: true,
      timeout: 30_000,
      maxBuffer: MAX_COMMAND_OUTPUT_BYTES,
    });
    return stdout;
  } catch {
    throw new Error("Secrets Broker bootstrap command failed.");
  }
}

function brokerBaseEnvironment(credentials: SecretsBrokerRuntimeCredentials): Record<string, string> {
  return {
    SECRETSBROKER_MODE: "production",
    SECRETSBROKER_TRANSPORT: "auto",
    SECRETSBROKER_STORE_PATH: credentials.storePath,
    SECRETSBROKER_AUDIT_PATH: credentials.auditPath,
    SECRETSBROKER_EVENTS_PATH: credentials.eventsPath,
    SECRETSBROKER_WRAPPER_PATH: credentials.wrapperPath,
    SECRETSBROKER_API_TOKEN: credentials.apiToken,
    SECRETSBROKER_LAUNCH_IDENTITY_SIGNING_KEY: credentials.launchSigningKey,
    SECRETSBROKER_AUDIT_HASH_CHAIN: "1",
    SECRETSBROKER_STATE: "ready",
    ...(credentials.transport.kind === "windows-named-pipe"
      ? { SECRETSBROKER_NAMED_PIPE: credentials.transport.socketPath }
      : credentials.transport.kind === "unix-socket"
        ? { SECRETSBROKER_UNIX_SOCKET: credentials.transport.socketPath }
        : {}),
  };
}

export async function bootstrapSecretsBrokerVault(
  workspaceRoot: string,
  registry: ServiceRegistry,
  options: SecretsBrokerBootstrapOptions = {},
): Promise<SecretsBrokerBootstrapResult> {
  const { command, cwd } = options.brokerCommand ?? await requireBrokerCommand(registry);
  const execute = options.runCommand ?? runBrokerCommand;
  const credentials = await readSecretsBrokerRuntimeCredentials(workspaceRoot) ?? await createCredentials(workspaceRoot);
  const masterKeyEnvironment = {
    ...brokerBaseEnvironment(credentials),
    SECRETSBROKER_MASTER_KEY: credentials.masterKey,
  };
  let storeExists = false;
  try {
    const info = await lstat(credentials.storePath);
    storeExists = info.isFile() && !info.isSymbolicLink();
  } catch {
    storeExists = false;
  }
  if (!storeExists) {
    await execute(command, cwd, ["key", "initialize", "--store", credentials.storePath, "--audit", credentials.auditPath], masterKeyEnvironment);
  }
  if (process.platform === "win32") {
    await execute(command, cwd, ["key", "import", "--store", credentials.storePath, "--audit", credentials.auditPath, "--wrapper", credentials.wrapperPath], masterKeyEnvironment);
  }
  const statusEnvironment = process.platform === "win32"
    ? brokerBaseEnvironment(credentials)
    : masterKeyEnvironment;
  const statusText = await execute(
    command,
    cwd,
    process.platform === "win32"
      ? ["key", "wrapper-status", "--wrapper", credentials.wrapperPath]
      : ["key", "status"],
    statusEnvironment,
  );
  let status: BrokerKeyStatus;
  try {
    status = JSON.parse(statusText) as BrokerKeyStatus;
  } catch {
    throw new Error("Secrets Broker key status contract is invalid.");
  }
  const keyId = status.keyId ?? status.wrapper?.keyId;
  const keyVersion = status.keyVersion ?? status.wrapper?.keyVersion;
  const available = status.available ?? (status.state === "ready");
  if (available !== true || status.state !== "ready" || typeof keyId !== "string" || typeof keyVersion !== "string") {
    throw new Error("Secrets Broker vault did not become ready.");
  }
  return {
    ok: true,
    state: "setup_complete",
    workspaceId: credentials.workspaceId,
    keyId,
    keyVersion,
    transportKind: credentials.transport.kind,
  };
}

export async function loadSecretsBrokerRuntimeContext(
  workspaceRoot: string,
  registry: ServiceRegistry,
): Promise<SecretsBrokerRuntimeContext | null> {
  const credentials = await readSecretsBrokerRuntimeCredentials(workspaceRoot);
  if (!credentials) return null;
  const brokerCommand = await resolveBrokerCommand(registry);
  const serverEnv = brokerBaseEnvironment(credentials);
  if (process.platform !== "win32") serverEnv.SECRETSBROKER_MASTER_KEY = credentials.masterKey;
  const launchLeaseIssuer: SecretsBrokerLaunchLeaseIssuer | undefined = brokerCommand
    ? {
        command: {
          command: brokerCommand.command,
          cwd: brokerCommand.cwd,
          env: {
            SECRETSBROKER_LAUNCH_IDENTITY_SIGNING_KEY: credentials.launchSigningKey,
          },
        },
        workspaceId: credentials.workspaceId,
      }
    : undefined;
  const clientOptions = {
    transport: credentials.transport,
    apiToken: credentials.apiToken,
    workspaceId: credentials.workspaceId,
  };
  return {
    lookup: createSecretsBrokerLaunchLookup(clientOptions),
    probe: async () => await probeSecretsBroker(clientOptions),
    writeback: createSecretsBrokerWriteback(clientOptions),
    management: async (input) => await requestSecretsBrokerManagement(clientOptions, input),
    serverEnv,
    launchLeaseIssuer,
    transportBinding: credentials.transportBinding,
  };
}

function parseLease(environment: Record<string, string> | undefined): unknown | null {
  const raw = environment?.[BROKER_IDENTITY_LEASE_ENV];
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as unknown;
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

export async function provisionFirstRunGeneratedSecrets(
  registry: ServiceRegistry,
  context: SecretsBrokerRuntimeContext,
): Promise<SecretsBrokerProvisioningResult[]> {
  const results: SecretsBrokerProvisioningResult[] = [];
  for (const service of registry.list()) {
    const plan = compileServiceStartupBrokerPlan(service);
    for (const generated of plan.writeback.generatedSecrets) {
      if (!generated.namespace) {
        throw new Error(`Generated secret metadata is incomplete for service "${service.manifest.id}".`);
      }
      const fullRef = `${generated.namespace.replace(/\/+$/u, "")}/${generated.ref.replace(/^\/+|\/+$/gu, "")}`;
      const resolutionIdentity = await issueScopedBrokerIdentity(service, {
        launchLeaseIssuer: context.launchLeaseIssuer,
        transportBinding: context.transportBinding,
      });
      const resolutionLease = parseLease(resolutionIdentity?.env);
      if (!resolutionLease) {
        throw new Error(`Secrets Broker did not issue a provisioning lookup lease for service "${service.manifest.id}".`);
      }
      const [decision] = await context.lookup({ service, refs: [fullRef], identityLease: resolutionLease });
      if (decision?.status === "resolved") {
        results.push({ serviceId: service.manifest.id, ref: fullRef, status: "existing" });
        continue;
      }
      if (decision?.status !== "missing") {
        throw new Error(`Generated secret provisioning is unavailable for service "${service.manifest.id}" (${decision?.status ?? "degraded"}).`);
      }

      const writebackIdentity = await issueScopedBrokerIdentity(service, {
        launchLeaseIssuer: context.launchLeaseIssuer,
        transportBinding: context.transportBinding,
      });
      const writebackLease = parseLease(writebackIdentity?.env);
      if (!writebackIdentity || !writebackLease) {
        throw new Error(`Secrets Broker did not issue a provisioning writeback lease for service "${service.manifest.id}".`);
      }
      const value = randomBytes(generated.valuePolicy.bytes).toString("base64url");
      const writeback = await context.writeback({
        serviceId: service.manifest.id,
        identityExpiresAt: writebackIdentity.metadata.expiresAt,
        identityLease: writebackLease,
        namespace: generated.namespace,
        ref: generated.ref,
        operation: generated.operation,
        allowedNamespaces: plan.writeback.allowedNamespaces,
        allowedOperations: plan.writeback.allowedOperations,
        value,
      });
      if (!writeback.ok) {
        throw new Error(`Generated secret writeback failed for service "${service.manifest.id}" (${writeback.outcome}).`);
      }
      results.push({ serviceId: service.manifest.id, ref: fullRef, status: "created" });
    }
  }
  return results;
}
