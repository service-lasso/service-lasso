import { execFile } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { promisify } from "node:util";
import type { DiscoveredService, ServiceBrokerAccessOperation, ServiceBrokerWritebackOperation } from "../../contracts/service.js";

export const BROKER_IDENTITY_ID_ENV = "SERVICE_LASSO_BROKER_IDENTITY_ID";
export const BROKER_CREDENTIAL_ENV = "SERVICE_LASSO_BROKER_CREDENTIAL";
export const BROKER_CREDENTIAL_EXPIRES_AT_ENV = "SERVICE_LASSO_BROKER_CREDENTIAL_EXPIRES_AT";
export const BROKER_TRANSPORT_BINDING_KIND_ENV = "SERVICE_LASSO_BROKER_TRANSPORT_BINDING_KIND";
export const BROKER_TRANSPORT_BINDING_SUBJECT_ENV = "SERVICE_LASSO_BROKER_TRANSPORT_BINDING_SUBJECT";
export const BROKER_IDENTITY_LEASE_ENV = "SERVICE_LASSO_BROKER_IDENTITY_LEASE";

const DEFAULT_CREDENTIAL_TTL_MS = 60 * 60 * 1000;
const DEFAULT_WORKSPACE_ID = "local-demo";

const execFileAsync = promisify(execFile);

export type BrokerTransportBindingKind = "unix-uid" | "windows-sid";

export interface BrokerTransportBinding {
  kind: BrokerTransportBindingKind;
  subject: string;
}

export interface ScopedBrokerIdentityScope {
  namespaces: string[];
  operations: ServiceBrokerAccessOperation[];
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
  transportBinding: BrokerTransportBinding | null;
  scope: ScopedBrokerIdentityScope;
  audit: ScopedBrokerIdentityAuditContext;
}

export interface ScopedBrokerCredential {
  token: string;
  env: Record<string, string>;
  metadata: ScopedBrokerIdentityMetadata;
}

export interface SecretsBrokerLaunchLeaseCommand {
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string | undefined>;
}

export interface SecretsBrokerLaunchLeaseIssuer {
  command: SecretsBrokerLaunchLeaseCommand;
  workspaceId?: string;
}

interface SecretsBrokerLaunchLeaseResponse {
  outcome?: string;
  lease?: unknown;
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
    transportBinding: metadata.transportBinding ? { ...metadata.transportBinding } : null,
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
  return (service.manifest.broker?.imports?.length ?? 0) > 0 || service.manifest.broker?.writeback !== undefined;
}

function normalizeTransportBinding(
  binding: BrokerTransportBinding | null | undefined,
): BrokerTransportBinding | null {
  if (!binding) {
    return null;
  }

  const kind = binding.kind.trim().toLowerCase();
  const subject = binding.subject.trim();
  if ((kind !== "unix-uid" && kind !== "windows-sid") || subject === "") {
    return null;
  }

  return { kind, subject };
}

function namespacedRef(namespace: string, ref: string): string {
  const normalizedNamespace = namespace.trim().replace(/\/+$/g, "");
  const normalizedRef = ref.trim().replace(/^\/+/g, "");
  return normalizedNamespace && normalizedRef ? `${normalizedNamespace}/${normalizedRef}` : normalizedRef || normalizedNamespace;
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
}

function collectLaunchLeaseScope(service: DiscoveredService): {
  refs: string[];
  namespaces: string[];
  operations: ServiceBrokerAccessOperation[];
} {
  const imports = service.manifest.broker?.imports ?? [];
  const writeback = service.manifest.broker?.writeback;
  const writebackOperations = writeback?.allowedOperations ?? ["create", "update", "rotate", "delete"];
  const operations = new Set<ServiceBrokerAccessOperation>();
  const namespaces = new Set<string>();
  const refs: string[] = [];

  for (const entry of imports) {
    operations.add("resolve");
    namespaces.add(entry.namespace);
    refs.push(namespacedRef(entry.namespace, entry.ref));
  }

  for (const namespace of writeback?.allowedNamespaces ?? []) {
    namespaces.add(namespace);
  }
  for (const operation of writebackOperations) {
    operations.add(operation);
  }
  for (const namespace of writeback?.allowedNamespaces ?? []) {
    for (const ref of writeback?.allowedRefs ?? []) {
      refs.push(namespacedRef(namespace, ref));
    }
  }

  return {
    refs: uniqueSorted(refs),
    namespaces: uniqueSorted([...namespaces]),
    operations: [...operations].sort(),
  };
}

function buildLaunchLeaseArgs(
  service: DiscoveredService,
  metadata: ScopedBrokerIdentityMetadata,
  workspaceId: string,
): string[] {
  const scope = collectLaunchLeaseScope(service);
  const args = [
    "admin",
    "launch-lease",
    "issue",
    "--service-id",
    service.manifest.id,
    "--workspace-id",
    workspaceId,
    "--jti",
    metadata.id,
    "--issued-at",
    metadata.issuedAt,
    "--expires-at",
    metadata.expiresAt,
  ];

  for (const ref of scope.refs) {
    args.push("--allowed-ref", ref);
  }
  for (const namespace of scope.namespaces) {
    args.push("--allowed-namespace", namespace);
  }
  for (const operation of scope.operations) {
    args.push("--operation", operation);
  }
  if (metadata.transportBinding) {
    args.push("--transport-binding-kind", metadata.transportBinding.kind);
    args.push("--transport-binding-subject", metadata.transportBinding.subject);
  }
  return args;
}

