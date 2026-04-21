import { mkdir, readFile, writeFile } from "node:fs/promises";
import { getServiceStatePaths } from "./paths.js";

export interface ServiceMetaPosition {
  x: number;
  y: number;
}

export interface ServiceMetaRecord {
  favorite: boolean;
  dependencyGraphPosition: ServiceMetaPosition | null;
}

export interface PersistedServiceMeta {
  id: string;
  favorite: boolean;
  dependencyGraphPosition: ServiceMetaPosition | null;
}

export interface ServiceMetaPatch {
  favorite?: boolean;
  dependencyGraphPosition?: ServiceMetaPosition | null;
}

export const DEFAULT_SERVICE_META: ServiceMetaRecord = {
  favorite: false,
  dependencyGraphPosition: null,
};

function normalizeMeta(input: unknown): ServiceMetaRecord {
  const candidate = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const positionCandidate =
    candidate.dependencyGraphPosition && typeof candidate.dependencyGraphPosition === "object"
      ? candidate.dependencyGraphPosition as Record<string, unknown>
      : null;

  const x = typeof positionCandidate?.x === "number" ? positionCandidate.x : null;
  const y = typeof positionCandidate?.y === "number" ? positionCandidate.y : null;

  return {
    favorite: candidate.favorite === true,
    dependencyGraphPosition: x !== null && y !== null ? { x, y } : null,
  };
}

export async function readServiceMeta(serviceRoot: string): Promise<ServiceMetaRecord> {
  const paths = getServiceStatePaths(serviceRoot);

  try {
    return normalizeMeta(JSON.parse(await readFile(paths.meta, "utf8")) as unknown);
  } catch {
    return { ...DEFAULT_SERVICE_META };
  }
}

export async function writeServiceMeta(serviceRoot: string, patch: ServiceMetaPatch): Promise<ServiceMetaRecord> {
  const paths = getServiceStatePaths(serviceRoot);
  const current = await readServiceMeta(serviceRoot);
  const next: ServiceMetaRecord = {
    favorite: patch.favorite ?? current.favorite,
    dependencyGraphPosition:
      patch.dependencyGraphPosition === undefined
        ? current.dependencyGraphPosition
        : patch.dependencyGraphPosition,
  };

  await mkdir(paths.stateRoot, { recursive: true });
  await writeFile(
    paths.meta,
    JSON.stringify(
      {
        favorite: next.favorite,
        dependencyGraphPosition: next.dependencyGraphPosition,
      },
      null,
      2,
    ),
  );

  return next;
}

export async function buildPersistedServiceMeta(serviceId: string, serviceRoot: string): Promise<PersistedServiceMeta> {
  const meta = await readServiceMeta(serviceRoot);

  return {
    id: serviceId,
    favorite: meta.favorite,
    dependencyGraphPosition: meta.dependencyGraphPosition,
  };
}
