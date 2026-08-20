import { randomBytes } from "node:crypto";
import {
  FORCE_SSO_FIELD,
  LOCAL_ADMIN_TOKEN_FIELD,
  LOCAL_AUTH_POLICY_KV_PATH,
  LOCAL_OPERATOR_PASSWORD_FIELD,
  LOCAL_OPERATOR_SECRET_KV_PATH,
} from "./local-auth-constants.js";
import {
  materialFromState,
  patchLocalOperatorForceSso,
  readFirstRunEnvelope,
  readLocalOperatorAuthState,
  writeLocalOperatorAuthState,
  type LocalAuthMaterial,
} from "./local-auth-store.js";
import {
  readSecretsBrokerOperatorConfig,
  resolveSecretsBrokerPort,
  SECRETSBROKER_SERVICE_ID,
} from "../broker/operator-config.js";
import { discoverServices } from "../discovery/discoverServices.js";

const MATERIAL_CACHE_TTL_MS = 5_000;

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

function materialWithFirstRun(
  state: Awaited<ReturnType<typeof readLocalOperatorAuthState>>,
  envToken: string | undefined,
  firstRunPending: boolean,
): LocalAuthMaterial {
  const material = materialFromState(state, envToken);
  return {
    ...material,
    firstRunPending,
    credentialsAcknowledged: material.credentialsAcknowledged && !firstRunPending,
  };
}

function generateLocalSecret(): string {
  return randomBytes(32).toString("base64url");
}

function truthyField(value: unknown): boolean {
  return value === true || value === "1" || (typeof value === "string" && value.toLowerCase() === "true");
}

interface BrokerKvClient {
  apiToken: string;
  port: number;
}

async function resolveBrokerClient(servicesRoot: string): Promise<BrokerKvClient | null> {
  try {
    const discovered = await discoverServices(servicesRoot);
    const broker = discovered.find((service) => service.manifest.id === SECRETSBROKER_SERVICE_ID);
    if (!broker) {
      return null;
    }
    const operatorConfig = await readSecretsBrokerOperatorConfig(broker.serviceRoot);
    const port = resolveSecretsBrokerPort(broker);
    if (!operatorConfig?.apiToken || port === null) {
      return null;
    }
    return { apiToken: operatorConfig.apiToken, port };
  } catch {
    return null;
  }
}

async function readKvFields(
  client: BrokerKvClient,
  kvPath: string,
): Promise<Record<string, string> | null> {
  try {
    const response = await fetch(
      `http://127.0.0.1:${String(client.port)}/v1/kv/data/${kvPath}?source=local`,
      {
        headers: {
          authorization: `Bearer ${client.apiToken}`,
        },
        signal: AbortSignal.timeout(1500),
      },
    );
    if (!response.ok) {
      return null;
    }
    const payload: unknown = await response.json();
    const data = isRecord(payload) && isRecord(payload.data) ? payload.data : {};
    const fields = isRecord(data.data) ? data.data : {};
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(fields)) {
      if (typeof value === "string") {
        result[key] = value;
      }
    }
    return result;
  } catch {
    return null;
  }
}

async function ingestKvFields(
  client: BrokerKvClient,
  kvPath: string,
  fields: Record<string, string>,
): Promise<boolean> {
  try {
    const response = await fetch(
      `http://127.0.0.1:${String(client.port)}/v1/kv/data/${kvPath}?source=local`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${client.apiToken}`,
        },
        body: JSON.stringify({
          data: fields,
          options: { cas: 0 },
        }),
        signal: AbortSignal.timeout(1500),
      },
    );
    return response.ok || response.status === 400;
  } catch {
    return false;
  }
}

/**
 * Seed hashed local-operator secrets and ingest plaintext copies into Broker KV
 * for loopback reveal. Existing KV versions are not overwritten (CAS 0).
 */
export async function ensureLocalOperatorAuth(options: {
  workspaceRoot: string;
  servicesRoot: string;
  env?: NodeJS.ProcessEnv;
}): Promise<LocalAuthMaterial> {
  const env = options.env ?? process.env;
  const existing = await readLocalOperatorAuthState(options.workspaceRoot);
  // node:test must not discover or write the live demo Broker KV.
  const broker = env.NODE_TEST_CONTEXT ? null : await resolveBrokerClient(options.servicesRoot);
  let forceSso = existing?.forceSso === true;

  if (broker) {
    const policy = await readKvFields(broker, LOCAL_AUTH_POLICY_KV_PATH);
    if (policy && Object.prototype.hasOwnProperty.call(policy, FORCE_SSO_FIELD)) {
      forceSso = truthyField(policy[FORCE_SSO_FIELD]);
      await patchLocalOperatorForceSso(options.workspaceRoot, forceSso);
    } else {
      await ingestKvFields(broker, LOCAL_AUTH_POLICY_KV_PATH, {
        [FORCE_SSO_FIELD]: forceSso ? "true" : "false",
      });
    }
  }

  if (!existing) {
    const envToken = env.SERVICE_LASSO_LOCAL_ADMIN_TOKEN?.trim();
    const token = envToken && envToken.length > 0 ? envToken : generateLocalSecret();
    const password = generateLocalSecret();
    await writeLocalOperatorAuthState(options.workspaceRoot, { token, password, forceSso, credentialsAcknowledged: false });
    if (broker) {
      await ingestKvFields(broker, LOCAL_OPERATOR_SECRET_KV_PATH, {
        [LOCAL_ADMIN_TOKEN_FIELD]: token,
        [LOCAL_OPERATOR_PASSWORD_FIELD]: password,
      });
    }
  }

  const state = await readLocalOperatorAuthState(options.workspaceRoot);
  const envelope = await readFirstRunEnvelope(options.workspaceRoot);
  const material = materialWithFirstRun(state, env.SERVICE_LASSO_LOCAL_ADMIN_TOKEN, envelope !== null);
  cachedMaterial = {
    expiresAt: Date.now() + MATERIAL_CACHE_TTL_MS,
    workspaceRoot: options.workspaceRoot,
    material,
  };
  return material;
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
  const material = materialWithFirstRun(
    await readLocalOperatorAuthState(workspaceRoot),
    env.SERVICE_LASSO_LOCAL_ADMIN_TOKEN,
    (await readFirstRunEnvelope(workspaceRoot)) !== null,
  );
  cachedMaterial = {
    expiresAt: Date.now() + MATERIAL_CACHE_TTL_MS,
    workspaceRoot,
    material,
  };
  return material;
}
