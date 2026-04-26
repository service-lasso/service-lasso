import { readFile } from "node:fs/promises";
import { getServiceStatePaths } from "./paths.js";

export interface StoredStateSnapshot {
  service: unknown | null;
  meta: unknown | null;
  install: unknown | null;
  updates: unknown | null;
  recovery: unknown | null;
  config: unknown | null;
  runtime: unknown | null;
}

async function readJsonIfPresent(path: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch {
    return null;
  }
}

export async function readStoredState(serviceRoot: string): Promise<StoredStateSnapshot> {
  const paths = getServiceStatePaths(serviceRoot);

  const [service, meta, install, updates, recovery, config, runtime] = await Promise.all([
    readJsonIfPresent(paths.service),
    readJsonIfPresent(paths.meta),
    readJsonIfPresent(paths.install),
    readJsonIfPresent(paths.updates),
    readJsonIfPresent(paths.recovery),
    readJsonIfPresent(paths.config),
    readJsonIfPresent(paths.runtime),
  ]);

  return {
    service,
    meta,
    install,
    updates,
    recovery,
    config,
    runtime,
  };
}
