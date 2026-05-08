import type { PlatformRequestContext, ProviderConnectionMetadata } from "./facade.js";
import { assertProviderConnectionMetadataOnly, authorizePlatformResource } from "./facade.js";

export type ProviderConnectionLifecycleStatus =
  | "connected"
  | "expiring"
  | "refresh_failed"
  | "reconnect_required"
  | "revoked"
  | "permission_changed"
  | "disabled"
  | "source_auth_required"
  | "degraded";

export type ProviderConnectionLifecycleAction = "connect" | "reconnect" | "refresh" | "test" | "disable" | "disconnect";

export type ProviderLifecycleErrorCode =
  | "setup-needed"
  | "provider-unavailable"
  | "permission-denied"
  | "source-auth-required"
  | "connection-not-found"
  | "action-not-implemented";

export type ProviderConnectionLifecycleError = {
  code: ProviderLifecycleErrorCode;
  message: string;
  action: string;
  provider: string;
  retryable: boolean;
  documentationRef?: string;
};

export type ProviderConnectionLifecycleAuditEvent = {
  id: string;
  workspaceId: string;
  connectionId: string;
  provider: string;
  action: ProviderConnectionLifecycleAction;
  fromStatus?: ProviderConnectionLifecycleStatus;
  toStatus: ProviderConnectionLifecycleStatus;
  outcome: "success" | "denied" | "unavailable" | "setup-needed";
  at: string;
  actorUserId: string;
  safeDetail: string;
};

export type ProviderConnectionLifecycleFixture = {
  connection: ProviderConnectionMetadata;
  lifecycleStatus: ProviderConnectionLifecycleStatus;
  expectedAction: ProviderConnectionLifecycleAction;
  nextActionLabel: string;
  lastAuditEvent: ProviderConnectionLifecycleAuditEvent;
  safeError?: ProviderConnectionLifecycleError;
};

export type ProviderLifecycleActionRequest = {
  action: ProviderConnectionLifecycleAction;
  connectionId: string;
  provider: string;
  requestedAt: string;
};

export type ProviderLifecycleActionResponse = {
  connectionId: string;
  provider: string;
  action: ProviderConnectionLifecycleAction;
  status: ProviderConnectionLifecycleStatus;
  ok: boolean;
  auditEvent: ProviderConnectionLifecycleAuditEvent;
  error?: ProviderConnectionLifecycleError;
};

export const providerConnectionLifecycleEndpoints = {
  connect: "POST /api/platform/workspaces/{workspaceId}/provider-connections/{connectionId}/connect",
  reconnect: "POST /api/platform/workspaces/{workspaceId}/provider-connections/{connectionId}/reconnect",
  refresh: "POST /api/platform/workspaces/{workspaceId}/provider-connections/{connectionId}/refresh",
  test: "POST /api/platform/workspaces/{workspaceId}/provider-connections/{connectionId}/test",
  disable: "POST /api/platform/workspaces/{workspaceId}/provider-connections/{connectionId}/disable",
  disconnect: "POST /api/platform/workspaces/{workspaceId}/provider-connections/{connectionId}/disconnect",
} as const;

const now = "2026-05-08T11:05:00Z";

export const providerConnectionLifecycleFixtures: Record<
  "healthy" | "missing" | "denied" | "reconnectRequired",
  ProviderConnectionLifecycleFixture
