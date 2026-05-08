export type PlatformUserStatus = "active" | "disabled" | "pending";
export type PlatformWorkspaceStatus = "active" | "suspended" | "archived";
export type LinkedIdentityProvider = "zitadel" | "github" | "google" | "telegram" | "custom-oidc";
export type ProviderConnectionKind = "oauth" | "api-token" | "webhook" | "secrets-broker-source" | "custom";
export type ProviderConnectionStatus = "ready" | "needs-auth" | "expiring" | "refresh-failed" | "revoked" | "disabled" | "error" | "deleted";
export type PlatformEntitlement =
  | "workspace:read"
  | "workspace:admin"
  | "secrets-broker-source:read"
  | "secrets-broker-source:write"
  | "secrets-broker-source:use"
  | "secrets-broker:resolve"
  | "workflow:run";

export type PlatformActorKind = "user" | "service";
export type PlatformAuthMethod = "zitadel-session" | "service-identity";
export type PlatformAuthFailureReason =
  | "unauthenticated"
  | "unauthorized"
  | "expired-session"
  | "workspace-mismatch"
  | "service-identity-denied"
  | "disabled-user"
  | "workspace-inactive";

export type PlatformRole = {
  id: string;
  workspaceId: string;
  name: "owner" | "admin" | "developer" | "operator" | "viewer" | string;
  entitlements: PlatformEntitlement[];
};

export type PlatformServiceIdentity = {
  id: string;
  serviceId: string;
  displayName: string;
  instanceIds: string[];
  workspaceIds: string[];
  entitlements: PlatformEntitlement[];
  status: "active" | "disabled";
  createdAt: string;
  updatedAt: string;
};

export type PlatformUser = {
  id: string;
  displayName: string;
  email?: string;
  status: PlatformUserStatus;
  linkedIdentityIds: string[];
  createdAt: string;
  updatedAt: string;
};

export type PlatformWorkspace = {
  id: string;
  slug: string;
  displayName: string;
  status: PlatformWorkspaceStatus;
  ownerUserId: string;
  createdAt: string;
  updatedAt: string;
};

export type LinkedIdentity = {
  id: string;
  provider: LinkedIdentityProvider;
  issuer: string;
  subject: string;
  userId: string;
  workspaceIds: string[];
  claims: {
    email?: string;
    preferredUsername?: string;
    groups?: string[];
  };
  createdAt: string;
  lastSeenAt?: string;
};

export type ProviderConnectionAffectedSummary = {
  serviceIds: string[];
  brokerRefs: string[];
  workflowIds: string[];
};

export type ProviderConnectionMetadata = {
  // Core boundary: this is Secrets Broker source/ref metadata only, not a provider account/auth lifecycle record.
  id: string;
  workspaceId: string;
  ownerUserId: string;
  provider: string;
  kind: ProviderConnectionKind;
  displayName: string;
  status: ProviderConnectionStatus;
  accountId?: string;
  scopes: string[];
  brokerNamespace?: string;
  secretRef?: string;
  expiresAt?: string;
  lastRefreshAt?: string;
  lastVerifiedAt?: string;
  lastError?: string;
  affectedSummary?: ProviderConnectionAffectedSummary;
  createdAt: string;
  updatedAt: string;
  // Metadata only. Secret payloads, access tokens, refresh tokens, API keys,
  // private keys, and recovery material must live behind a broker/source ref.
  secretMaterialPresent: boolean;
};

export type CreateProviderConnectionMetadataRequest = {
  workspaceId: string;
  ownerUserId: string;
  provider: string;
  kind: ProviderConnectionKind;
  displayName: string;
  accountId?: string;
  scopes?: string[];
  brokerNamespace?: string;
  secretRef?: string;
};

export type UpdateProviderConnectionMetadataRequest = Partial<
  Pick<
    ProviderConnectionMetadata,
    | "displayName"
    | "status"
    | "accountId"
    | "scopes"
    | "brokerNamespace"
    | "secretRef"
    | "expiresAt"
    | "lastRefreshAt"
    | "lastVerifiedAt"
    | "lastError"
    | "affectedSummary"
  >
>;

