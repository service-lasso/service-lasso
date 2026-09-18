import path from "node:path";
import { readPrivateJson, writePrivateJson } from "../security/private-json.js";

export const RUNTIME_STARTUP_SETTINGS_SCHEMA = "service-lasso.runtime-startup-settings.v1";

export interface RuntimeStartupSettings {
  readonly schema: typeof RUNTIME_STARTUP_SETTINGS_SCHEMA;
  readonly autostart: boolean;
}

const defaults: RuntimeStartupSettings = { schema: RUNTIME_STARTUP_SETTINGS_SCHEMA, autostart: true };

function settingsPath(workspaceRoot: string): string {
  return path.join(path.resolve(workspaceRoot), ".service-lasso", "runtime-startup-settings.json");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Missing or malformed state deliberately retains the safe product default. */
export async function readRuntimeStartupSettings(workspaceRoot: string): Promise<RuntimeStartupSettings> {
  const value = await readPrivateJson(workspaceRoot, settingsPath(workspaceRoot));
  if (!isRecord(value) || value.schema !== RUNTIME_STARTUP_SETTINGS_SCHEMA || typeof value.autostart !== "boolean") return defaults;
  return { schema: RUNTIME_STARTUP_SETTINGS_SCHEMA, autostart: value.autostart };
}

export async function writeRuntimeStartupSettings(
  workspaceRoot: string,
  input: Pick<RuntimeStartupSettings, "autostart">,
): Promise<RuntimeStartupSettings> {
  const settings: RuntimeStartupSettings = { schema: RUNTIME_STARTUP_SETTINGS_SCHEMA, autostart: input.autostart };
  await writePrivateJson(workspaceRoot, settingsPath(workspaceRoot), settings);
  return settings;
}
