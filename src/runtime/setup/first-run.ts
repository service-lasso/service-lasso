import os from "node:os";
import path from "node:path";
import { mkdir, stat, writeFile } from "node:fs/promises";

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

export interface RuntimeSetupBootstrapResult {
  ok: true;
  state: RuntimeSetupState;
  vaultPath: string;
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

  return path.join(path.resolve(options.workspaceRoot), "vault", "vault.json");
}

function isLocalBindHost(bindHost: string): boolean {
  return bindHost === "127.0.0.1" || bindHost === "::1" || bindHost === "localhost";
}

function hasSetupToken(options: RuntimeSetupStatusOptions): boolean {
  return Boolean((options.setupToken ?? process.env.SERVICE_LASSO_SETUP_TOKEN)?.trim());
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await stat(targetPath);
    return true;
  } catch {
    return false;
  }
}

export async function ensureLocalVaultMarker(workspaceRoot: string, contents = "ready\n"): Promise<string> {
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

export async function bootstrapLocalVault(workspaceRoot: string): Promise<RuntimeSetupBootstrapResult> {
  const vaultPath = await ensureLocalVaultMarker(workspaceRoot);
  return {
    ok: true,
    state: "setup_complete",
    vaultPath,
  };
}

export async function readRuntimeSetupStatus(options: RuntimeSetupStatusOptions): Promise<RuntimeSetupStatus> {
  const bindHost = options.bindHost ?? process.env.SERVICE_LASSO_HOST ?? "0.0.0.0";
  const vaultPath = resolveVaultPath(options);
  const vaultReady = await pathExists(vaultPath);
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

export function shouldBlockNormalAutostart(status: RuntimeSetupStatus): boolean {
  return status.setupMode;
}