export type ZitadelSessionContext = {
  issuer: string;
  subject: string;
  email?: string;
  preferredUsername?: string;
  groups?: string[];
  expiresAt?: string;
};

export type PlatformAuditActorMetadata = {
  actorKind: PlatformActorKind;
  actorId: string;
  workspaceId: string;
  instanceId: string;
  linkedIdentityId?: string;
  serviceIdentityId?: string;
  authMethod: PlatformAuthMethod;
};

export type PlatformRequestContext = {
  userId: string;
  workspaceId: string;
  instanceId: string;
  linkedIdentityId: string;
  entitlements: PlatformEntitlement[];
  actor: {
    kind: PlatformActorKind;
    id: string;
    displayName: string;
  };
  authMethod: PlatformAuthMethod;
  audit: PlatformAuditActorMetadata;
};

export type PlatformServiceAuthContext = {
  serviceId: string;
  instanceId: string;
  workspaceId: string;
};

export type PlatformContextResolutionRequest =
  | {
      kind: "zitadel-session";
      session?: ZitadelSessionContext;
      workspaceId?: string;
      instanceId: string;
      now?: Date;
    }
  | {
      kind: "service-identity";
      service?: PlatformServiceAuthContext;
      workspaceId: string;
      instanceId: string;
    };

export type PlatformContextResolution =
  | { ok: true; context: PlatformRequestContext }
  | {
      ok: false;
      reason: PlatformAuthFailureReason;
      status: 401 | 403;
      safeMessage: string;
      audit: PlatformAuditActorMetadata | undefined;
    };

export type AuthorizationResource =
  | { kind: "provider-connection"; connection: ProviderConnectionMetadata }
  | { kind: "secrets-broker-ref"; workspaceId: string; brokerNamespace: string; ref: string }
  | { kind: "workflow-run"; workspaceId: string; workflowId: string; requiredProviderConnectionIds?: string[] };

export type AuthorizationDecision = {
  allowed: boolean;
  reason: "allowed" | "missing-entitlement" | "workspace-mismatch" | "connection-not-ready";
  requiredEntitlements: PlatformEntitlement[];
};

export const coreFacadeBoundary = {
  owns: ["service-manager", "secrets-broker"],
  excludes: ["provider-account-lifecycle", "provider-oauth", "oidc-callbacks", "session-token-handling", "raw-secret-material"],
  providerConnectionScope: "secrets-broker-source-metadata-only",
} as const;

export const providerConnectionMetadataEndpoints = {
  list: "GET /api/platform/workspaces/{workspaceId}/provider-connections",
  create: "POST /api/platform/workspaces/{workspaceId}/provider-connections",
  read: "GET /api/platform/workspaces/{workspaceId}/provider-connections/{connectionId}",
  update: "PATCH /api/platform/workspaces/{workspaceId}/provider-connections/{connectionId}",
  delete: "DELETE /api/platform/workspaces/{workspaceId}/provider-connections/{connectionId}",
} as const;

export type PlatformFacadeState = {
  users: PlatformUser[];
  workspaces: PlatformWorkspace[];
  linkedIdentities: LinkedIdentity[];
  roles: PlatformRole[];
  serviceIdentities: PlatformServiceIdentity[];
  providerConnections: ProviderConnectionMetadata[];
};

