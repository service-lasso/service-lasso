import { createHash, randomBytes } from "node:crypto";
import { withWorkspaceLifecycleLock } from "../process/registry.js";
import {
  RECONCILIATION_CONTEXT_AUTHORITY_POLICY,
  RECONCILIATION_CONTEXT_AUTHORITY_SCHEMA_V2,
  RECONCILIATION_CONTEXT_CUSTODY_POLICY,
  RECONCILIATION_CONTEXT_IDENTITY_POLICY,
  readLifecycleDocument,
  writeLifecycleDocument,
} from "../state/lifecycle-persistence.js";

const AUTHORITY_ID_PATTERN = /^[a-f0-9]{64}$/u;

interface ReconciliationContextAuthority {
  schemaVersion: typeof RECONCILIATION_CONTEXT_AUTHORITY_SCHEMA_V2;
  version: 2;
  authorityId: string;
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

function parseAuthority(value: unknown): ReconciliationContextAuthority | null {
  if (!isRecord(value) || !exactKeys(value, ["authorityDigest", "authorityId", "phase", "schemaVersion", "version"])) return null;
  if (
    value.schemaVersion !== RECONCILIATION_CONTEXT_AUTHORITY_SCHEMA_V2 ||
    value.version !== 2 ||
    typeof value.authorityId !== "string" ||
    !AUTHORITY_ID_PATTERN.test(value.authorityId) ||
    typeof value.authorityDigest !== "string" ||
    !AUTHORITY_ID_PATTERN.test(value.authorityDigest) ||
    value.authorityDigest !== authorityDigest(value.authorityId) ||
    value.phase !== "committed"
  ) return null;
  return {
    schemaVersion: RECONCILIATION_CONTEXT_AUTHORITY_SCHEMA_V2,
    version: 2,
    authorityId: value.authorityId,
    authorityDigest: value.authorityDigest,
    phase: "committed",
  };
}

function authorityDigest(authorityId: string): string {
  return createHash("sha256").update(authorityId, "utf8").digest("hex");
}

/**
 * This is called only while Core creates its server.  A request only consumes
 * the resolved value; it cannot create, replace, or recover identity state.
 */
export async function initializeReconciliationContextIdentity(workspaceRoot: string): Promise<string> {
  try {
    return await withWorkspaceLifecycleLock(workspaceRoot, async () => {
      const result = await readLifecycleDocument(workspaceRoot, RECONCILIATION_CONTEXT_AUTHORITY_POLICY, {
        parseCurrent: parseAuthority,
        parseLegacy: () => null,
        allowCrashBackup: false,
      });
      if (result.document) return result.document.authorityId;
      if (result.inspection.classification !== "missing") {
        throw new ReconciliationContextIdentityError();
      }
      // The split v1 pair must never be silently adopted or replaced.  Even a
      // semantically matching pair cannot prove it was not interrupted.
      const [legacyIdentity, legacyCustody] = await Promise.all([
        readLifecycleDocument(workspaceRoot, RECONCILIATION_CONTEXT_IDENTITY_POLICY, {
          parseCurrent: () => null,
          parseLegacy: () => null,
          allowCrashBackup: false,
        }),
        readLifecycleDocument(workspaceRoot, RECONCILIATION_CONTEXT_CUSTODY_POLICY, {
          parseCurrent: () => null,
          parseLegacy: () => null,
          allowCrashBackup: false,
        }),
      ]);
      if (legacyIdentity.inspection.classification !== "missing" || legacyCustody.inspection.classification !== "missing") {
        throw new ReconciliationContextIdentityError();
      }
      const authorityId = randomBytes(32).toString("hex");
      const nextAuthority: ReconciliationContextAuthority = {
        schemaVersion: RECONCILIATION_CONTEXT_AUTHORITY_SCHEMA_V2,
        version: 2,
        authorityId,
        authorityDigest: authorityDigest(authorityId),
        phase: "committed",
      };
      await writeLifecycleDocument(workspaceRoot, RECONCILIATION_CONTEXT_AUTHORITY_POLICY, nextAuthority, {
        parseCurrent: parseAuthority,
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
