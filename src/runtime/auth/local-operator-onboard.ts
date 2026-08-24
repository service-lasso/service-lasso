import { randomBytes } from "node:crypto";
import {
  FIRST_RUN_VAULT_FIELD_NAMES,
  FORCE_SSO_FIELD,
  LOCAL_ADMIN_TOKEN_FIELD,
  LOCAL_AUTH_POLICY_KV_PATH,
  LOCAL_OPERATOR_PASSWORD_FIELD,
  LOCAL_OPERATOR_SECRET_KV_PATH,
  LOCAL_OPERATOR_USERNAME,
  LOCAL_OPERATOR_USERNAME_FIELD,
} from "./local-auth-constants.js";
import {
  materialFromState,
  patchLocalOperatorForceSso,
  persistFirstRunEnvelope,
  readFirstRunEnvelope,
  readLocalOperatorAuthState,
  writeLocalOperatorAuthState,
  type LocalAuthMaterial,
  type LocalOperatorFirstRunSecrets,
} from "./local-auth-store.js";
import { SECRETSBROKER_SERVICE_ID } from "../broker/operator-config.js";
import { loadSecretsBrokerRuntimeContext } from "../broker/runtime.js";
import type {
  SecretsBrokerHttpRequester,
  SecretsBrokerHttpResponse,
} from "../broker/ipc-transport.js";
import { discoverServices } from "../discovery/discoverServices.js";
import { createServiceRegistry } from "../manager/DependencyGraph.js";

const MATERIAL_CACHE_TTL_MS = 5_000;
const DEFAULT_BROKER_WAIT_TIMEOUT_MS = 30_000;
const DEFAULT_BROKER_WAIT_INTERVAL_MS = 250;
const KV_REQUEST_TIMEOUT_MS = 3_000;

let cachedMaterial: {
  expiresAt: number;
  workspaceRoot: string;
  material: LocalAuthMaterial;
} | null = null;

