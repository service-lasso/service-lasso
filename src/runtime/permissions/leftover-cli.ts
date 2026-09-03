import {
  enforcePermission,
  inProcessPermissionProfile,
  type PermissionActor,
} from "./enforcement.js";

/**
 * Catalogue of leftover CLI durable mutations (`SPEC-002` `AC-4CC` leftover / `#1224`).
 *
 * Operator CLI already binds the same helper pattern in `operator.ts` and must
 * not be re-wired here. Read-only leftover commands stay unbound.
 */
export type LeftoverCliMutationKind =
  | "install"
  | "setup-run"
  | "updates-download"
  | "updates-install"
  | "recovery-doctor"
  | "backup-create"
  | "secrets-broker-backup"
  | "secrets-broker-restore"
  | "lockfile-generate"
  | "services-import"
  | "workspace-start"
  | "workspace-stop"
  | "workspace-restart";

export interface LeftoverCliMutationPolicy {
  permission:
    | "service:install"
    | "service:configure"
    | "service:update"
    | "service:diagnose"
    | "service:start"
    | "service:stop"
    | "service:restart"
    | "workspace:admin";
  routeTemplate: string;
}

const leftoverCliMutationPolicies: Record<LeftoverCliMutationKind, LeftoverCliMutationPolicy> = {
  install: { permission: "service:install", routeTemplate: "install :serviceId" },
  "setup-run": { permission: "service:configure", routeTemplate: "setup run :serviceId" },
  "updates-download": { permission: "service:update", routeTemplate: "updates download :serviceId" },
  "updates-install": { permission: "service:update", routeTemplate: "updates install :serviceId" },
  "recovery-doctor": { permission: "service:diagnose", routeTemplate: "recovery doctor :serviceId" },
  "backup-create": { permission: "workspace:admin", routeTemplate: "backup create" },
  "secrets-broker-backup": { permission: "workspace:admin", routeTemplate: "secrets broker-backup" },
  "secrets-broker-restore": { permission: "workspace:admin", routeTemplate: "secrets broker-restore" },
  "lockfile-generate": { permission: "workspace:admin", routeTemplate: "lockfile generate" },
  "services-import": { permission: "service:install", routeTemplate: "services import" },
  "workspace-start": { permission: "service:start", routeTemplate: "start" },
  "workspace-stop": { permission: "service:stop", routeTemplate: "stop" },
  "workspace-restart": { permission: "service:restart", routeTemplate: "restart" },
};

export interface LeftoverCliMutationGateInput {
  workspaceRoot: string;
  kind: LeftoverCliMutationKind;
  permissionActor?: PermissionActor;
  subject: string;
  serviceId?: string;
}

/**
 * Returns the leftover-CLI permission catalogue entry for one durable mutation.
 *
 * @param kind Canonical leftover CLI mutation kind.
 */
export function getLeftoverCliMutationPolicy(kind: LeftoverCliMutationKind): LeftoverCliMutationPolicy {
  return leftoverCliMutationPolicies[kind];
}

/**
 * Resolves `cli-local-root` unless a test override is supplied, then calls
 * `enforcePermission` before the caller mutates. Interactive leftover CLI
 * commands have no `--confirm` flag, so confirmation is not implied.
 *
 * @param input Workspace, mutation kind, optional test actor, and audit subject.
 */
export async function enforceLeftoverCliMutation(input: LeftoverCliMutationGateInput): Promise<void> {
  const profile = inProcessPermissionProfile("cli-local-root");
  const actor = input.permissionActor ?? profile.actor;
  const policy = leftoverCliMutationPolicies[input.kind];
  await enforcePermission({
    workspaceRoot: input.workspaceRoot,
    actor,
    permission: policy.permission,
    sensitive: false,
    confirmed: false,
    method: "CLI",
    routeTemplate: policy.routeTemplate,
    subject: input.subject,
    serviceId: input.serviceId,
    source: profile.source,
  });
}
