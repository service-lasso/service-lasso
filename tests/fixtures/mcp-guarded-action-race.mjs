import { appendFile } from "node:fs/promises";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import { invokeMcpGuardedAction } from "../../dist/runtime/operator/mcp-guarded-actions.js";

let body = "";
for await (const chunk of process.stdin) body += chunk.toString("utf8");
const input = JSON.parse(body);

const authorization = {
  actor: {
    kind: "local-token",
    actorId: "mcp-action-actor",
    clientId: "mcp-action-client",
    scopes: [
      "service-lasso:read",
      "service-lasso:lifecycle:write",
      "service-lasso:config:write",
      "service-lasso:update:write",
      "service-lasso:runtime:admin",
    ],
    permissionProfile: "administrator",
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
    clientId: "mcp-action-client",
    scopes: ["service-lasso:read", "service-lasso:lifecycle:write"],
    extra: {},
  },
};

const facade = {
  async preflight(action) {
    return {
      action,
      targets: ["fixture-service"],
      effects: ["apply manifest-owned lifecycle action"],
      executable: true,
      skippedReason: null,
    };
  },
  async execute() {
    await appendFile(input.markerPath, `${process.pid}\n`, "utf8");
    await delay(250);
    return {
      ok: true,
      status: "succeeded",
      targets: ["fixture-service"],
      effects: ["apply manifest-owned lifecycle action"],
      summary: "Guarded child action completed.",
      resultingState: [{ serviceId: "fixture-service", installed: true, configured: true, running: true }],
    };
  },
};

try {
  const result = await invokeMcpGuardedAction({
    workspaceRoot: input.workspaceRoot,
    operatingMode: "guarded",
    authorization,
    facade,
    action: "service_start",
    parameters: input.parameters,
  });
  process.stdout.write(`${JSON.stringify({ status: "fulfilled", result })}\n`);
} catch (error) {
  process.stdout.write(`${JSON.stringify({ status: "rejected", code: error?.code ?? "unknown" })}\n`);
}
