import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { DiscoveredService, ServiceBrokerWritebackOperation } from "../../contracts/service.js";

export const BROKER_IDENTITY_ID_ENV = "SERVICE_LASSO_BROKER_IDENTITY_ID";
export const BROKER_CREDENTIAL_ENV = "SERVICE_LASSO_BROKER_CREDENTIAL";
export const BROKER_CREDENTIAL_EXPIRES_AT_ENV = "SERVICE_LASSO_BROKER_CREDENTIAL_EXPIRES_AT";

const DEFAULT_CREDENTIAL_TTL_MS = 60 * 60 * 1000;

export interface ScopedBrokerIdentityScope {
  namespaces: string[];
  operations: ServiceBrokerWritebackOperation[];
  refs: string[];
}

export interface ScopedBrokerIdentityAuditContext {
  serviceId: string;
  identityId: string;
  issuedAt: string;
  expiresAt: string;
  reason: string | null;
}

export interface ScopedBrokerIdentityMetadata {
  id: string;
  serviceId: string;
  issuedAt: string;
  expiresAt: string;
  revokedAt: string | null;
  scope: ScopedBrokerIdentityScope;
  audit: ScopedBrokerIdentityAuditContext;
}

export interface ScopedBrokerCredential {
  token: string;
  env: Record<string, string>;
  metadata: ScopedBrokerIdentityMetadata;
}

interface ScopedBrokerCredentialRecord {
  tokenHash: string;
  metadata: ScopedBrokerIdentityMetadata;
}

export interface ScopedBrokerWritebackRequest {
  serviceId: string;
  namespace: string;
  ref: string;
  operation: ServiceBrokerWritebackOperation;
  now?: Date;
}

export interface ScopedBrokerWritebackDecision {
  ok: boolean;
  reason: "allowed" | "unknown-credential" | "service-mismatch" | "expired" | "revoked" | "namespace-denied" | "ref-denied" | "operation-denied";
  audit: ScopedBrokerIdentityAuditContext | null;
  identity: ScopedBrokerIdentityMetadata | null;
}

const scopedCredentials = new Map<string, ScopedBrokerCredentialRecord>();
const serviceIdentityIds = new Map<string, Set<string>>();

function hashCredential(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function cloneMetadata(metadata: ScopedBrokerIdentityMetadata): ScopedBrokerIdentityMetadata {
  return {
    id: metadata.id,
    serviceId: metadata.serviceId,
    issuedAt: metadata.issuedAt,
    expiresAt: metadata.expiresAt,
    revokedAt: metadata.revokedAt,
    scope: {
      namespaces: [...metadata.scope.namespaces],
      operations: [...metadata.scope.operations],
      refs: [...metadata.scope.refs],
    },
    audit: { ...metadata.audit },
  };
}

function rememberServiceIdentity(serviceId: string, identityId: string): void {
  const identities = serviceIdentityIds.get(serviceId) ?? new Set<string>();
  identities.add(identityId);
  serviceIdentityIds.set(serviceId, identities);
}

export function serviceNeedsScopedBrokerIdentity(service: DiscoveredService): boolean {
  return service.manifest.broker?.writeback !== undefined;
}

export function mintScopedBrokerIdentity(
  service: DiscoveredService,
  options: { now?: Date; ttlMs?: number } = {},
): ScopedBrokerCredential | null {
  const writeback = service.manifest.broker?.writeback;
  if (!writeback) {
    return null;
  }

  const now = options.now ?? new Date();
  const ttlMs = options.ttlMs ?? DEFAULT_CREDENTIAL_TTL_MS;
  const issuedAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + ttlMs).toISOString();
  const identityId = randomUUID();
  const token = `slb_${randomBytes(32).toString("base64url")}`;
  const allowedOperations = writeback.allowedOperations ?? ["create", "update", "rotate", "delete"];
  const metadata: ScopedBrokerIdentityMetadata = {
    id: identityId,
    serviceId: service.manifest.id,
    issuedAt,
    expiresAt,
    revokedAt: null,
    scope: {
      namespaces: [...(writeback.allowedNamespaces ?? [])],
      operations: [...allowedOperations],
      refs: [...(writeback.allowedRefs ?? [])],
    },
    audit: {
      serviceId: service.manifest.id,
      identityId,
      issuedAt,
      expiresAt,
      reason: writeback.auditReason ?? null,
    },
  };

  scopedCredentials.set(identityId, {
    tokenHash: hashCredential(token),
    metadata,
  });
  rememberServiceIdentity(service.manifest.id, identityId);

  return {
    token,
    metadata: cloneMetadata(metadata),
    env: {
      [BROKER_IDENTITY_ID_ENV]: identityId,
      [BROKER_CREDENTIAL_ENV]: token,
      [BROKER_CREDENTIAL_EXPIRES_AT_ENV]: expiresAt,
    },
  };
}

export function revokeScopedBrokerIdentity(identityId: string, options: { now?: Date } = {}): ScopedBrokerIdentityMetadata | null {
  const record = scopedCredentials.get(identityId);
  if (!record) {
    return null;
  }

  record.metadata.revokedAt = (options.now ?? new Date()).toISOString();
  return cloneMetadata(record.metadata);
}

export function revokeServiceScopedBrokerIdentities(serviceId: string, options: { now?: Date } = {}): ScopedBrokerIdentityMetadata[] {
  const identities = serviceIdentityIds.get(serviceId);
  if (!identities) {
    return [];
  }

  return [...identities]
    .map((identityId) => revokeScopedBrokerIdentity(identityId, options))
    .filter((metadata): metadata is ScopedBrokerIdentityMetadata => metadata !== null);
}

function findCredentialRecord(token: string): ScopedBrokerCredentialRecord | null {
  const tokenHash = hashCredential(token);
  for (const record of scopedCredentials.values()) {
    if (record.tokenHash === tokenHash) {
      return record;
    }
  }
  return null;
}

function isDeniedBySet(scopeValues: string[], value: string): boolean {
  return scopeValues.length > 0 && !scopeValues.includes(value);
}

export function authorizeScopedBrokerWriteback(
  token: string,
  request: ScopedBrokerWritebackRequest,
): ScopedBrokerWritebackDecision {
  const record = findCredentialRecord(token);
  if (!record) {
    return { ok: false, reason: "unknown-credential", audit: null, identity: null };
  }

  const metadata = record.metadata;
  const identity = cloneMetadata(metadata);
  if (metadata.serviceId !== request.serviceId) {
    return { ok: false, reason: "service-mismatch", audit: metadata.audit, identity };
  }
  if (metadata.revokedAt) {
    return { ok: false, reason: "revoked", audit: metadata.audit, identity };
  }
  if ((request.now ?? new Date()).getTime() >= Date.parse(metadata.expiresAt)) {
    return { ok: false, reason: "expired", audit: metadata.audit, identity };
  }
  if (isDeniedBySet(metadata.scope.namespaces, request.namespace)) {
    return { ok: false, reason: "namespace-denied", audit: metadata.audit, identity };
  }
  if (isDeniedBySet(metadata.scope.refs, request.ref)) {
    return { ok: false, reason: "ref-denied", audit: metadata.audit, identity };
  }
  if (isDeniedBySet(metadata.scope.operations, request.operation)) {
    return { ok: false, reason: "operation-denied", audit: metadata.audit, identity };
  }

  return { ok: true, reason: "allowed", audit: metadata.audit, identity };
}

export function resetScopedBrokerIdentities(): void {
  scopedCredentials.clear();
  serviceIdentityIds.clear();
}