/** Drop cached hashes and first-run flags after seed or acknowledge. */
export function clearLocalAuthMaterialCache(): void {
  cachedMaterial = null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * First-run pending means hashed state exists and the operator has not
 * acknowledged. The plaintext envelope may still be withheld until Broker KV
 * ingest succeeds.
 */
function materialWithFirstRun(
  state: Awaited<ReturnType<typeof readLocalOperatorAuthState>>,
  envToken: string | undefined,
): LocalAuthMaterial {
  const material = materialFromState(state, envToken);
  const firstRunPending = state !== null && state.credentialsAcknowledged === false;
  return {
    ...material,
    firstRunPending,
    credentialsAcknowledged: !firstRunPending,
  };
}

function generateLocalSecret(): string {
  return randomBytes(32).toString("base64url");
}

function truthyField(value: unknown): boolean {
  return value === true || value === "1" || (typeof value === "string" && value.toLowerCase() === "true");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export interface BrokerKvClient {
  request: SecretsBrokerHttpRequester;
}

interface BrokerKvClientResolution {
  client: BrokerKvClient | null;
  discovered: boolean;
}

export interface EnsureLocalOperatorAuthOptions {
  workspaceRoot: string;
  servicesRoot: string;
  env?: NodeJS.ProcessEnv;
  /**
   * Injected Broker client for tests. When omitted, production waits for a
   * discovered `@secretsbroker`. `NODE_TEST_CONTEXT` without an injected client
   * stays local-only so unit tests do not touch a live demo vault.
   */
  brokerClient?: BrokerKvClient;
  brokerWaitTimeoutMs?: number;
  brokerWaitIntervalMs?: number;
}

interface KvSnapshot {
  fields: Record<string, string>;
  version: number;
}

async function resolveBrokerClient(
  workspaceRoot: string,
  servicesRoot: string,
): Promise<BrokerKvClientResolution> {
  let discovered: Awaited<ReturnType<typeof discoverServices>>;
  try {
    discovered = await discoverServices(servicesRoot);
  } catch {
    return { client: null, discovered: false };
  }
  const broker = discovered.find((service) => service.manifest.id === SECRETSBROKER_SERVICE_ID);
  if (!broker) {
    return { client: null, discovered: false };
  }
  try {
    const runtime = await loadSecretsBrokerRuntimeContext(
      workspaceRoot,
      createServiceRegistry(discovered),
    );
    if (!runtime) {
      return { client: null, discovered: true };
    }
    return {
      client: { request: runtime.operatorRequest },
      discovered: true,
    };
  } catch {
    return { client: null, discovered: true };
  }
}

async function brokerHealthOk(client: BrokerKvClient): Promise<boolean> {
  try {
    const response = await client.request({
      method: "GET",
      pathWithQuery: "/ready",
      headers: {},
      timeoutMs: KV_REQUEST_TIMEOUT_MS,
    });
    return response.status === 200;
  } catch {
    return false;
  }
}

/**
 * Wait until `@secretsbroker` accepts authenticated IPC health checks. Any
 * missing or unavailable Broker fails closed because first-run secrets must go
 * into the vault before INIT reveal.
 */
export async function waitForBrokerKvClient(options: {
  workspaceRoot: string;
  servicesRoot: string;
  timeoutMs?: number;
  intervalMs?: number;
}): Promise<BrokerKvClient | null> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_BROKER_WAIT_TIMEOUT_MS;
  const intervalMs = options.intervalMs ?? DEFAULT_BROKER_WAIT_INTERVAL_MS;
  const deadline = Date.now() + timeoutMs;
  let sawBroker = false;

  while (Date.now() <= deadline) {
    const resolution = await resolveBrokerClient(options.workspaceRoot, options.servicesRoot);
    sawBroker ||= resolution.discovered;
    if (resolution.client) {
      if (await brokerHealthOk(resolution.client)) {
        return resolution.client;
      }
    }
    await sleep(intervalMs);
  }

  if (sawBroker) {
    throw new Error("Secrets Broker did not become ready for first-run vault ingest.");
  }
  throw new Error("Secrets Broker was not discovered for first-run vault ingest.");
}

function parseKvSnapshot(payload: unknown): KvSnapshot | null {
  if (!isRecord(payload) || !isRecord(payload.data)) {
    return null;
  }
  const data = payload.data;
  const fieldsRecord = isRecord(data.data) ? data.data : {};
  const metadata = isRecord(data.metadata) ? data.metadata : {};
  const fields: Record<string, string> = {};
  for (const [key, value] of Object.entries(fieldsRecord)) {
    if (typeof value === "string") {
      fields[key] = value;
    }
  }
  const version = typeof metadata.version === "number" && Number.isInteger(metadata.version) ? metadata.version : 0;
  return { fields, version };
}

async function readKvSnapshot(
  client: BrokerKvClient,
  kvPath: string,
): Promise<KvSnapshot | null> {
  try {
    const response = await client.request({
      method: "GET",
      pathWithQuery: `/v1/kv/data/${kvPath}?source=local`,
      headers: {},
      timeoutMs: KV_REQUEST_TIMEOUT_MS,
    });
    if (response.status === 404) {
      return { fields: {}, version: 0 };
    }
    if (response.status < 200 || response.status >= 300) {
      return null;
    }
    return parseKvSnapshot(parseBrokerJson(response));
  } catch {
    return null;
  }
}

async function writeKvSnapshot(
  client: BrokerKvClient,
  kvPath: string,
  fields: Record<string, string>,
  cas: number,
): Promise<boolean> {
  try {
    const response = await client.request({
      method: "POST",
      pathWithQuery: `/v1/kv/data/${kvPath}?source=local`,
      headers: {
        "content-type": "application/json",
      },
      body: Buffer.from(JSON.stringify({
        data: fields,
        options: { cas },
      }), "utf8"),
      timeoutMs: KV_REQUEST_TIMEOUT_MS,
    });
    return (response.status >= 200 && response.status < 300) || response.status === 204;
  } catch {
    return false;
  }
}

function parseBrokerJson(response: SecretsBrokerHttpResponse): unknown {
  try {
    return JSON.parse(response.body.toString("utf8")) as unknown;
  } catch {
    return null;
  }
}

function snapshotHasFirstRunFields(fields: Record<string, string>): boolean {
  for (const name of FIRST_RUN_VAULT_FIELD_NAMES) {
    const value = fields[name];
    if (typeof value !== "string" || value.length === 0) {
      return false;
    }
  }
  return true;
}

function secretsFromVaultFields(
  fields: Record<string, string>,
  generated: LocalOperatorFirstRunSecrets,
): LocalOperatorFirstRunSecrets {
  const username = fields[LOCAL_OPERATOR_USERNAME_FIELD];
  const token = fields[LOCAL_ADMIN_TOKEN_FIELD];
  const password = fields[LOCAL_OPERATOR_PASSWORD_FIELD];
  return {
    username:
      typeof username === "string" && username.trim().length > 0 ? username.trim() : generated.username,
    token: typeof token === "string" && token.length > 0 ? token : generated.token,
    password: typeof password === "string" && password.length > 0 ? password : generated.password,
  };
}

/**
 * Persist first-run username/token/password into Broker KV. Existing token and
 * password fields win. Returns the values actually stored. Never logs values.
 */
export async function persistFirstRunSecretsInVault(
  client: BrokerKvClient,
  generated: LocalOperatorFirstRunSecrets,
): Promise<LocalOperatorFirstRunSecrets> {
  const existing = await readKvSnapshot(client, LOCAL_OPERATOR_SECRET_KV_PATH);
  if (!existing) {
    throw new Error("Secrets Broker KV read failed for runtime/local-operator.");
  }

  const nextSecrets = secretsFromVaultFields(existing.fields, generated);
  if (snapshotHasFirstRunFields(existing.fields)) {
    return nextSecrets;
  }

  const merged: Record<string, string> = {
    ...existing.fields,
    [LOCAL_OPERATOR_USERNAME_FIELD]: nextSecrets.username,
    [LOCAL_ADMIN_TOKEN_FIELD]: nextSecrets.token,
    [LOCAL_OPERATOR_PASSWORD_FIELD]: nextSecrets.password,
  };
  const cas = existing.version;
  const wrote = await writeKvSnapshot(
    client,
    LOCAL_OPERATOR_SECRET_KV_PATH,
    merged,
    cas,
  );
  if (!wrote) {
    throw new Error("Secrets Broker KV write failed for runtime/local-operator.");
  }

  const confirmed = await readKvSnapshot(client, LOCAL_OPERATOR_SECRET_KV_PATH);
  if (!confirmed || !snapshotHasFirstRunFields(confirmed.fields)) {
    throw new Error("Secrets Broker KV did not confirm first-run field names after write.");
  }
  return secretsFromVaultFields(confirmed.fields, nextSecrets);
}

async function ensureForceSsoPolicy(
  broker: BrokerKvClient,
  forceSso: boolean,
  workspaceRoot: string,
): Promise<boolean> {
  const policy = await readKvSnapshot(broker, LOCAL_AUTH_POLICY_KV_PATH);
  if (policy && Object.prototype.hasOwnProperty.call(policy.fields, FORCE_SSO_FIELD)) {
    const next = truthyField(policy.fields[FORCE_SSO_FIELD]);
    await patchLocalOperatorForceSso(workspaceRoot, next);
    return next;
  }
  await writeKvSnapshot(
    broker,
    LOCAL_AUTH_POLICY_KV_PATH,
    { [FORCE_SSO_FIELD]: forceSso ? "true" : "false" },
    policy?.version ?? 0,
  );
  return forceSso;
}

async function cacheMaterial(
  workspaceRoot: string,
  envToken: string | undefined,
): Promise<LocalAuthMaterial> {
  const state = await readLocalOperatorAuthState(workspaceRoot);
  const material = materialWithFirstRun(state, envToken);
  cachedMaterial = {
    expiresAt: Date.now() + MATERIAL_CACHE_TTL_MS,
    workspaceRoot,
    material,
  };
  return material;
}

/**
 * Seed hashed local-operator secrets and persist plaintext copies into Broker
 * KV before the loopback INIT envelope is written. Existing KV token/password
 * values are not overwritten.
 */
export async function ensureLocalOperatorAuth(
  options: EnsureLocalOperatorAuthOptions,
): Promise<LocalAuthMaterial> {
  const env = options.env ?? process.env;
  const existing = await readLocalOperatorAuthState(options.workspaceRoot);
  const skipBroker = options.brokerClient === undefined && Boolean(env.NODE_TEST_CONTEXT);
  const broker = skipBroker
    ? null
    : (options.brokerClient ??
      (await waitForBrokerKvClient({
        workspaceRoot: options.workspaceRoot,
        servicesRoot: options.servicesRoot,
        timeoutMs: options.brokerWaitTimeoutMs,
        intervalMs: options.brokerWaitIntervalMs,
      })));
  let forceSso = existing?.forceSso === true;

  if (broker) {
    forceSso = await ensureForceSsoPolicy(broker, forceSso, options.workspaceRoot);
  }

  if (!existing) {
    const envToken = env.SERVICE_LASSO_LOCAL_ADMIN_TOKEN?.trim();
    const generated: LocalOperatorFirstRunSecrets = {
      username: LOCAL_OPERATOR_USERNAME,
      token: envToken && envToken.length > 0 ? envToken : generateLocalSecret(),
      password: generateLocalSecret(),
    };
    const vaultSecrets = broker
      ? await persistFirstRunSecretsInVault(broker, generated)
      : generated;
    await writeLocalOperatorAuthState(options.workspaceRoot, {
      token: vaultSecrets.token,
      password: vaultSecrets.password,
      forceSso,
      credentialsAcknowledged: false,
      persistPlaintextEnvelope: broker === null,
    });
    if (broker) {
      await persistFirstRunEnvelope(options.workspaceRoot, vaultSecrets);
    }
    return cacheMaterial(options.workspaceRoot, env.SERVICE_LASSO_LOCAL_ADMIN_TOKEN);
  }

  if (!existing.credentialsAcknowledged) {
    const envelope = await readFirstRunEnvelope(options.workspaceRoot);
    if (broker && envelope) {
      const vaultSecrets = await persistFirstRunSecretsInVault(broker, envelope);
      await persistFirstRunEnvelope(options.workspaceRoot, vaultSecrets);
    } else if (broker && !envelope) {
      const generated: LocalOperatorFirstRunSecrets = {
        username: LOCAL_OPERATOR_USERNAME,
        token: generateLocalSecret(),
        password: generateLocalSecret(),
      };
      const vaultSecrets = await persistFirstRunSecretsInVault(broker, generated);
      await writeLocalOperatorAuthState(options.workspaceRoot, {
        token: vaultSecrets.token,
        password: vaultSecrets.password,
        forceSso,
        credentialsAcknowledged: false,
        persistPlaintextEnvelope: false,
      });
      await persistFirstRunEnvelope(options.workspaceRoot, vaultSecrets);
    }
  }

  return cacheMaterial(options.workspaceRoot, env.SERVICE_LASSO_LOCAL_ADMIN_TOKEN);
}

/**
 * Fast path for request-policy: hashed state only, no Broker round-trip.
 */
export async function loadLocalAuthMaterial(options: {
  workspaceRoot: string;
  env?: NodeJS.ProcessEnv;
}): Promise<LocalAuthMaterial> {
  const env = options.env ?? process.env;
  const workspaceRoot = options.workspaceRoot;
  if (
    cachedMaterial &&
    cachedMaterial.workspaceRoot === workspaceRoot &&
    cachedMaterial.expiresAt > Date.now()
  ) {
    return cachedMaterial.material;
  }
  return cacheMaterial(workspaceRoot, env.SERVICE_LASSO_LOCAL_ADMIN_TOKEN);
}
