import { createHash, randomBytes } from "node:crypto";
import { lstat } from "node:fs/promises";
import path from "node:path";
import { withWorkspaceLifecycleLock } from "../process/registry.js";
import {
  RECONCILIATION_CONTEXT_CUSTODY_POLICY,
  RECONCILIATION_CONTEXT_CUSTODY_SCHEMA_V1,
  RECONCILIATION_CONTEXT_IDENTITY_POLICY,
  RECONCILIATION_CONTEXT_IDENTITY_SCHEMA_V1,
  readLifecycleDocument,
  writeLifecycleDocument,
} from "../state/lifecycle-persistence.js";

const AUTHORITY_ID_PATTERN = /^[a-f0-9]{64}$/u;

interface ReconciliationContextIdentity {
  schemaVersion: typeof RECONCILIATION_CONTEXT_IDENTITY_SCHEMA_V1;
  version: 1;
  authorityId: string;
}

interface ReconciliationContextCustody {
  schemaVersion: typeof RECONCILIATION_CONTEXT_CUSTODY_SCHEMA_V1;
  version: 1;
  authorityDigest: string;
  phase: "committed";
}

export class ReconciliationContextIdentityError extends Error {
  constructor() {
    super("Durable reconciliation context identity is unavailable.");
    this.name = "ReconciliationContextIdentityError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  return actual.length === keys.length && actual.every((key, index) => key === keys[index]);
}

function parseIdentity(value: unknown): ReconciliationContextIdentity | null {
  if (!isRecord(value) || !exactKeys(value, ["authorityId", "schemaVersion", "version"])) return null;
  if (
    value.schemaVersion !== RECONCILIATION_CONTEXT_IDENTITY_SCHEMA_V1 ||
    value.version !== 1 ||
    typeof value.authorityId !== "string" ||
    !AUTHORITY_ID_PATTERN.test(value.authorityId)
  ) return null;
  return { schemaVersion: RECONCILIATION_CONTEXT_IDENTITY_SCHEMA_V1, version: 1, authorityId: value.authorityId };
}

function parseCustody(value: unknown): ReconciliationContextCustody | null {
  if (!isRecord(value) || !exactKeys(value, ["authorityDigest", "phase", "schemaVersion", "version"])) return null;
  if (
    value.schemaVersion !== RECONCILIATION_CONTEXT_CUSTODY_SCHEMA_V1 ||
    value.version !== 1 ||
    typeof value.authorityDigest !== "string" ||
    !AUTHORITY_ID_PATTERN.test(value.authorityDigest) ||
    value.phase !== "committed"
  ) return null;
  return {
    schemaVersion: RECONCILIATION_CONTEXT_CUSTODY_SCHEMA_V1,
    version: 1,
    authorityDigest: value.authorityDigest,
    phase: "committed",
  };
}

function authorityDigest(authorityId: string): string {
  return createHash("sha256").update(authorityId, "utf8").digest("hex");
}

async function stateDirectoryExists(workspaceRoot: string): Promise<boolean> {
  try {
    return (await lstat(path.join(path.resolve(workspaceRoot), ".service-lasso"))).isDirectory();
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
}

/**
 * This is called only while Core creates its server.  A request only consumes
 * the resolved value; it cannot create, replace, or recover identity state.
 */
export async function initializeReconciliationContextIdentity(workspaceRoot: string): Promise<string> {
  const stateDirectoryExistedBeforeInitialization = await stateDirectoryExists(workspaceRoot);
  try {
    return await withWorkspaceLifecycleLock(workspaceRoot, async () => {
      const [identityResult, custodyResult] = await Promise.all([
        readLifecycleDocument(workspaceRoot, RECONCILIATION_CONTEXT_IDENTITY_POLICY, {
          parseCurrent: parseIdentity,
          parseLegacy: () => null,
          allowCrashBackup: false,
        }),
        readLifecycleDocument(workspaceRoot, RECONCILIATION_CONTEXT_CUSTODY_POLICY, {
          parseCurrent: parseCustody,
          parseLegacy: () => null,
          allowCrashBackup: false,
        }),
      ]);
      const identity = identityResult.document;
      const custody = custodyResult.document;
      if (identity && custody && custody.authorityDigest === authorityDigest(identity.authorityId)) {
        return identity.authorityId;
      }
      if (
        identityResult.inspection.classification !== "missing" ||
        custodyResult.inspection.classification !== "missing" ||
        stateDirectoryExistedBeforeInitialization
      ) {
        throw new ReconciliationContextIdentityError();
      }
      const authorityId = randomBytes(32).toString("hex");
      const nextCustody: ReconciliationContextCustody = {
        schemaVersion: RECONCILIATION_CONTEXT_CUSTODY_SCHEMA_V1,
        version: 1,
        authorityDigest: authorityDigest(authorityId),
        phase: "committed",
      };
      const nextIdentity: ReconciliationContextIdentity = {
        schemaVersion: RECONCILIATION_CONTEXT_IDENTITY_SCHEMA_V1,
        version: 1,
        authorityId,
      };
      await writeLifecycleDocument(workspaceRoot, RECONCILIATION_CONTEXT_CUSTODY_POLICY, nextCustody, {
        parseCurrent: parseCustody,
        parseLegacy: () => null,
        serialize: (document) => document,
      });
      await writeLifecycleDocument(workspaceRoot, RECONCILIATION_CONTEXT_IDENTITY_POLICY, nextIdentity, {
        parseCurrent: parseIdentity,
        parseLegacy: () => null,
        serialize: (document) => document,
      });
      return authorityId;
    });
  } catch (error) {
    if (error instanceof ReconciliationContextIdentityError) throw error;
    throw new ReconciliationContextIdentityError();
  }
}
