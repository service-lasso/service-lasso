export type PlatformUserStatus = "active" | "disabled" | "pending";
export type PlatformWorkspaceStatus = "active" | "suspended" | "archived";
export type LinkedIdentityProvider = "zitadel" | "github" | "google" | "telegram" | "custom-oidc";
export type ProviderConnectionKind = "oauth" | "api-token" | "webhook" | "secrets-broker-source" | "custom";
export type ProviderConnectionStatus = "ready" | "needs-auth" | "revoked" | "disabled" | "error";
export type PlatformEntitlement =
  | "workspace:read"
  | "workspace:admin"
  | "provider-connection:read"
  | "provider-connection:write"
  | "provider-connection:use"
  | "secrets-broker:resolve"
  | "workflow:run";

export type PlatformRole = {
  id: string;
  workspaceId: string;
  name: "owner" | "admin" | "developer" | "operator" | "viewer" | string;
  entitlements: PlatformEntitlement[];
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

export type ProviderConnectionMetadata = {
  id: string;
  workspaceId: string;
  ownerUserId: string;
  provider: string;
  kind: ProviderConnectionKind;
  displayName: string;
  status: ProviderConnectionStatus;
  scopes: string[];
  brokerNamespace?: string;
  secretRef?: string;
  lastVerifiedAt?: string;
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
  scopes?: string[];
  brokerNamespace?: string;
  secretRef?: string;
};

export type UpdateProviderConnectionMetadataRequest = Partial<
  Pick<
    ProviderConnectionMetadata,
    | "displayName"
    | "status"
    | "scopes"
    | "brokerNamespace"
    | "secretRef"
    | "lastVerifiedAt"
  >
>;

export type ZitadelSessionContext = {
  issuer: string;
  subject: string;
  email?: string;
  preferredUsername?: string;
  groups?: string[];
};

export type PlatformRequestContext = {
  userId: string;
  workspaceId: string;
  linkedIdentityId: string;
  entitlements: PlatformEntitlement[];
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

export const providerConnectionMetadataEndpoints = {
  list: "GET /api/platform/workspaces/{workspaceId}/provider-connections",
  create: "POST /api/platform/workspaces/{workspaceId}/provider-connections",
  read: "GET /api/platform/workspaces/{workspaceId}/provider-connections/{connectionId}",
  update: "PATCH /api/platform/workspaces/{workspaceId}/provider-connections/{connectionId}",
} as const;

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
        "provider-connection:read",
        "provider-connection:use",
        "secrets-broker:resolve",
        "workflow:run",
      ],
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
      scopes: ["repo:read", "workflow:read"],
      brokerNamespace: "workspaces/local-demo/provider-connections/github",
      secretRef: "provider.github.oauth.client",
      lastVerifiedAt: "2026-05-08T10:05:00Z",
      createdAt: "2026-05-08T10:00:00Z",
      updatedAt: "2026-05-08T10:05:00Z",
      secretMaterialPresent: false,
    },
  ],
} as const satisfies {
  users: PlatformUser[];
  workspaces: PlatformWorkspace[];
  linkedIdentities: LinkedIdentity[];
  roles: PlatformRole[];
  providerConnections: ProviderConnectionMetadata[];
};

export function mapZitadelSessionToPlatformContext(
  session: ZitadelSessionContext,
  state = examplePlatformFacadeState,
): PlatformRequestContext | undefined {
  const identity = state.linkedIdentities.find(
    (linkedIdentity) => linkedIdentity.provider === "zitadel" && linkedIdentity.issuer === session.issuer && linkedIdentity.subject === session.subject,
  );
  if (!identity) return undefined;

  const workspaceId = identity.workspaceIds[0];
  if (!workspaceId) return undefined;

  const entitlements = state.roles
    .filter((role) => role.workspaceId === workspaceId)
    .flatMap((role) => role.entitlements);

  return {
    userId: identity.userId,
    workspaceId,
    linkedIdentityId: identity.id,
    entitlements: [...new Set(entitlements)],
  };
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
  if (resource.kind === "provider-connection") return ["provider-connection:use"];
  if (resource.kind === "secrets-broker-ref") return ["secrets-broker:resolve"];
  return ["workflow:run", "provider-connection:use"];
}

const secretLikeFieldPattern = /(secret|token|apiKey|api_key|privateKey|private_key|password|credential|recoveryMaterial|recovery_material|keyMaterial|key_material)$/i;
const secretLikeValuePattern = /(sk-[a-z0-9]{8,}|ghp_[a-z0-9]{8,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|correct-horse-battery-staple|raw-provider-secret|refresh-token|access-token|recovery phrase)/i;

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