export const examplePlatformFacadeState = {
  users: [
    {
      id: "usr_01hzy9operator",
      displayName: "Operator Example",
      email: "operator@example.test",
      status: "active",
      linkedIdentityIds: ["lid_zitadel_operator"],
      createdAt: "2026-05-08T10:00:00Z",
      updatedAt: "2026-05-08T10:00:00Z",
    },
  ],
  workspaces: [
    {
      id: "wks_local_demo",
      slug: "local-demo",
      displayName: "Local demo workspace",
      status: "active",
      ownerUserId: "usr_01hzy9operator",
      createdAt: "2026-05-08T10:00:00Z",
      updatedAt: "2026-05-08T10:00:00Z",
    },
  ],
  linkedIdentities: [
    {
      id: "lid_zitadel_operator",
      provider: "zitadel",
      issuer: "http://localhost:8080",
      subject: "zitadel-user-operator",
      userId: "usr_01hzy9operator",
      workspaceIds: ["wks_local_demo"],
      claims: {
        email: "operator@example.test",
        preferredUsername: "operator",
        groups: ["service-lasso-operators"],
      },
      createdAt: "2026-05-08T10:00:00Z",
      lastSeenAt: "2026-05-08T10:05:00Z",
    },
  ],
  roles: [
    {
      id: "role_local_operator",
      workspaceId: "wks_local_demo",
      name: "operator",
      entitlements: [
        "workspace:read",
        "secrets-broker-source:read",
        "secrets-broker-source:use",
        "secrets-broker:resolve",
        "workflow:run",
      ],
    },
  ],
  serviceIdentities: [
    {
      id: "svc_runtime_broker_reader",
      serviceId: "@node",
      displayName: "Node runtime broker reader",
      instanceIds: ["inst_local_demo"],
      workspaceIds: ["wks_local_demo"],
      entitlements: ["workspace:read", "secrets-broker:resolve"],
      status: "active",
      createdAt: "2026-05-08T10:00:00Z",
      updatedAt: "2026-05-08T10:00:00Z",
    },
  ],
  providerConnections: [
    {
      id: "pc_github_actions",
      workspaceId: "wks_local_demo",
      ownerUserId: "usr_01hzy9operator",
      provider: "github",
      kind: "oauth",
      displayName: "GitHub Actions metadata connection",
      status: "ready",
      accountId: "github-org-service-lasso",
      scopes: ["repo:read", "workflow:read"],
      brokerNamespace: "workspaces/local-demo/provider-connections/github",
      secretRef: "provider.github.oauth.client",
      expiresAt: "2026-05-30T00:00:00Z",
      lastRefreshAt: "2026-05-08T10:04:00Z",
      lastVerifiedAt: "2026-05-08T10:05:00Z",
      affectedSummary: {
        serviceIds: ["@serviceadmin"],
        brokerRefs: ["provider.github.oauth.client"],
        workflowIds: ["wf_release_checks"],
      },
      createdAt: "2026-05-08T10:00:00Z",
      updatedAt: "2026-05-08T10:05:00Z",
      secretMaterialPresent: false,
    },
  ],
} as const satisfies PlatformFacadeState;

export type ProviderConnectionMetadataAuditAction = "create" | "read" | "update" | "delete" | "list";

export type ProviderConnectionMetadataAuditEvent = {
  id: string;
  workspaceId: string;
  connectionId?: string;
  provider?: string;
  action: ProviderConnectionMetadataAuditAction;
  outcome: "success" | "denied" | "not-found";
  at: string;
  actorUserId: string;
  safeDetail: string;
};

export type ProviderConnectionMetadataOperationResult =
  | { ok: true; state: PlatformFacadeState; connection?: ProviderConnectionMetadata; connections?: ProviderConnectionMetadata[]; auditEvent: ProviderConnectionMetadataAuditEvent }
  | { ok: false; state: PlatformFacadeState; error: { code: "permission-denied" | "connection-not-found" | "invalid-secret-material"; message: string }; auditEvent: ProviderConnectionMetadataAuditEvent };

export function listProviderConnectionMetadata(
  state: PlatformFacadeState,
  context: PlatformRequestContext,
  workspaceId: string,
  now = "2026-05-08T11:05:00Z",
): ProviderConnectionMetadataOperationResult {
  const denied = authorizeProviderConnectionMetadataAction(context, workspaceId, "secrets-broker-source:read");
  if (denied) return deniedResult(state, context, workspaceId, undefined, undefined, "list", denied, now);
  const connections = state.providerConnections.filter((connection) => connection.workspaceId === workspaceId && connection.status !== "deleted");
  connections.forEach(assertProviderConnectionMetadataOnly);
  return {
    ok: true,
    state,
    connections,
    auditEvent: metadataAudit(context, workspaceId, undefined, undefined, "list", "success", now, "Listed provider connection metadata records."),
  };
}

