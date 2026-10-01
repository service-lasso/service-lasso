import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const SCHEMA = "service-lasso.workspace-authority.v1";
const ID = /^wsa_[0-9a-f]{32}$/u;

interface WorkspaceAuthorityDocument {
  schema: typeof SCHEMA;
  version: 1;
  workspaceId: string;
  canonicalWorkspaceRoot: string;
  canonicalServicesRoot: string;
}

function documentPath(workspaceRoot: string): string {
  return path.join(path.resolve(workspaceRoot), ".service-lasso", "workspace-authority.json");
}

function valid(value: unknown, workspaceRoot: string, servicesRoot: string): value is WorkspaceAuthorityDocument {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return record.schema === SCHEMA && record.version === 1 && typeof record.workspaceId === "string" && ID.test(record.workspaceId)
    && record.canonicalWorkspaceRoot === path.resolve(workspaceRoot) && record.canonicalServicesRoot === path.resolve(servicesRoot);
}

/**
 * Establishes Core's opaque workspace authority during normal configuration.
 * The identifier is random durable state, never a path-derived projection or
 * a caller/API supplied value.
 */
export async function ensureWorkspaceAuthority(input: { workspaceRoot: string; servicesRoot: string }): Promise<string> {
  const target = documentPath(input.workspaceRoot);
  try {
    const existing = JSON.parse(await readFile(target, "utf8")) as unknown;
    if (!valid(existing, input.workspaceRoot, input.servicesRoot)) throw new Error("workspace authority is invalid");
    return existing.workspaceId;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await mkdir(path.dirname(target), { recursive: true });
  try {
    const existing = JSON.parse(await readFile(target, "utf8")) as unknown;
    if (!valid(existing, input.workspaceRoot, input.servicesRoot)) throw new Error("workspace authority is invalid");
    return existing.workspaceId;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const authority: WorkspaceAuthorityDocument = {
    schema: SCHEMA, version: 1, workspaceId: `wsa_${randomUUID().replaceAll("-", "")}`,
    canonicalWorkspaceRoot: path.resolve(input.workspaceRoot), canonicalServicesRoot: path.resolve(input.servicesRoot),
  };
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(authority)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
  try { await rename(temporary, target); } catch (error) {
    try {
      const existing = JSON.parse(await readFile(target, "utf8")) as unknown;
      if (valid(existing, input.workspaceRoot, input.servicesRoot)) return existing.workspaceId;
    } catch { /* preserve the original failure */ }
    throw error;
  }
  return authority.workspaceId;
}

/** Reads only an already-established authority; HTTP routes never mint one. */
export async function readWorkspaceAuthority(input: { workspaceRoot: string; servicesRoot: string }): Promise<string | null> {
  try {
    const target = documentPath(input.workspaceRoot);
    const info = await lstat(target);
    if (!info.isFile() || info.isSymbolicLink()) return null;
    const value = JSON.parse(await readFile(target, "utf8")) as unknown;
    return valid(value, input.workspaceRoot, input.servicesRoot) ? value.workspaceId : null;
  } catch { return null; }
}
