import { ensureRuntimeConfig, resolveRuntimeConfig, type RuntimeConfigOptions } from "../config.js";
import {
  mutateOperatorActionItem,
  readOperatorActionQueue,
  type OperatorActionQueueState,
} from "../operator/action-queue.js";

export type OperatorCliAction = "actions";
export type OperatorActionsCliAction = "list" | "acknowledge" | "defer" | "reopen";

export interface OperatorCliOptions extends RuntimeConfigOptions {
  action: OperatorCliAction;
  actionsAction: OperatorActionsCliAction;
  itemId?: string;
  deferredUntil?: string | null;
}

export interface OperatorActionsCliResult {
  action: "actions";
  actionsAction: OperatorActionsCliAction;
  servicesRoot: string;
  workspaceRoot: string;
  queue: OperatorActionQueueState;
}

export type OperatorCliResult = OperatorActionsCliResult;

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

  return {
    action: "actions",
    actionsAction: options.actionsAction,
    servicesRoot: runtimeConfig.servicesRoot,
    workspaceRoot: runtimeConfig.workspaceRoot,
    queue: await mutateOperatorActionItem(
      runtimeConfig.workspaceRoot,
      options.itemId,
      options.actionsAction,
      { deferredUntil: options.deferredUntil ?? null },
    ),
  };
}