export function readProviderConnectionMetadata(
  state: PlatformFacadeState,
  context: PlatformRequestContext,
  workspaceId: string,
  connectionId: string,
  now = "2026-05-08T11:05:00Z",
): ProviderConnectionMetadataOperationResult {
  const denied = authorizeProviderConnectionMetadataAction(context, workspaceId, "secrets-broker-source:read");
  if (denied) return deniedResult(state, context, workspaceId, connectionId, undefined, "read", denied, now);
  const connection = state.providerConnections.find((candidate) => candidate.workspaceId === workspaceId && candidate.id === connectionId && candidate.status !== "deleted");
  if (!connection) return notFoundResult(state, context, workspaceId, connectionId, "read", now);
  assertProviderConnectionMetadataOnly(connection);
  return { ok: true, state, connection, auditEvent: metadataAudit(context, workspaceId, connectionId, connection.provider, "read", "success", now, "Read provider connection metadata record.") };
}

export function createProviderConnectionMetadata(
  state: PlatformFacadeState,
  context: PlatformRequestContext,
  request: CreateProviderConnectionMetadataRequest,
  now = "2026-05-08T11:05:00Z",
): ProviderConnectionMetadataOperationResult {
  const denied = authorizeProviderConnectionMetadataAction(context, request.workspaceId, "secrets-broker-source:write");
  if (denied) return deniedResult(state, context, request.workspaceId, undefined, request.provider, "create", denied, now);
  const connection: ProviderConnectionMetadata = {
    id: `pc_${request.provider.replace(/[^a-z0-9]+/gi, "_").toLowerCase()}_${Date.parse(now)}`,
    workspaceId: request.workspaceId,
    ownerUserId: request.ownerUserId,
    provider: request.provider,
    kind: request.kind,
    displayName: request.displayName,
    status: "needs-auth",
    accountId: request.accountId,
    scopes: request.scopes ?? [],
    brokerNamespace: request.brokerNamespace,
    secretRef: request.secretRef,
    affectedSummary: { serviceIds: [], brokerRefs: request.secretRef ? [request.secretRef] : [], workflowIds: [] },
    secretMaterialPresent: false,
    createdAt: now,
    updatedAt: now,
  };
  try {
    assertProviderConnectionPayloadSecretSafe(request);
    assertProviderConnectionMetadataOnly(connection);
  } catch {
    return { ok: false, state, error: { code: "invalid-secret-material", message: "Provider connection metadata request contains secret-like material." }, auditEvent: metadataAudit(context, request.workspaceId, undefined, request.provider, "create", "denied", now, "Rejected provider connection metadata containing secret-like material.") };
  }
  return { ok: true, state: { ...state, providerConnections: [...state.providerConnections, connection] }, connection, auditEvent: metadataAudit(context, request.workspaceId, connection.id, request.provider, "create", "success", now, "Created provider connection metadata record; secret material remains behind broker refs.") };
}

export function updateProviderConnectionMetadata(
  state: PlatformFacadeState,
  context: PlatformRequestContext,
  workspaceId: string,
  connectionId: string,
  patch: UpdateProviderConnectionMetadataRequest,
  now = "2026-05-08T11:05:00Z",
): ProviderConnectionMetadataOperationResult {
  const denied = authorizeProviderConnectionMetadataAction(context, workspaceId, "secrets-broker-source:write");
  if (denied) return deniedResult(state, context, workspaceId, connectionId, undefined, "update", denied, now);
  const index = state.providerConnections.findIndex((candidate) => candidate.workspaceId === workspaceId && candidate.id === connectionId && candidate.status !== "deleted");
  if (index === -1) return notFoundResult(state, context, workspaceId, connectionId, "update", now);
  const connection = { ...state.providerConnections[index], ...patch, updatedAt: now };
  try {
    assertProviderConnectionPayloadSecretSafe(patch);
    assertProviderConnectionMetadataOnly(connection);
  } catch {
    return { ok: false, state, error: { code: "invalid-secret-material", message: "Provider connection metadata patch contains secret-like material." }, auditEvent: metadataAudit(context, workspaceId, connectionId, state.providerConnections[index].provider, "update", "denied", now, "Rejected provider connection metadata patch containing secret-like material.") };
  }
  const providerConnections = state.providerConnections.map((candidate, candidateIndex) => candidateIndex === index ? connection : candidate);
  return { ok: true, state: { ...state, providerConnections }, connection, auditEvent: metadataAudit(context, workspaceId, connectionId, connection.provider, "update", "success", now, "Updated provider connection metadata record without exposing secret material.") };
}

