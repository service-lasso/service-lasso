import { ApiError } from "../../server/errors.js";
import { appendAuditEvent } from "../audit/store.js";
import type { RuntimeAuthPolicyStatus } from "../auth/request-policy.js";

export type PermissionActorType =
  | "local-root"
  | "zitadel-user"
  | "local-token"
  | "service-account"
  | "system"
  | "scoped-service";

export interface PermissionActor {
  type: PermissionActorType;
  id: string;
  permissions: string[];
}

export interface PermissionDecisionInput {
  workspaceRoot?: string;
  serviceRoot?: string;
  serviceId?: string;
  actor: unknown;
  permission: string;
  sensitive?: boolean;
  confirmed?: boolean;
  method: string;
  routeTemplate: string;
  subject?: string;
}

export interface PermissionDecision {
  ok: boolean;
  actor: PermissionActor;
  permission: string;
  sensitive: boolean;
  confirmed: boolean;
  reason: string | null;
}

const actorTypeAliases: Record<string, PermissionActorType> = {
  localRoot: "local-root",
  local_root: "local-root",
  localroot: "local-root",
  root: "local-root",
  zitadel: "zitadel-user",
  user: "zitadel-user",
  localToken: "local-token",
  local_token: "local-token",
  service: "service-account",
  serviceAccount: "service-account",
  service_account: "service-account",
  scopedService: "scoped-service",
  scoped_service: "scoped-service",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeActorType(value: unknown): PermissionActorType | null {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }
  const normalized = value.trim();
  if (
    normalized === "local-root" ||
    normalized === "zitadel-user" ||
    normalized === "local-token" ||
    normalized === "service-account" ||
    normalized === "system" ||
    normalized === "scoped-service"
  ) {
    return normalized;
  }
  return actorTypeAliases[normalized] ?? null;
}

function normalizePermissionList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    .map((entry) => entry.trim());
}

/**
 * Maps a trusted request-policy actor onto the permission actor used by
 * durable HTTP enforcement. JSON bodies must not supply this value.
 *
 * `local-root` and explicit `local-token` are owner-equivalent. ZITADEL grants
 * come only from the role claims normalized by the trusted request boundary;
 * unmapped roles therefore still fail closed. System and service-account
 * actors are in-process only.
 */
export function permissionActorFromRuntimeAuth(auth: RuntimeAuthPolicyStatus): PermissionActor {
  if (!auth.actor.authenticated || auth.actor.kind === null || auth.actor.actorId === null) {
    throw new ApiError("actor_required", 401, "Durable action requests require an actor.");
  }

  if (auth.actor.kind === "local-root") {
    return {
      type: "local-root",
      id: auth.actor.actorId,
      permissions: ["*"],
    };
  }

  if (auth.actor.kind === "local-token") {
    return {
      type: "local-token",
      id: auth.actor.actorId,
      permissions: ["*"],
    };
  }

  return {
    type: "zitadel-user",
    id: auth.actor.actorId,
    permissions: [...auth.actor.permissions],
  };
}

/**
 * Parses a caller-supplied actor object for in-process enforcement.
 * HTTP durable routes must not pass JSON-body actors through this helper.
 */
export function resolvePermissionActor(input: unknown): PermissionActor {
  if (typeof input === "string" && input.trim().length > 0) {
    const actorId = input.trim();
    return {
      type: "local-root",
      id: actorId,
      permissions: ["*"],
    };
  }

  if (!isRecord(input)) {
    throw new ApiError("actor_required", 401, "Durable action requests require an actor.");
  }

  const type = normalizeActorType(input.type ?? input.source);
  const id = typeof input.id === "string" && input.id.trim()
    ? input.id.trim()
    : typeof input.actorId === "string" && input.actorId.trim()
      ? input.actorId.trim()
      : null;
  if (!type || !id) {
    throw new ApiError("actor_required", 401, "Durable action requests require an actor type and id.");
  }

  return {
    type,
    id,
    permissions: type === "local-root" ? ["*"] : normalizePermissionList(input.permissions),
  };
}

export function actorHasPermission(actor: PermissionActor, permission: string): boolean {
  return actor.permissions.includes("*") || actor.permissions.includes(permission);
}

/**
 * Allows or denies a durable action before execution, then records a
 * metadata-only permission.decision audit event. Callers must pass a trusted
 * actor: HTTP uses permissionActorFromRuntimeAuth, in-process callers pass an
 * explicit system or service-account actor.
 */
export async function enforcePermission(input: PermissionDecisionInput): Promise<PermissionDecision> {
  const actor = resolvePermissionActor(input.actor);
  const sensitive = input.sensitive === true;
  const confirmed = input.confirmed === true;
  let reason: string | null = null;

  if (!actorHasPermission(actor, input.permission)) {
    reason = "permission_not_granted";
  } else if (sensitive && !confirmed) {
    reason = "confirmation_required";
  }

  const decision: PermissionDecision = {
    ok: reason === null,
    actor,
    permission: input.permission,
    sensitive,
    confirmed,
    reason,
  };

  await appendAuditEvent({
    workspaceRoot: input.serviceRoot ? undefined : input.workspaceRoot,
    serviceRoot: input.serviceRoot,
    source: "runtime-api",
    action: "permission.decision",
    actor: actor.id,
    subject: input.subject ?? input.permission,
    serviceId: input.serviceId,
    method: input.method,
    routeTemplate: input.routeTemplate,
    outcome: decision.ok ? "success" : "failure",
    statusCode: decision.ok ? 200 : reason === "confirmation_required" ? 409 : 403,
    summary: decision.ok
      ? `Permission ${input.permission} allowed for ${actor.type}.`
      : `Permission ${input.permission} denied for ${actor.type}.`,
    reason,
    metadata: {
      actorType: actor.type,
      permission: input.permission,
      sensitive,
      confirmed,
    },
  });

  if (reason === "permission_not_granted") {
    throw new ApiError("permission_denied", 403, `Actor "${actor.id}" is not granted "${input.permission}".`);
  }
  if (reason === "confirmation_required") {
    throw new ApiError("confirmation_required", 409, `Permission "${input.permission}" requires explicit confirmation.`);
  }

  return decision;
}
