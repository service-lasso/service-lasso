import { McpOperationService } from "../../dist/runtime/operator/mcp-operations.js";
import {
  guardedActionExecutionId,
  invokeMcpGuardedAction,
} from "../../dist/runtime/operator/mcp-guarded-actions.js";

let serializedInput = "";
process.stdin.setEncoding("utf8");
for await (const chunk of process.stdin) serializedInput += chunk;
const input = JSON.parse(serializedInput);
const authorization = {
  actor: {
    kind: "local-token",
    actorId: "detached-actor",
    clientId: "detached-client",
    scopes: ["service-lasso:read", "service-lasso:update:write"],
    permissionProfile: "maintainer",
  },
  oauth: {
    enabled: false,
    issuer: null,
    jwksUri: null,
    resource: null,
    audience: null,
    allowedOrigins: [],
  },
  authInfo: {
    token: "",
    clientId: "detached-client",
    scopes: ["service-lasso:read", "service-lasso:update:write"],
    extra: {
      actor: {
        kind: "local-token",
        actorId: "detached-actor",
        clientId: "detached-client",
        permissionProfile: "maintainer",
      },
    },
  },
};

const service = new McpOperationService({
  workspaceRoot: input.workspaceRoot,
  requestBudgetMs: 25,
  retentionMs: input.retentionMs,
});
const idempotencyKey = "detached-operation-key-01";
const action = input.action ?? "update_download";
const submission = await service.submit({
  authorization,
  action,
  targetIds: ["fixture-service"],
  cancellationSupported: input.cancellationSupported ?? true,
  guardedExecutionId: input.authoritativeGuardedResult
    ? guardedActionExecutionId(authorization.actor.actorId, authorization.actor.clientId, idempotencyKey)
    : null,
  execute: async (_signal, _progress, correlationId) => {
    if (input.authoritativeGuardedResult) {
      await invokeMcpGuardedAction({
        workspaceRoot: input.workspaceRoot,
        operatingMode: "guarded",
        authorization,
        action,
        correlationId,
        parameters: {
          serviceId: "fixture-service",
          execute: true,
          idempotencyKey,
        },
        facade: {
          async preflight(requestedAction, parameters) {
            return {
              action: requestedAction,
              targets: [parameters.serviceId],
              effects: ["perform authoritative detached fixture work"],
              executable: true,
              skippedReason: null,
            };
          },
          async execute(requestedAction, parameters) {
            return {
              ok: true,
              status: "succeeded",
              targets: [parameters.serviceId],
              effects: ["perform authoritative detached fixture work"],
              summary: `${requestedAction} completed authoritatively.`,
              resultingState: [{
                serviceId: parameters.serviceId,
                installed: true,
                configured: true,
                running: false,
              }],
            };
          },
        },
      }).catch((error) => {
        process.stderr.write(`${error?.code ?? error?.name ?? "Error"}: ${error?.message ?? "unknown"}\n`);
        throw error;
      });
    }
    return await new Promise(() => {});
  },
});
if (submission.kind !== "accepted") throw new Error("Detached fixture operation completed unexpectedly.");
process.stdout.write(`${JSON.stringify({
  operationId: submission.payload.operation.operationId,
  expiresAt: submission.payload.operation.expiresAt,
})}\n`);