export function deleteProviderConnectionMetadata(
  state: PlatformFacadeState,
  context: PlatformRequestContext,
  workspaceId: string,
  connectionId: string,
  now = "2026-05-08T11:05:00Z",
): ProviderConnectionMetadataOperationResult {
  const denied = authorizeProviderConnectionMetadataAction(context, workspaceId, "secrets-broker-source:write");
  if (denied) return deniedResult(state, context, workspaceId, connectionId, undefined, "delete", denied, now);
  const connection = state.providerConnections.find((candidate) => candidate.workspaceId === workspaceId && candidate.id === connectionId && candidate.status !== "deleted");
  if (!connection) return notFoundResult(state, context, workspaceId, connectionId, "delete", now);
  const providerConnections = state.providerConnections.filter((candidate) => candidate !== connection);
  return { ok: true, state: { ...state, providerConnections }, connection: { ...connection, status: "deleted", updatedAt: now }, auditEvent: metadataAudit(context, workspaceId, connectionId, connection.provider, "delete", "success", now, "Deleted provider connection metadata record; broker secret payload deletion remains a Secrets Broker operation.") };
}

function authorizeProviderConnectionMetadataAction(context: PlatformRequestContext, workspaceId: string, entitlement: PlatformEntitlement): string | undefined {
  if (context.workspaceId !== workspaceId) return "workspace-mismatch";
  if (!context.entitlements.includes(entitlement)) return "missing-entitlement";
  return undefined;
}

function deniedResult(state: PlatformFacadeState, context: PlatformRequestContext, workspaceId: string, connectionId: string | undefined, provider: string | undefined, action: ProviderConnectionMetadataAuditAction, reason: string, now: string): ProviderConnectionMetadataOperationResult {
  return { ok: false, state, error: { code: "permission-denied", message: `Provider connection metadata ${action} denied: ${reason}.` }, auditEvent: metadataAudit(context, workspaceId, connectionId, provider, action, "denied", now, `Provider connection metadata ${action} denied: ${reason}.`) };
}

function notFoundResult(state: PlatformFacadeState, context: PlatformRequestContext, workspaceId: string, connectionId: string, action: ProviderConnectionMetadataAuditAction, now: string): ProviderConnectionMetadataOperationResult {
  return { ok: false, state, error: { code: "connection-not-found", message: "Provider connection metadata record was not found." }, auditEvent: metadataAudit(context, workspaceId, connectionId, undefined, action, "not-found", now, "Provider connection metadata record was not found.") };
}

function metadataAudit(context: PlatformRequestContext, workspaceId: string, connectionId: string | undefined, provider: string | undefined, action: ProviderConnectionMetadataAuditAction, outcome: ProviderConnectionMetadataAuditEvent["outcome"], at: string, safeDetail: string): ProviderConnectionMetadataAuditEvent {
  const audit = { id: `audit_provider_metadata_${action}_${Date.parse(at)}`, workspaceId, connectionId, provider, action, outcome, at, actorUserId: context.userId, safeDetail };
  if (secretLikeValuePattern.test(JSON.stringify(audit))) throw new Error("Provider connection metadata audit must not include secret material");
  return audit;
}

