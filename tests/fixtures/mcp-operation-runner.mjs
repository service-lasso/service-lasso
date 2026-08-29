import { McpOperationService } from "../../dist/runtime/operator/mcp-operations.js";

let serializedInput = "";
process.stdin.setEncoding("utf8");
for await (const chunk of process.stdin) serializedInput += chunk;
const input = JSON.parse(serializedInput);
const authorization = {
  actor: {
    kind: "local-token",
    actorId: "cross-process-actor",
    clientId: "cross-process-runner",
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
    clientId: "cross-process-runner",
    scopes: ["service-lasso:read", "service-lasso:update:write"],
    extra: { actor: { kind: "local-token", actorId: "cross-process-actor", clientId: "cross-process-runner", permissionProfile: "maintainer" } },
  },
};

const service = new McpOperationService({ workspaceRoot: input.workspaceRoot, requestBudgetMs: 25 });
const submission = await service.submit({
  authorization,
  action: "update_check",
  targetIds: ["fixture-service"],
  cancellationSupported: true,
  execute: async (signal) => {
    await new Promise((resolve, reject) => {
      const abort = () => input.completeOnCancel ? resolve() : reject(new Error("runner aborted"));
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
    });
    return {
      contractVersion: "service-lasso-mcp-guarded-action.v1",
      generatedAt: new Date().toISOString(),
      action: "update_check",
      status: "succeeded",
      ok: true,
      correlationId: "mcp-action-cross-process",
      preflight: {
        planId: "mcp-plan-cross-process",
        targets: ["fixture-service"],
        effects: ["check fixture update"],
        executable: true,
        skippedReason: null,
        requiredProfile: "maintainer",
      },
      confirmation: { required: false, id: null, status: "not_required", expiresAt: null },
      idempotency: { keyId: "mcp-idempotency-cross-process", replayed: false },
      summary: "Cross-process fixture completed.",
      result: { targets: ["fixture-service"], effects: ["check fixture update"], resultingState: [] },
      safety: { mutating: true, redacted: true, omittedSensitiveFields: [] },
    };
  },
});
if (submission.kind !== "accepted") throw new Error("Cross-process fixture completed unexpectedly.");
const operationId = submission.payload.operation.operationId;
process.stdout.write(`${JSON.stringify({ operationId })}\n`);

setInterval(() => undefined, 1_000);
await new Promise(() => undefined);
