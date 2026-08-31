import os from "node:os";
import path from "node:path";
import { lstat, mkdir, writeFile } from "node:fs/promises";
import type { ServiceRegistry } from "../manager/ServiceRegistry.js";
import {
  bootstrapSecretsBrokerVault,
  readSecretsBrokerRuntimeCredentials,
} from "../broker/runtime.js";

export type RuntimeSetupState =
  | "not_required"
  | "setup_required"
  | "setup_in_progress"
  | "setup_complete"
  | "setup_failed";

export interface RuntimeSetupStatus {
  contractVersion: "service-lasso.setup-status.v1";
  state: RuntimeSetupState;
  setupMode: boolean;
  vault: {
    required: boolean;
    ready: boolean;
    path: string;
  };
  operator: {
    osUsername: string;
    identitySource: "vault";
  };
  trustBoundary: {
    bindHost: string;
    localOnly: boolean;
    localhostBootstrapAllowed: boolean;
    remoteBootstrapAllowed: boolean;
    setupTokenConfigured: boolean;
    blockers: string[];
  };
}

export type PublicRuntimeSetupStatus = Omit<RuntimeSetupStatus, "vault"> & {
  vault: Pick<RuntimeSetupStatus["vault"], "required" | "ready">;
};

export interface RuntimeSetupBootstrapResult {
  ok: true;
  state: RuntimeSetupState;
  vaultPath: string;
  keyId: string;
  keyVersion: string;
  transportKind: "loopback-http" | "unix-socket" | "windows-named-pipe";
}

export interface RuntimeSetupStatusOptions {
  workspaceRoot: string;
  bindHost?: string;
  vaultPath?: string;
  setupToken?: string;
  stateOverride?: RuntimeSetupState;
}

const SETUP_STATUS_CONTRACT_VERSION = "service-lasso.setup-status.v1";

function resolveVaultPath(options: RuntimeSetupStatusOptions): string {
  const configured = options.vaultPath ?? process.env.SERVICE_LASSO_VAULT_PATH;
  if (configured?.trim()) {
    return path.resolve(configured);
  }

  return path.join(path.resolve(options.workspaceRoot), ".service-lasso", "secretsbroker", "store.json");
}

function isLocalBindHost(bindHost: string): boolean {
  return bindHost === "127.0.0.1" || bindHost === "::1" || bindHost === "localhost";
}

function hasSetupToken(options: RuntimeSetupStatusOptions): boolean {
  return Boolean((options.setupToken ?? process.env.SERVICE_LASSO_SETUP_TOKEN)?.trim());
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    const info = await lstat(targetPath);
    return info.isFile() && !info.isSymbolicLink();
  } catch {
    return false;
  }
}

/** @deprecated Test migration helper only. A marker never satisfies production setup readiness. */
export async function ensureLocalVaultMarker(workspaceRoot: string, contents = "legacy-marker-not-ready\n"): Promise<string> {
  const vaultPath = resolveVaultPath({ workspaceRoot });
  await mkdir(path.dirname(vaultPath), { recursive: true });
  await writeFile(vaultPath, contents);
  return vaultPath;
}

export function isSetupBootstrapAllowed(status: RuntimeSetupStatus, tokenAccepted = false): boolean {
  if (!status.setupMode) {
    return true;
  }

  return status.trustBoundary.localOnly || tokenAccepted;
}

export async function bootstrapLocalVault(
  workspaceRoot: string,
  registry: ServiceRegistry,
): Promise<RuntimeSetupBootstrapResult> {
  const result = await bootstrapSecretsBrokerVault(workspaceRoot, registry);
  return {
    ok: true,
    state: "setup_complete",
    vaultPath: resolveVaultPath({ workspaceRoot }),
    keyId: result.keyId,
    keyVersion: result.keyVersion,
    transportKind: result.transportKind,
  };
}

export async function readRuntimeSetupStatus(options: RuntimeSetupStatusOptions): Promise<RuntimeSetupStatus> {
  // Packaged Core is loopback-only by default (AC-4BX). A missing bindHost
  // must not report 0.0.0.0 / localOnly=false.
  const bindHost = options.bindHost ?? process.env.SERVICE_LASSO_HOST ?? "127.0.0.1";
  const vaultPath = resolveVaultPath(options);
  let credentialsReady = false;
  try {
    credentialsReady = (await readSecretsBrokerRuntimeCredentials(options.workspaceRoot)) !== null;
  } catch {
    credentialsReady = false;
  }
  // First-run setup is complete once the protected runtime identity and
  // encrypted store exist. A missing/unavailable OS wrapper means an existing
  // vault is locked; it must never reopen bootstrap mode or hide recovery UI.
  const vaultReady = credentialsReady && await pathExists(vaultPath);
  const tokenConfigured = hasSetupToken(options);
  const localOnly = isLocalBindHost(bindHost);
  const state = options.stateOverride ?? (vaultReady ? "not_required" : "setup_required");
  const setupMode = state === "setup_required" || state === "setup_in_progress" || state === "setup_failed";
  const localhostBootstrapAllowed = setupMode && localOnly;
  const remoteBootstrapAllowed = setupMode && !localOnly && tokenConfigured;
  const blockers: string[] = [];

  if (setupMode && !localOnly && !tokenConfigured) {
    blockers.push("setup_token_required_for_remote_bind");
  }

  return {
    contractVersion: SETUP_STATUS_CONTRACT_VERSION,
    state,
    setupMode,
    vault: {
      required: true,
      ready: vaultReady,
      path: vaultPath,
    },
    operator: {
      osUsername: os.userInfo().username,
      identitySource: "vault",
    },
    trustBoundary: {
      bindHost,
      localOnly,
      localhostBootstrapAllowed,
      remoteBootstrapAllowed,
      setupTokenConfigured: tokenConfigured,
      blockers,
    },
  };
}

export function toPublicRuntimeSetupStatus(status: RuntimeSetupStatus): PublicRuntimeSetupStatus {
  return {
    contractVersion: status.contractVersion,
    state: status.state,
    setupMode: status.setupMode,
    vault: {
      required: status.vault.required,
      ready: status.vault.ready,
    },
    operator: {
      osUsername: status.operator.osUsername,
      identitySource: status.operator.identitySource,
    },
    trustBoundary: {
      bindHost: status.trustBoundary.bindHost,
      localOnly: status.trustBoundary.localOnly,
      localhostBootstrapAllowed: status.trustBoundary.localhostBootstrapAllowed,
      remoteBootstrapAllowed: status.trustBoundary.remoteBootstrapAllowed,
      setupTokenConfigured: status.trustBoundary.setupTokenConfigured,
      blockers: [...status.trustBoundary.blockers],
    },
  };
}

export function shouldBlockNormalAutostart(status: RuntimeSetupStatus): boolean {
  return status.setupMode;
}