function parseLaunchLeaseResponse(stdout: string): unknown | null {
  let parsed: SecretsBrokerLaunchLeaseResponse;
  try {
    parsed = JSON.parse(stdout) as SecretsBrokerLaunchLeaseResponse;
  } catch {
    return null;
  }
  if (parsed.outcome !== "ready" || parsed.lease === null || typeof parsed.lease !== "object") {
    return null;
  }
  return parsed.lease;
}

async function issueLaunchLease(
  service: DiscoveredService,
  metadata: ScopedBrokerIdentityMetadata,
  issuer: SecretsBrokerLaunchLeaseIssuer | undefined,
): Promise<unknown | null> {
  if (!issuer?.command.command) {
    return null;
  }

  const commandEnv = issuer.command.env ?? process.env;
  if (!commandEnv.SECRETSBROKER_LAUNCH_IDENTITY_SIGNING_KEY && !commandEnv.SECRETSBROKER_API_TOKEN) {
    return null;
  }

  try {
    const { stdout } = await execFileAsync(
      issuer.command.command,
      [
        ...(issuer.command.args ?? []),
        ...buildLaunchLeaseArgs(service, metadata, issuer.workspaceId ?? DEFAULT_WORKSPACE_ID),
      ],
      {
        cwd: issuer.command.cwd,
        env: {
          ...process.env,
          ...issuer.command.env,
        },
        maxBuffer: 1024 * 1024,
        windowsHide: true,
      },
    );
    return parseLaunchLeaseResponse(stdout);
  } catch {
    return null;
  }
}

export function resolveLauncherTransportBinding(
  env: Record<string, string | undefined> = process.env,
): BrokerTransportBinding | null {
  const configured = normalizeTransportBinding({
    kind: (env[BROKER_TRANSPORT_BINDING_KIND_ENV] ?? "") as BrokerTransportBindingKind,
    subject: env[BROKER_TRANSPORT_BINDING_SUBJECT_ENV] ?? "",
  });
  if (configured) {
    return configured;
  }

  if (process.platform !== "win32" && typeof process.getuid === "function") {
    return { kind: "unix-uid", subject: String(process.getuid()) };
  }

  return null;
}

export function mintScopedBrokerIdentity(
  service: DiscoveredService,
  options: { now?: Date; ttlMs?: number; transportBinding?: BrokerTransportBinding | null } = {},
): ScopedBrokerCredential | null {
  const writeback = service.manifest.broker?.writeback;
  if (!serviceNeedsScopedBrokerIdentity(service)) {
    return null;
  }

  const now = options.now ?? new Date();
  const ttlMs = options.ttlMs ?? DEFAULT_CREDENTIAL_TTL_MS;
  const issuedAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + ttlMs).toISOString();
  const identityId = randomUUID();
  const token = `slb_${randomBytes(32).toString("base64url")}`;
  const leaseScope = collectLaunchLeaseScope(service);
  const transportBinding =
    options.transportBinding === undefined
      ? resolveLauncherTransportBinding()
      : normalizeTransportBinding(options.transportBinding);
  const metadata: ScopedBrokerIdentityMetadata = {
    id: identityId,
    serviceId: service.manifest.id,
    issuedAt,
    expiresAt,
    revokedAt: null,
    transportBinding,
    scope: {
      namespaces: writeback ? [...(writeback.allowedNamespaces ?? [])] : leaseScope.namespaces,
      operations: writeback ? [...(writeback.allowedOperations ?? ["create", "update", "rotate", "delete"])] : leaseScope.operations,
      refs: writeback ? [...(writeback.allowedRefs ?? [])] : leaseScope.refs,
    },
    audit: {
      serviceId: service.manifest.id,
      identityId,
      issuedAt,
      expiresAt,
      reason: writeback?.auditReason ?? null,
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
      ...(transportBinding
        ? {
            [BROKER_TRANSPORT_BINDING_KIND_ENV]: transportBinding.kind,
            [BROKER_TRANSPORT_BINDING_SUBJECT_ENV]: transportBinding.subject,
          }
        : {}),
    },
  };
}

export async function issueScopedBrokerIdentity(
  service: DiscoveredService,
  options: {
    now?: Date;
    ttlMs?: number;
    transportBinding?: BrokerTransportBinding | null;
    launchLeaseIssuer?: SecretsBrokerLaunchLeaseIssuer;
  } = {},
): Promise<ScopedBrokerCredential | null> {
  const credential = mintScopedBrokerIdentity(service, options);
  if (!credential) {
    return null;
  }

  const lease = await issueLaunchLease(service, credential.metadata, options.launchLeaseIssuer);
  if (!lease) {
    return credential;
  }

  return {
    ...credential,
    env: {
      ...credential.env,
      [BROKER_IDENTITY_LEASE_ENV]: JSON.stringify(lease),
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
