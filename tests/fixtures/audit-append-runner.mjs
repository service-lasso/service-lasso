import { appendAuditEvent } from "../../dist/runtime/audit/store.js";

let serializedInput = "";
process.stdin.setEncoding("utf8");
for await (const chunk of process.stdin) serializedInput += chunk;
const input = JSON.parse(serializedInput);
const waitMs = Math.max(0, input.startAt - Date.now());
if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));

for (let index = 0; index < input.count; index += 1) {
  await appendAuditEvent({
    eventId: `cross-process-${input.runnerId}-${index}`,
    workspaceRoot: input.workspaceRoot,
    source: "test",
    action: "audit.cross-process",
    actor: `runner-${input.runnerId}`,
    subject: `event-${index}`,
    outcome: "success",
    statusCode: 200,
    summary: "Cross-process Audit append fixture.",
    correlationId: `audit-runner-${input.runnerId}-${index}`,
  });
}

process.stdout.write(`${JSON.stringify({ runnerId: input.runnerId, count: input.count })}\n`);
