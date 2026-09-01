import { ensureRuntimeConfig, resolveRuntimeConfig, type RuntimeConfigOptions } from "../config.js";
import {
  mutateOperatorActionItem,
  readOperatorActionQueue,
  type OperatorActionQueueState,
} from "../operator/action-queue.js";
import {
  enforcePermission,
  inProcessPermissionProfile,
  type PermissionActor,
} from "../permissions/enforcement.js";

export type OperatorCliAction = "actions";
export type OperatorActionsCliAction = "list" | "acknowledge" | "defer" | "reopen";

export interface OperatorCliOptions extends RuntimeConfigOptions {
  action: OperatorCliAction;
  actionsAction: OperatorActionsCliAction;
  itemId?: string;
  deferredUntil?: string | null;
  /** Test override. Production CLI mutations use `cli-local-root`. */
  permissionActor?: PermissionActor;
}

export interface OperatorActionsCliResult {
  action: "actions";
  actionsAction: OperatorActionsCliAction;
  servicesRoot: string;
  workspaceRoot: string;
  queue: OperatorActionQueueState;
}

export type OperatorCliResult = OperatorActionsCliResult;

/**
 * Runs bounded operator-action CLI work. List is read-only. Mutations resolve
 * `cli-local-root` through the shared permission helper before the queue write.
 */
export async function runOperatorCliAction(options: OperatorCliOptions): Promise<OperatorCliResult> {
  const runtimeConfig = await ensureRuntimeConfig(
    resolveRuntimeConfig({
      servicesRoot: options.servicesRoot,
      workspaceRoot: options.workspaceRoot,
      version: options.version,
    }),
  );

  if (options.action !== "actions") {
    throw new Error("The operator command currently supports only: actions.");
  }

  if (options.actionsAction === "list") {
    return {
      action: "actions",
      actionsAction: "list",
      servicesRoot: runtimeConfig.servicesRoot,
      workspaceRoot: runtimeConfig.workspaceRoot,
      queue: await readOperatorActionQueue(runtimeConfig.workspaceRoot),
    };
  }

  if (!options.itemId) {
    throw new Error('The "operator actions" mutation commands require an <actionId> argument.');
  }

  const profile = inProcessPermissionProfile("cli-local-root");
  const actor = options.permissionActor ?? profile.actor;
  await enforcePermission({
    workspaceRoot: runtimeConfig.workspaceRoot,
    actor,
    permission: "workspace:admin",
    sensitive: false,
    confirmed: false,
    method: "CLI",
    routeTemplate: "operator actions :action",
    subject: options.actionsAction,
    source: profile.source,
  });

  return {
    action: "actions",
    actionsAction: options.actionsAction,
    servicesRoot: runtimeConfig.servicesRoot,
    workspaceRoot: runtimeConfig.workspaceRoot,
    queue: await mutateOperatorActionItem(
      runtimeConfig.workspaceRoot,
      options.itemId,
      options.actionsAction,
      { deferredUntil: options.deferredUntil ?? null, actor: actor.id },
    ),
  };
}