export function resolveServiceLassoRequestContext(
  request: PlatformContextResolutionRequest,
  state: PlatformFacadeState = examplePlatformFacadeState,
): PlatformContextResolution {
  if (request.kind === "zitadel-session") {
    if (!request.session) return authFailure("unauthenticated", "Missing ZITADEL session.", undefined, 401);
    if (isExpired(request.session.expiresAt, request.now)) return authFailure("expired-session", "ZITADEL session expired.", undefined, 401);

    const identity = state.linkedIdentities.find(
      (linkedIdentity) => linkedIdentity.provider === "zitadel" && linkedIdentity.issuer === request.session?.issuer && linkedIdentity.subject === request.session.subject,
    );
    if (!identity) return authFailure("unauthenticated", "ZITADEL subject is not linked to a Service Lasso user.", undefined, 401);

    const user = state.users.find((candidate) => candidate.id === identity.userId);
    if (!user || user.status !== "active") {
      return authFailure(
        "disabled-user",
        "Linked Service Lasso user is not active.",
        safeAudit({ actorKind: "user", actorId: identity.userId, workspaceId: request.workspaceId ?? identity.workspaceIds[0] ?? "unknown", instanceId: request.instanceId, linkedIdentityId: identity.id, authMethod: "zitadel-session" }),
        403,
      );
    }

    const workspaceId = request.workspaceId ?? identity.workspaceIds[0];
    if (!workspaceId || !identity.workspaceIds.includes(workspaceId)) {
      return authFailure(
        "workspace-mismatch",
        "ZITADEL identity is not linked to the requested workspace.",
        safeAudit({ actorKind: "user", actorId: identity.userId, workspaceId: workspaceId ?? "unknown", instanceId: request.instanceId, linkedIdentityId: identity.id, authMethod: "zitadel-session" }),
        403,
      );
    }

    const workspace = state.workspaces.find((candidate) => candidate.id === workspaceId);
    if (!workspace || workspace.status !== "active") {
      return authFailure(
        "workspace-inactive",
        "Requested Service Lasso workspace is not active.",
        safeAudit({ actorKind: "user", actorId: identity.userId, workspaceId, instanceId: request.instanceId, linkedIdentityId: identity.id, authMethod: "zitadel-session" }),
        403,
      );
    }

    const entitlements = state.roles
      .filter((role) => role.workspaceId === workspaceId)
      .flatMap((role) => role.entitlements);

    if (entitlements.length === 0) {
      return authFailure(
        "unauthorized",
        "No Service Lasso role grants access to the requested workspace.",
        safeAudit({ actorKind: "user", actorId: identity.userId, workspaceId, instanceId: request.instanceId, linkedIdentityId: identity.id, authMethod: "zitadel-session" }),
        403,
      );
    }

    const audit = safeAudit({ actorKind: "user", actorId: identity.userId, workspaceId, instanceId: request.instanceId, linkedIdentityId: identity.id, authMethod: "zitadel-session" });
    return {
      ok: true,
      context: {
        userId: identity.userId,
        workspaceId,
        instanceId: request.instanceId,
        linkedIdentityId: identity.id,
        entitlements: [...new Set(entitlements)],
        actor: { kind: "user", id: identity.userId, displayName: user.displayName },
        authMethod: "zitadel-session",
        audit,
      },
    };
  }

  if (!request.service) return authFailure("unauthenticated", "Missing service identity.", undefined, 401);

  const serviceIdentity = state.serviceIdentities.find((identity) => identity.serviceId === request.service?.serviceId);
  const audit = safeAudit({
    actorKind: "service",
    actorId: request.service.serviceId,
    workspaceId: request.workspaceId,
    instanceId: request.instanceId,
    serviceIdentityId: serviceIdentity?.id,
    authMethod: "service-identity",
  });

  if (!serviceIdentity || serviceIdentity.status !== "active") return authFailure("service-identity-denied", "Service identity is not allowed.", audit, 403);
  if (!serviceIdentity.instanceIds.includes(request.service.instanceId) || request.service.instanceId !== request.instanceId) {
    return authFailure("service-identity-denied", "Service identity is not valid for this instance.", audit, 403);
  }
  if (!serviceIdentity.workspaceIds.includes(request.workspaceId) || request.service.workspaceId !== request.workspaceId) {
    return authFailure("workspace-mismatch", "Service identity is not scoped to the requested workspace.", audit, 403);
  }

  const workspace = state.workspaces.find((candidate) => candidate.id === request.workspaceId);
  if (!workspace || workspace.status !== "active") return authFailure("workspace-inactive", "Requested Service Lasso workspace is not active.", audit, 403);

  return {
    ok: true,
    context: {
      userId: serviceIdentity.serviceId,
      workspaceId: request.workspaceId,
      instanceId: request.instanceId,
      linkedIdentityId: serviceIdentity.id,
      entitlements: [...new Set(serviceIdentity.entitlements)],
      actor: { kind: "service", id: serviceIdentity.serviceId, displayName: serviceIdentity.displayName },
      authMethod: "service-identity",
      audit,
    },
  };
}

