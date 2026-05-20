import { ensureRuntimeConfig, resolveRuntimeConfig } from "../config.js";
import { createRuntimeInstanceSnapshot } from "../instance/registry.js";
import type { RuntimeInstanceResponse } from "../../contracts/api.js";

export interface RuntimeInstanceCliOptions {
  servicesRoot?: string;
  workspaceRoot?: string;
  version?: string;
}

export async function readRuntimeInstanceForCli(options: RuntimeInstanceCliOptions = {}): Promise<RuntimeInstanceResponse> {
  const config = await ensureRuntimeConfig(resolveRuntimeConfig(options));
  return await createRuntimeInstanceSnapshot(config);
}
