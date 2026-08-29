import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const outputPath = process.env.MCP_OPERATION_EVIDENCE_PATH;
const candidateSha = process.env.CANDIDATE_SHA;
if (!outputPath || !candidateSha || !/^[0-9a-f]{40}$/u.test(candidateSha)) {
  throw new Error("MCP operation evidence requires a bounded output path and exact candidate SHA.");
}
const evidenceRoot = path.resolve(process.cwd(), "artifacts");
const resolvedOutputPath = path.resolve(outputPath);
const relativeOutputPath = path.relative(evidenceRoot, resolvedOutputPath);
if (!relativeOutputPath || relativeOutputPath.startsWith("..") || path.isAbsolute(relativeOutputPath)) {
  throw new Error("MCP operation evidence output must stay inside the artifacts directory.");
}

const evidence = {
  contractVersion: "service-lasso.mcp-operation-evidence.v1",
  issue: 863,
  spec: "SPEC-006 AC-6F",
  repository: process.env.GITHUB_REPOSITORY ?? "local",
  workflowRunId: process.env.GITHUB_RUN_ID ?? "local",
  workflowRunAttempt: process.env.GITHUB_RUN_ATTEMPT ?? "local",
  eventName: process.env.GITHUB_EVENT_NAME ?? "local",
  candidateSha,
  platform: process.platform,
  architecture: process.arch,
  nodeVersion: process.version,
  testCommand: "npm test",
  assertions: [
    "bounded request budget with durable accepted operation identifiers",
    "strict operation status list and cancellation contracts",
    "supported request and explicit tool cancellation with deterministic terminal state",
    "explicit unsupported and too-late cancellation outcomes",
    "actor and workspace isolation with Administrator override",
    "client disconnect survival and exactly-once idempotent replay",
    "runtime restart reconciliation through the shared facade snapshot",
    "bounded retention capacity and deterministic cleanup",
    "shared guarded-action and operation Audit correlation",
    "secret credential configuration path raw-output and unsafe-error exclusion",
    "MCP Tasks independent durable domain model",
  ],
  generatedAt: new Date().toISOString(),
};

await mkdir(path.dirname(resolvedOutputPath), { recursive: true });
await writeFile(resolvedOutputPath, `${JSON.stringify(evidence, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
