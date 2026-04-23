import path from "node:path";
import { mkdir, stat } from "node:fs/promises";
import { DEFAULT_SERVICES_ROOT, DEFAULT_WORKSPACE_ROOT, type ServiceRootConfig } from "../contracts/service-root.js";

export interface RuntimeConfigOptions {
  servicesRoot?: string;
  workspaceRoot?: string;
  version?: string;
}

export interface RuntimeConfig extends ServiceRootConfig {
  version: string;
}

export class RuntimeConfigError extends Error {
  readonly code = "invalid_runtime_config";
  readonly statusCode = 400;

  constructor(message: string) {
    super(message);
    this.name = "RuntimeConfigError";
  }
}

function resolveRequiredPath(label: "servicesRoot" | "workspaceRoot", value: string | undefined, fallback: string): string {
  const candidate = value?.trim() || fallback;

  if (!candidate.trim()) {
    throw new RuntimeConfigError(`Runtime config requires a non-empty "${label}" value.`);
  }

  return path.resolve(candidate);
}

export function resolveRuntimeConfig(options: RuntimeConfigOptions = {}): RuntimeConfig {
  return {
    servicesRoot: resolveRequiredPath("servicesRoot", options.servicesRoot ?? process.env.SERVICE_LASSO_SERVICES_ROOT, DEFAULT_SERVICES_ROOT),
    workspaceRoot: resolveRequiredPath(
      "workspaceRoot",
      options.workspaceRoot ?? process.env.SERVICE_LASSO_WORKSPACE_ROOT,
      DEFAULT_WORKSPACE_ROOT,
    ),
    version: options.version ?? "0.1.0",
  };
}

export async function ensureRuntimeConfig(config: RuntimeConfig): Promise<RuntimeConfig> {
  let servicesRootStats;
  try {
    servicesRootStats = await stat(config.servicesRoot);
  } catch {
    throw new RuntimeConfigError(`Configured servicesRoot does not exist: ${config.servicesRoot}`);
  }

  if (!servicesRootStats.isDirectory()) {
    throw new RuntimeConfigError(`Configured servicesRoot is not a directory: ${config.servicesRoot}`);
  }

  await mkdir(config.workspaceRoot, { recursive: true });

  return config;
}
