import { McpOperationService } from "../../dist/runtime/operator/mcp-operations.js";

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
});
const submission = await service.submit({
  authorization,
  action: input.action ?? "update_download",
  targetIds: ["fixture-service"],
  cancellationSupported: input.cancellationSupported ?? true,
  execute: async () => await new Promise(() => {}),
});
if (submission.kind !== "accepted") throw new Error("Detached fixture operation completed unexpectedly.");
process.stdout.write(`${JSON.stringify({ operationId: submission.payload.operation.operationId })}\n`);
