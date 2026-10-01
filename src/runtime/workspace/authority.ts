import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { withCrossProcessFileLock } from "../security/cross-process-file-lock.js";

const SCHEMA = "service-lasso.workspace-authority.v1";
const ID = /^wsa_[0-9a-f]{32}$/u;

interface WorkspaceAuthorityDocument {
  schema: typeof SCHEMA;
  version: 1;
  workspaceId: string;
  canonicalWorkspaceRoot: string;
}

function documentPath(workspaceRoot: string): string {
  return path.join(path.resolve(workspaceRoot), ".service-lasso", "workspace-authority.json");
}

function valid(value: unknown, workspaceRoot: string): value is WorkspaceAuthorityDocument {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  return keys.length === 4 && keys.every((key) => ["schema", "version", "workspaceId", "canonicalWorkspaceRoot"].includes(key))
    && record.schema === SCHEMA && record.version === 1 && typeof record.workspaceId === "string" && ID.test(record.workspaceId)
    && record.canonicalWorkspaceRoot === path.resolve(workspaceRoot);
}

function legacyValid(value: unknown, workspaceRoot: string): value is WorkspaceAuthorityDocument {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  return keys.length === 5 && keys.every((key) => ["schema", "version", "workspaceId", "canonicalWorkspaceRoot", "canonicalServicesRoot"].includes(key))
    && record.schema === SCHEMA && record.version === 1 && typeof record.workspaceId === "string" && ID.test(record.workspaceId)
    && record.canonicalWorkspaceRoot === path.resolve(workspaceRoot) && typeof record.canonicalServicesRoot === "string";
}

/**
 * Establishes Core's opaque workspace authority during normal configuration.
 * The identifier is random durable state, never a path-derived projection or
 * a caller/API supplied value.
 */
export async function ensureWorkspaceAuthority(input: { workspaceRoot: string; servicesRoot: string }): Promise<string> {
  const target = documentPath(input.workspaceRoot);
  await mkdir(path.dirname(target), { recursive: true });
  return await withCrossProcessFileLock(`${target}.lock`, async () => {
    try {
      const info = await lstat(target);
      if (!info.isFile() || info.isSymbolicLink()) throw new Error("workspace authority is invalid");
      const existing = JSON.parse(await readFile(target, "utf8")) as unknown;
      if (valid(existing, input.workspaceRoot)) return existing.workspaceId;
      if (legacyValid(existing, input.workspaceRoot)) {
        const migrated: WorkspaceAuthorityDocument = {
          schema: SCHEMA, version: 1, workspaceId: existing.workspaceId,
          canonicalWorkspaceRoot: path.resolve(input.workspaceRoot),
        };
        const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
        await writeFile(temporary, `${JSON.stringify(migrated)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
        await rename(temporary, target);
        return migrated.workspaceId;
      }
      throw new Error("workspace authority is invalid");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const authority: WorkspaceAuthorityDocument = {
      schema: SCHEMA, version: 1, workspaceId: `wsa_${randomUUID().replaceAll("-", "")}`,
      canonicalWorkspaceRoot: path.resolve(input.workspaceRoot),
    };
    const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(authority)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
    await rename(temporary, target);
    return authority.workspaceId;
  }, { unavailableMessage: "workspace authority is unavailable" });
}

/** Reads only an already-established authority; HTTP routes never mint one. */
export async function readWorkspaceAuthority(input: { workspaceRoot: string; servicesRoot: string }): Promise<string | null> {
  try {
    const target = documentPath(input.workspaceRoot);
    const info = await lstat(target);
    if (!info.isFile() || info.isSymbolicLink()) return null;
    const value = JSON.parse(await readFile(target, "utf8")) as unknown;
    return valid(value, input.workspaceRoot) ? value.workspaceId : null;
  } catch { return null; }
}
