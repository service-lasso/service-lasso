import { createHash, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";

import type {
  VaultKeyBootstrapResponse,
  VaultKeyFingerprintResponse,
  VaultKeySourceResponse,
  VaultKeySourceType,
} from "../../contracts/api.js";

export const DEFAULT_VAULT_KEY_ENV_NAME = "SERVICE_LASSO_VAULT_KEY";
export const DEFAULT_VAULT_KEY_FILE_ENV_NAME = "SERVICE_LASSO_VAULT_KEY_FILE";
export const DEFAULT_GENERATED_VAULT_KEY_BYTES = 32;

export interface ResolveVaultKeyOptions {
  osManagedKey?: string | null;
  filePath?: string | null;
  env?: NodeJS.ProcessEnv;
  envName?: string;
  fileEnvName?: string;
  cliValue?: string | null;
  allowGeneration?: boolean;
  generatedByteLength?: number;
}

export interface ResolvedVaultKeyMaterial {
  source: VaultKeySourceResponse;
  keyMaterial: string;
  generated: boolean;
}

export function fingerprintVaultKey(keyMaterial: string): VaultKeyFingerprintResponse {
  const value = createHash("sha256").update(keyMaterial, "utf8").digest("hex");
  return {
    algorithm: "sha256",
    value,
    display: `sha256:${value.slice(0, 16)}`,
  };
}

export async function resolveVaultKey(options: ResolveVaultKeyOptions = {}): Promise<ResolvedVaultKeyMaterial> {
  const env = options.env ?? process.env;
  const envName = options.envName ?? DEFAULT_VAULT_KEY_ENV_NAME;
  const fileEnvName = options.fileEnvName ?? DEFAULT_VAULT_KEY_FILE_ENV_NAME;

  const osManagedKey = readNonEmptyValue(options.osManagedKey);
  if (osManagedKey) {
    return resolved("os-managed", osManagedKey);
  }

  const filePath = readNonEmptyValue(options.filePath) ?? readNonEmptyValue(env[fileEnvName]);
  if (filePath) {
    const keyMaterial = readNonEmptyValue(stripTrailingLineBreaks(await readFile(filePath, "utf8")));
    if (keyMaterial) {
      return resolved("file", keyMaterial, { filePath });
    }
  }

  const envValue = readNonEmptyValue(env[envName]);
  if (envValue) {
    return resolved("env", envValue, { envName });
  }

  const cliValue = readNonEmptyValue(options.cliValue);
  if (cliValue) {
    return resolved("cli", cliValue);
  }

  if (options.allowGeneration === false) {
    throw new Error("Vault key is required but no configured source supplied one.");
  }

  const byteLength = options.generatedByteLength ?? DEFAULT_GENERATED_VAULT_KEY_BYTES;
  if (!Number.isInteger(byteLength) || byteLength < 32) {
    throw new Error("Generated vault keys must use at least 32 random bytes.");
  }

  return resolved("generated", randomBytes(byteLength).toString("base64url"));
}

export function buildVaultKeyBootstrapResponse(
  resolution: ResolvedVaultKeyMaterial,
  options: { revealGeneratedKey?: boolean } = {},
): VaultKeyBootstrapResponse {
  const revealGeneratedKey = options.revealGeneratedKey === true && resolution.generated;

  return {
    contractVersion: "vault-key-bootstrap.v1",
    status: "ready",
    source: {
      ...resolution.source,
      reveal: revealGeneratedKey ? "once" : "never",
    },
    oneTimeReveal: revealGeneratedKey
      ? {
          key: resolution.keyMaterial,
          confirmationRequired: true,
          warning: "Save this vault key now. Service Lasso will not reveal it again after setup completes.",
        }
      : null,
    warnings: resolution.generated
      ? ["Generated vault keys are revealed once and must be saved before setup is completed."]
      : ["Supplied vault keys are never echoed back by setup status or bootstrap responses."],
  };
}

function resolved(
  sourceType: VaultKeySourceType,
  keyMaterial: string,
  metadata: { envName?: string; filePath?: string } = {},
): ResolvedVaultKeyMaterial {
  const generated = sourceType === "generated";

  return {
    keyMaterial,
    generated,
    source: {
      type: sourceType,
      supplied: !generated,
      reveal: generated ? "once" : "never",
      fingerprint: fingerprintVaultKey(keyMaterial),
      ...metadata,
    },
  };
}

function readNonEmptyValue(value: string | null | undefined): string | null {
  if (typeof value !== "string" || value.length === 0) {
    return null;
  }

  return value;
}

function stripTrailingLineBreaks(value: string): string {
  return value.replace(/[\r\n]+$/u, "");
}
