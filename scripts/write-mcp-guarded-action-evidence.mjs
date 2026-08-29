import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const outputPath = process.env.MCP_GUARDED_ACTION_EVIDENCE_PATH;
const candidateSha = process.env.CANDIDATE_SHA;
if (!outputPath || !candidateSha || !/^[0-9a-f]{40}$/u.test(candidateSha)) {
  throw new Error("MCP guarded-action evidence requires a bounded output path and exact candidate SHA.");
}
const evidenceRoot = path.resolve(process.cwd(), "artifacts");
const resolvedOutputPath = path.resolve(outputPath);
const relativeOutputPath = path.relative(evidenceRoot, resolvedOutputPath);
if (!relativeOutputPath || relativeOutputPath.startsWith("..") || path.isAbsolute(relativeOutputPath)) {
  throw new Error("MCP guarded-action evidence output must stay inside the artifacts directory.");
}

const evidence = {
  contractVersion: "service-lasso.mcp-guarded-action-evidence.v1",
  issue: 862,
  spec: "SPEC-006 AC-6E",
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
    "guarded tool schemas and annotations",
    "permission profile and action scope matrix",
    "authoritative preflight and shared runtime facade",
    "bound expiring single-use server confirmation and exact update candidate revision",
    "shared supervisor resolution and immediate pre-spawn service provider executable-byte binding including basename and option-file inputs",
    "immediate recursive setup doctor stop-override and update-hook executable-byte binding",
    "post-preUpgrade archive rehash and immutable in-memory extraction with force-aware subprocess effects",
    "durable cross-process exactly-once idempotency with opaque key identifiers",
    "allowed schema-denied policy-denied skipped failed and replayed Audit",
    "terminal Audit outage reconciliation without repeat mutation",
    "bounded synchronous resulting lifecycle state",
    "secret token configuration and path redaction",
  ],
  generatedAt: new Date().toISOString(),
};

await mkdir(path.dirname(resolvedOutputPath), { recursive: true });
await writeFile(resolvedOutputPath, `${JSON.stringify(evidence, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