> = {
  healthy: {
    connection: {
      id: "pc_github_ready",
      workspaceId: "wks_local_demo",
      ownerUserId: "usr_01hzy9operator",
      provider: "github",
      kind: "oauth",
      displayName: "GitHub ready connection",
      status: "ready",
      scopes: ["repo:read", "workflow:read"],
      brokerNamespace: "workspaces/local-demo/provider-connections/github",
      secretRef: "provider.github.oauth.client",
      lastVerifiedAt: now,
      createdAt: "2026-05-08T10:00:00Z",
      updatedAt: now,
      secretMaterialPresent: false,
    },
    lifecycleStatus: "connected",
    expectedAction: "test",
    nextActionLabel: "Test connection",
    lastAuditEvent: {
      id: "audit_provider_ready_001",
      workspaceId: "wks_local_demo",
      connectionId: "pc_github_ready",
      provider: "github",
      action: "test",
      fromStatus: "connected",
      toStatus: "connected",
      outcome: "success",
      at: now,
      actorUserId: "usr_01hzy9operator",
      safeDetail: "Provider metadata check succeeded; no provider credential values returned.",
    },
  },
  missing: {
    connection: {
      id: "pc_slack_missing",
      workspaceId: "wks_local_demo",
      ownerUserId: "usr_01hzy9operator",
      provider: "slack",
      kind: "oauth",
      displayName: "Slack setup required",
      status: "needs-auth",
      scopes: ["channels:read"],
      brokerNamespace: "workspaces/local-demo/provider-connections/slack",
      secretRef: "provider.slack.oauth.client",
      createdAt: "2026-05-08T10:00:00Z",
      updatedAt: now,
      secretMaterialPresent: false,
    },
    lifecycleStatus: "source_auth_required",
    expectedAction: "connect",
    nextActionLabel: "Connect provider",
    safeError: {
      code: "setup-needed",
      message: "Provider connection needs operator setup before it can be used.",
      action: "Open the provider setup flow and complete authorization.",
      provider: "slack",
      retryable: true,
      documentationRef: "docs/reference/product-api-facade.md#provider-connection-lifecycle-api",
    },
    lastAuditEvent: {
      id: "audit_provider_missing_001",
      workspaceId: "wks_local_demo",
      connectionId: "pc_slack_missing",
      provider: "slack",
      action: "connect",
      toStatus: "source_auth_required",
      outcome: "setup-needed",
      at: now,
      actorUserId: "usr_01hzy9operator",
      safeDetail: "Provider authorization is not configured; no provider credential values returned.",
    },
  },
  denied: {
    connection: {
      id: "pc_stripe_denied",
      workspaceId: "wks_local_demo",
      ownerUserId: "usr_01hzy9operator",
      provider: "stripe",
      kind: "api-token",
      displayName: "Stripe denied connection",
      status: "error",
      scopes: ["charges:read"],
      brokerNamespace: "workspaces/local-demo/provider-connections/stripe",
      secretRef: "provider.stripe.api.client",
      createdAt: "2026-05-08T10:00:00Z",
      updatedAt: now,
      secretMaterialPresent: false,
    },
    lifecycleStatus: "permission_changed",
    expectedAction: "reconnect",
    nextActionLabel: "Reconnect with required scopes",
    safeError: {
      code: "permission-denied",
      message: "Provider rejected the requested scope set.",
      action: "Reconnect the provider with the required scopes or update workflow requirements.",
      provider: "stripe",
      retryable: true,
      documentationRef: "docs/reference/product-api-facade.md#authorization-boundaries",
    },
    lastAuditEvent: {
      id: "audit_provider_denied_001",
      workspaceId: "wks_local_demo",
      connectionId: "pc_stripe_denied",
      provider: "stripe",
      action: "test",
      fromStatus: "connected",
      toStatus: "permission_changed",
      outcome: "denied",
      at: now,
      actorUserId: "usr_01hzy9operator",
      safeDetail: "Provider metadata check reported insufficient scope; credential values were not returned.",
    },
  },
  reconnectRequired: {
    connection: {
      id: "pc_calendar_reconnect",
      workspaceId: "wks_local_demo",
      ownerUserId: "usr_01hzy9operator",
      provider: "google-calendar",
      kind: "oauth",
      displayName: "Calendar reconnect required",
      status: "needs-auth",
      scopes: ["calendar:read"],
      brokerNamespace: "workspaces/local-demo/provider-connections/google-calendar",
      secretRef: "provider.google-calendar.oauth.client",
      lastVerifiedAt: "2026-05-08T09:55:00Z",
      createdAt: "2026-05-08T10:00:00Z",
      updatedAt: now,
      secretMaterialPresent: false,
    },
    lifecycleStatus: "reconnect_required",
    expectedAction: "reconnect",
    nextActionLabel: "Reconnect provider",
    safeError: {
      code: "source-auth-required",
      message: "Provider authorization must be refreshed before workflows can use this connection.",
      action: "Start the reconnect flow and retry the workflow after authorization succeeds.",
      provider: "google-calendar",
      retryable: true,
      documentationRef: "docs/reference/product-api-facade.md#provider-connection-lifecycle-api",
    },
    lastAuditEvent: {
      id: "audit_provider_reconnect_001",
      workspaceId: "wks_local_demo",
      connectionId: "pc_calendar_reconnect",
      provider: "google-calendar",
      action: "refresh",
      fromStatus: "expiring",
      toStatus: "reconnect_required",
      outcome: "unavailable",
      at: now,
      actorUserId: "usr_01hzy9operator",
      safeDetail: "Provider refresh failed with source authorization required; no refresh payload returned.",
    },
  },
};