export function mapZitadelSessionToPlatformContext(
  session: ZitadelSessionContext,
  state: PlatformFacadeState = examplePlatformFacadeState,
): PlatformRequestContext | undefined {
  const resolution = resolveServiceLassoRequestContext({ kind: "zitadel-session", session, instanceId: "inst_local_demo" }, state);
  return resolution.ok ? resolution.context : undefined;
}

export function platformAuditMetadataIncludesSecretMaterial(audit: PlatformAuditActorMetadata): boolean {
  return secretLikeValuePattern.test(JSON.stringify(audit));
}

function authFailure(reason: PlatformAuthFailureReason, safeMessage: string, audit: PlatformAuditActorMetadata | undefined, status: 401 | 403): PlatformContextResolution {
  return { ok: false, reason, status, safeMessage, audit };
}

function safeAudit(audit: PlatformAuditActorMetadata): PlatformAuditActorMetadata {
  if (platformAuditMetadataIncludesSecretMaterial(audit)) throw new Error("Platform audit metadata must not include raw tokens, cookies, session secrets, or provider credentials");
  return audit;
}

function isExpired(expiresAt: string | undefined, now = new Date()): boolean {
  if (!expiresAt) return false;
  const expiry = Date.parse(expiresAt);
  return Number.isFinite(expiry) && expiry <= now.getTime();
}

export function authorizePlatformResource(
  context: PlatformRequestContext,
  resource: AuthorizationResource,
): AuthorizationDecision {
  const requiredEntitlements = requiredEntitlementsForResource(resource);
  const workspaceId = "connection" in resource ? resource.connection.workspaceId : resource.workspaceId;

  if (workspaceId !== context.workspaceId) {
    return { allowed: false, reason: "workspace-mismatch", requiredEntitlements };
  }

  if (!requiredEntitlements.every((entitlement) => context.entitlements.includes(entitlement))) {
    return { allowed: false, reason: "missing-entitlement", requiredEntitlements };
  }

  if (resource.kind === "provider-connection" && resource.connection.status !== "ready") {
    return { allowed: false, reason: "connection-not-ready", requiredEntitlements };
  }

  return { allowed: true, reason: "allowed", requiredEntitlements };
}

function requiredEntitlementsForResource(resource: AuthorizationResource): PlatformEntitlement[] {
  if (resource.kind === "provider-connection") return ["secrets-broker-source:use"];
  if (resource.kind === "secrets-broker-ref") return ["secrets-broker:resolve"];
  return ["workflow:run", "secrets-broker-source:use"];
}

const secretLikeFieldPattern = /(secret|token|apiKey|api_key|privateKey|private_key|password|credential|recoveryMaterial|recovery_material|keyMaterial|key_material)$/i;
const secretLikeValuePattern = /(sk-[a-z0-9]{8,}|ghp_[a-z0-9]{8,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|correct-horse-battery-staple|raw-provider-secret|refresh-token|access-token|recovery phrase)/i;

export function assertProviderConnectionPayloadSecretSafe(payload: unknown): void {
  const serialized = JSON.stringify(payload);
  if (secretLikeFieldPattern.test(serialized) || secretLikeValuePattern.test(serialized)) {
    throw new Error("Provider connection payload contains secret-like material");
  }
}

export function assertProviderConnectionMetadataOnly(connection: ProviderConnectionMetadata): void {
  const entries = Object.entries(connection) as Array<[string, unknown]>;
  for (const [key, value] of entries) {
    if (key === "secretRef" || key === "secretMaterialPresent") continue;
    if (secretLikeFieldPattern.test(key)) {
      throw new Error(`Provider connection metadata must not include secret-like field ${key}`);
    }
    if (typeof value === "string" && secretLikeValuePattern.test(value)) {
      throw new Error(`Provider connection metadata must not include secret-like value in ${key}`);
    }
  }

  if (connection.secretMaterialPresent) {
    throw new Error("Provider connection metadata must not carry raw secret material");
  }
}
