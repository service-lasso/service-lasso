import { McpOperationService } from "../../dist/runtime/operator/mcp-operations.js";

let serializedInput = "";
process.stdin.setEncoding("utf8");
for await (const chunk of process.stdin) serializedInput += chunk;
const input = JSON.parse(serializedInput);
const authorization = {
  actor: {
    kind: "local-token",
    actorId: "atomic-claim-actor",
    clientId: "atomic-claim-client",
    scopes: ["service-lasso:read", "service-lasso:lifecycle:write"],
    permissionProfile: "maintainer",
  },
  oauth: { enabled: false, issuer: null, jwksUri: null, resource: null, audience: null, allowedOrigins: [] },
  authInfo: {
    token: "",
    clientId: "atomic-claim-client",
    scopes: ["service-lasso:read", "service-lasso:lifecycle:write"],
    extra: { actor: { kind: "local-token", actorId: "atomic-claim-actor", clientId: "atomic-claim-client", permissionProfile: "maintainer" } },
  },
};

try {
  const service = new McpOperationService({ workspaceRoot: input.workspaceRoot, requestBudgetMs: 25 });
  const submission = await service.submit({
    authorization,
    action: "service_start",
    targetIds: ["atomic-claim-service"],
    cancellationSupported: false,
    guardedExecutionId: input.guardedExecutionId,
    requestFingerprint: input.requestFingerprint,
    deduplicateByGuardedExecution: true,
    alwaysAccept: true,
    execute: async () => {
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      return {
        contractVersion: "service-lasso-mcp-guarded-action.v1",
        generatedAt: new Date().toISOString(),
        action: "service_start",
        status: "succeeded",
        ok: true,
        correlationId: "mcp-action-atomic-claim",
        preflight: { planId: "mcp-plan-atomic-claim", targets: ["atomic-claim-service"], effects: ["start"], executable: true, skippedReason: null, requiredProfile: "maintainer" },
        confirmation: { required: false, id: null, status: "not_required", expiresAt: null },
        idempotency: { keyId: "mcp-idempotency-atomic-claim", replayed: false },
        summary: "Atomic claim fixture completed.",
        result: { targets: ["atomic-claim-service"], effects: ["start"], resultingState: [] },
        safety: { mutating: true, redacted: true, omittedSensitiveFields: [] },
      };
    },
  });
  if (submission.kind !== "accepted") throw new Error("Atomic claim fixture completed unexpectedly.");
  process.stdout.write(`${JSON.stringify({ operationId: submission.payload.operation.operationId })}\n`);
} catch (error) {
  process.stdout.write(`${JSON.stringify({ error: error?.code ?? "unexpected" })}\n`);
  process.exitCode = 1;
}