export function normalizeProviderConnectionLifecycleStatus(input: {
  metadataStatus?: ProviderConnectionMetadata["status"];
  sourceState?: string;
  expiresAt?: string;
  scopesChanged?: boolean;
  lastRefreshFailed?: boolean;
}): ProviderConnectionLifecycleStatus {
  if (input.metadataStatus === "disabled") return "disabled";
  if (input.metadataStatus === "revoked") return "revoked";
  if (input.sourceState === "auth-required" || input.metadataStatus === "needs-auth") return "source_auth_required";
  if (input.scopesChanged) return "permission_changed";
  if (input.lastRefreshFailed) return "refresh_failed";
  if (input.sourceState === "degraded" || input.metadataStatus === "error") return "degraded";
  if (input.expiresAt && Date.parse(input.expiresAt) <= Date.parse("2026-05-09T00:00:00Z")) return "expiring";
  return "connected";
}

export function createProviderLifecycleUnavailableResponse(
  context: PlatformRequestContext,
  fixture: ProviderConnectionLifecycleFixture,
  request: ProviderLifecycleActionRequest,
): ProviderLifecycleActionResponse {
  assertProviderConnectionMetadataOnly(fixture.connection);
  const decision = authorizePlatformResource(context, { kind: "provider-connection", connection: fixture.connection });
  const safeError = fixture.safeError ?? {
    code: "action-not-implemented" as const,
    message: "Provider-specific lifecycle flow is not implemented yet.",
    action: "Use the provider setup documentation or retry after this provider flow is enabled.",
    provider: request.provider,
    retryable: false,
    documentationRef: "docs/reference/product-api-facade.md#provider-connection-lifecycle-api",
  };

  if (!decision.allowed && decision.reason !== "connection-not-ready") {
    return {
      connectionId: request.connectionId,
      provider: request.provider,
      action: request.action,
      status: fixture.lifecycleStatus,
      ok: false,
      auditEvent: {
        ...fixture.lastAuditEvent,
        id: `${fixture.lastAuditEvent.id}_denied`,
        action: request.action,
        outcome: "denied",
        actorUserId: context.userId,
        safeDetail: `Lifecycle action denied: ${decision.reason}.`,
      },
      error: {
        code: "permission-denied",
        message: "Requester is not authorized to use this provider connection.",
        action: "Request provider-connection:use in the target workspace or switch workspace context.",
        provider: request.provider,
        retryable: false,
        documentationRef: "docs/reference/product-api-facade.md#authorization-boundaries",
      },
    };
  }

  return {
    connectionId: request.connectionId,
    provider: request.provider,
    action: request.action,
    status: fixture.lifecycleStatus,
    ok: fixture.lifecycleStatus === "connected",
    auditEvent: {
      ...fixture.lastAuditEvent,
      action: request.action,
      actorUserId: context.userId,
    },
    error: fixture.lifecycleStatus === "connected" ? undefined : safeError,
  };
}

const secretLikePayloadPattern = /(sk-[a-z0-9]{8,}|ghp_[a-z0-9]{8,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|correct-horse-battery-staple|raw-provider-secret|refresh-token|access-token|recovery phrase|client_secret=)/i;

export function assertProviderLifecyclePayloadSecretSafe(payload: unknown): void {
  const serialized = JSON.stringify(payload);
  if (secretLikePayloadPattern.test(serialized)) {
    throw new Error("Provider lifecycle payload contains secret-like material");
  }
}
