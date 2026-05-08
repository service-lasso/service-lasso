import {
  type PlatformRequestContext,
  type ProviderConnectionMetadata,
  authorizePlatformResource,
} from "./facade.js";

export type WorkflowEngineKind = "dagu" | "service-lasso" | "custom";
export type WorkflowFacadeRunStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled" | "cancelling" | "retrying" | "unknown";
export type WorkflowFacadeErrorCode =
  | "workspace-mismatch"
  | "missing-entitlement"
  | "connection-not-ready"
  | "missing-secret"
  | "secret-denied"
  | "workflow-not-found"
  | "run-not-found"
  | "invalid-transition";

export type WorkflowSecretDependencyStatus = "available" | "missing" | "denied";

export type WorkflowSecretDependency = {
  namespace: string;
  ref: string;
  status: WorkflowSecretDependencyStatus;
  required: boolean;
  description?: string;
};

export type WorkflowFacadeDefinition = {
  id: string;
  workspaceId: string;
  packageId: string;
  displayName: string;
  engine: {
    kind: WorkflowEngineKind;
    workflowId: string;
    dagu?: {
      workflowName: string;
    };
  };
  requiredProviderConnectionIds: string[];
  secretDependencies: WorkflowSecretDependency[];
};

export type WorkflowFacadeAuditEvent = {
  id: string;
  at: string;
  actorUserId: string;
  action: "workflow.run.start" | "workflow.run.cancel" | "workflow.run.retry";
  facadeRunId: string;
  engineRunId?: string;
  workflowId: string;
  workspaceId: string;
  outcome: "accepted" | "denied";
  reason?: WorkflowFacadeErrorCode;
};

export type WorkflowFacadeRun = {
  facadeRunId: string;
  workspaceId: string;
  workflowId: string;
  status: WorkflowFacadeRunStatus;
  engine: {
    kind: WorkflowEngineKind;
    runId: string;
    status: string;
    dagu?: {
      runId: string;
    };
  };
  providerConnectionIds: string[];
  secretDependencies: WorkflowSecretDependency[];
  auditEvents: WorkflowFacadeAuditEvent[];
  logsSummary?: {
    available: boolean;
    lineCount?: number;
    nextCursor?: string;
  };
  artifactsSummary?: Array<{
    id: string;
    name: string;
    contentType?: string;
    sizeBytes?: number;
  }>;
  startedAt: string;
  updatedAt: string;
};

export type WorkflowRunFacadeState = {
  workflows: WorkflowFacadeDefinition[];
  runs: WorkflowFacadeRun[];
  providerConnections: ProviderConnectionMetadata[];
};

export type WorkflowFacadeResult<T> =
  | { ok: true; value: T; auditEvent?: WorkflowFacadeAuditEvent }
  | { ok: false; error: { code: WorkflowFacadeErrorCode; message: string; action: string; details?: unknown }; auditEvent?: WorkflowFacadeAuditEvent };

export type StartWorkflowRunRequest = {
  workspaceId: string;
  workflowId: string;
  input?: Record<string, unknown>;
};

export const workflowRunFacadeEndpoints = {
  listWorkflows: "GET /api/platform/workspaces/{workspaceId}/workflows",
  getWorkflow: "GET /api/platform/workspaces/{workspaceId}/workflows/{workflowId}",
  startRun: "POST /api/platform/workspaces/{workspaceId}/workflows/{workflowId}/runs",
  getRun: "GET /api/platform/workspaces/{workspaceId}/workflow-runs/{runId}",
  cancelRun: "POST /api/platform/workspaces/{workspaceId}/workflow-runs/{runId}/cancel",
  retryRun: "POST /api/platform/workspaces/{workspaceId}/workflow-runs/{runId}/retry",
  runLogs: "GET /api/platform/workspaces/{workspaceId}/workflow-runs/{runId}/logs",
  runArtifacts: "GET /api/platform/workspaces/{workspaceId}/workflow-runs/{runId}/artifacts",
} as const;

export const exampleWorkflowRunFacadeState: WorkflowRunFacadeState = {
  workflows: [
    {
      id: "official.core.maintenance/backup-check",
      workspaceId: "wks_local_demo",
      packageId: "official.core.maintenance",
      displayName: "Backup check",
      engine: {
        kind: "dagu",
        workflowId: "official.core.maintenance/backup-check",
        dagu: {
          workflowName: "backup-check",
        },
      },
      requiredProviderConnectionIds: ["pc_github_actions"],
      secretDependencies: [
        {
          namespace: "workflows/core-maintenance",
          ref: "maintenance.API_TOKEN",
          status: "available",
          required: true,
          description: "Broker reference only; raw value resolves at run time.",
        },
      ],
    },
  ],
  runs: [
    {
      facadeRunId: "wfr_20260508_backup_check_01",
      workspaceId: "wks_local_demo",
      workflowId: "official.core.maintenance/backup-check",
      status: "running",
      engine: {
        kind: "dagu",
        runId: "dagu-run-20260508-01",
        status: "running",
        dagu: {
          runId: "dagu-run-20260508-01",
        },
      },
      providerConnectionIds: ["pc_github_actions"],
      secretDependencies: [
        {
          namespace: "workflows/core-maintenance",
          ref: "maintenance.API_TOKEN",
          status: "available",
          required: true,
        },
      ],
      auditEvents: [
        {
          id: "aud_workflow_run_start_01",
          at: "2026-05-08T12:05:00Z",
          actorUserId: "usr_01hzy9operator",
          action: "workflow.run.start",
          facadeRunId: "wfr_20260508_backup_check_01",
          engineRunId: "dagu-run-20260508-01",
          workflowId: "official.core.maintenance/backup-check",
          workspaceId: "wks_local_demo",
          outcome: "accepted",
        },
      ],
      logsSummary: {
        available: true,
        lineCount: 42,
        nextCursor: "log-cursor-42",
      },
      artifactsSummary: [
        {
          id: "artifact-summary-json",
          name: "summary.json",
          contentType: "application/json",
          sizeBytes: 128,
        },
      ],
      startedAt: "2026-05-08T12:05:00Z",
      updatedAt: "2026-05-08T12:05:10Z",
    },
  ],
  providerConnections: [
    {
      id: "pc_github_actions",
      workspaceId: "wks_local_demo",
      ownerUserId: "usr_01hzy9operator",
      provider: "github",
      kind: "oauth",
      displayName: "GitHub Actions metadata connection",
      status: "ready",
      scopes: ["repo:read", "workflow:read"],
      brokerNamespace: "workspaces/local-demo/provider-connections/github",
      secretRef: "provider.github.oauth.client",
      lastVerifiedAt: "2026-05-08T10:05:00Z",
      createdAt: "2026-05-08T10:00:00Z",
      updatedAt: "2026-05-08T10:05:00Z",
      secretMaterialPresent: false,
    },
  ],
};

export function listWorkflowFacadeDefinitions(context: PlatformRequestContext, workspaceId: string, state = exampleWorkflowRunFacadeState): WorkflowFacadeResult<WorkflowFacadeDefinition[]> {
  if (context.workspaceId !== workspaceId) return denied("workspace-mismatch", "Workspace mismatch for workflow list.", "Use a session scoped to the requested workspace.");
  if (!context.entitlements.includes("workspace:read")) return denied("missing-entitlement", "Missing workspace read entitlement.", "Grant workspace:read before listing workflows.");
  return { ok: true, value: state.workflows.filter((workflow) => workflow.workspaceId === workspaceId).map(secretSafeWorkflow) };
}

export function getWorkflowFacadeDefinition(context: PlatformRequestContext, workspaceId: string, workflowId: string, state = exampleWorkflowRunFacadeState): WorkflowFacadeResult<WorkflowFacadeDefinition> {
  const listed = listWorkflowFacadeDefinitions(context, workspaceId, state);
  if (!listed.ok) return listed;
  const workflow = listed.value.find((candidate) => candidate.id === workflowId);
  if (!workflow) return denied("workflow-not-found", `Workflow ${workflowId} is not available in workspace ${workspaceId}.`, "Refresh the workflow catalog or choose an active workflow id.");
  return { ok: true, value: workflow };
}

export function startWorkflowFacadeRun(
  context: PlatformRequestContext,
  request: StartWorkflowRunRequest,
  state = exampleWorkflowRunFacadeState,
  now = () => new Date(),
): WorkflowFacadeResult<WorkflowFacadeRun> {
  const workflowResult = getWorkflowFacadeDefinition(context, request.workspaceId, request.workflowId, state);
  if (!workflowResult.ok) return workflowResult;
  const workflow = workflowResult.value;

  const runAuth = authorizePlatformResource(context, {
    kind: "workflow-run",
    workspaceId: request.workspaceId,
    workflowId: request.workflowId,
    requiredProviderConnectionIds: workflow.requiredProviderConnectionIds,
  });
  if (!runAuth.allowed) {
    return denied(authorizationReasonToFacadeError(runAuth.reason), `Workflow run start denied: ${runAuth.reason}.`, "Satisfy workspace, workflow:run, and provider-connection:use requirements before start.");
  }

  for (const connectionId of workflow.requiredProviderConnectionIds) {
    const connection = state.providerConnections.find((candidate) => candidate.id === connectionId);
    if (!connection) return denied("connection-not-ready", `Required provider connection ${connectionId} is missing.`, "Create and verify the provider connection before start.");
    const decision = authorizePlatformResource(context, { kind: "provider-connection", connection });
    if (!decision.allowed) return denied(authorizationReasonToFacadeError(decision.reason), `Provider connection ${connectionId} denied: ${decision.reason}.`, "Verify provider connection readiness and entitlements before start.");
  }

  for (const secret of workflow.secretDependencies) {
    if (secret.status === "missing") return denied("missing-secret", `Required secret ref ${secret.ref} is missing.`, "Populate the broker ref before starting the workflow.");
    if (secret.status === "denied") return denied("secret-denied", `Required secret ref ${secret.ref} is denied.`, "Grant broker policy access to the workflow service identity before start.");
    const decision = authorizePlatformResource(context, { kind: "secrets-broker-ref", workspaceId: request.workspaceId, brokerNamespace: secret.namespace, ref: secret.ref });
    if (!decision.allowed) return denied(authorizationReasonToFacadeError(decision.reason), `Secret ref ${secret.ref} cannot be resolved: ${decision.reason}.`, "Grant secrets-broker:resolve before start.");
  }

  const startedAt = now().toISOString();
  const facadeRunId = `wfr_${request.workspaceId}_${request.workflowId.replace(/[^A-Za-z0-9]+/g, "_")}_${startedAt.replace(/[^0-9]/g, "")}`;
  const engineRunId = `${workflow.engine.kind}-run-${startedAt.replace(/[^0-9]/g, "")}`;
  const auditEvent: WorkflowFacadeAuditEvent = {
    id: `aud_${facadeRunId}_start`,
    at: startedAt,
    actorUserId: context.userId,
    action: "workflow.run.start",
    facadeRunId,
    engineRunId,
    workflowId: workflow.id,
    workspaceId: request.workspaceId,
    outcome: "accepted",
  };
  const run: WorkflowFacadeRun = {
    facadeRunId,
    workspaceId: request.workspaceId,
    workflowId: workflow.id,
    status: "queued",
    engine: {
      kind: workflow.engine.kind,
      runId: engineRunId,
      status: "queued",
      ...(workflow.engine.kind === "dagu" ? { dagu: { runId: engineRunId } } : {}),
    },
    providerConnectionIds: [...workflow.requiredProviderConnectionIds],
    secretDependencies: workflow.secretDependencies.map(secretSafeSecretDependency),
    auditEvents: [auditEvent],
    logsSummary: { available: false },
    artifactsSummary: [],
    startedAt,
    updatedAt: startedAt,
  };
  assertWorkflowRunFacadeSecretSafe(run);
  return { ok: true, value: run, auditEvent };
}

export function getWorkflowFacadeRun(context: PlatformRequestContext, workspaceId: string, runId: string, state = exampleWorkflowRunFacadeState): WorkflowFacadeResult<WorkflowFacadeRun> {
  const run = state.runs.find((candidate) => candidate.facadeRunId === runId || candidate.engine.runId === runId);
  if (!run) return denied("run-not-found", `Workflow run ${runId} was not found.`, "Use a known facade run id from the workflow run list.");
  if (run.workspaceId !== workspaceId || context.workspaceId !== workspaceId) return denied("workspace-mismatch", "Workspace mismatch for workflow run.", "Use a session scoped to the requested workspace.");
  return { ok: true, value: secretSafeRun(run) };
}

export function cancelWorkflowFacadeRun(context: PlatformRequestContext, workspaceId: string, runId: string, state = exampleWorkflowRunFacadeState, now = () => new Date()): WorkflowFacadeResult<WorkflowFacadeRun> {
  const current = getWorkflowFacadeRun(context, workspaceId, runId, state);
  if (!current.ok) return current;
  if (!["queued", "running", "retrying"].includes(current.value.status)) return denied("invalid-transition", `Cannot cancel workflow run in ${current.value.status} status.`, "Cancel only queued, running, or retrying runs.");
  const at = now().toISOString();
  const auditEvent: WorkflowFacadeAuditEvent = {
    id: `aud_${current.value.facadeRunId}_cancel`,
    at,
    actorUserId: context.userId,
    action: "workflow.run.cancel",
    facadeRunId: current.value.facadeRunId,
    engineRunId: current.value.engine.runId,
    workflowId: current.value.workflowId,
    workspaceId,
    outcome: "accepted",
  };
  const cancelled = { ...current.value, status: "cancelling" as const, updatedAt: at, auditEvents: [...current.value.auditEvents, auditEvent] };
  return { ok: true, value: cancelled, auditEvent };
}

export function retryWorkflowFacadeRun(context: PlatformRequestContext, workspaceId: string, runId: string, state = exampleWorkflowRunFacadeState, now = () => new Date()): WorkflowFacadeResult<WorkflowFacadeRun> {
  const current = getWorkflowFacadeRun(context, workspaceId, runId, state);
  if (!current.ok) return current;
  if (!["failed", "cancelled"].includes(current.value.status)) return denied("invalid-transition", `Cannot retry workflow run in ${current.value.status} status.`, "Retry only failed or cancelled runs.");
  const at = now().toISOString();
  const auditEvent: WorkflowFacadeAuditEvent = {
    id: `aud_${current.value.facadeRunId}_retry`,
    at,
    actorUserId: context.userId,
    action: "workflow.run.retry",
    facadeRunId: current.value.facadeRunId,
    engineRunId: current.value.engine.runId,
    workflowId: current.value.workflowId,
    workspaceId,
    outcome: "accepted",
  };
  return { ok: true, value: { ...current.value, status: "retrying", updatedAt: at, auditEvents: [...current.value.auditEvents, auditEvent] }, auditEvent };
}

export function mapEngineRunStatus(engine: WorkflowEngineKind, status: string): WorkflowFacadeRunStatus {
  const normalized = status.toLowerCase();
  if (engine === "dagu") {
    if (["queued", "not_started", "scheduled"].includes(normalized)) return "queued";
    if (["running", "started"].includes(normalized)) return "running";
    if (["success", "succeeded", "finished"].includes(normalized)) return "succeeded";
    if (["error", "failed"].includes(normalized)) return "failed";
    if (["cancel", "cancelled", "canceled"].includes(normalized)) return "cancelled";
  }
  if (["queued", "running", "succeeded", "failed", "cancelled", "cancelling", "retrying"].includes(normalized)) return normalized as WorkflowFacadeRunStatus;
  return "unknown";
}

export function assertWorkflowRunFacadeSecretSafe(payload: unknown): void {
  const serialized = JSON.stringify(payload);
  if (secretLikeValuePattern.test(serialized)) {
    throw new Error("Workflow run facade payload contains secret-like material");
  }
  for (const [key] of Object.entries(flattenObject(payload))) {
    if (secretLikeFieldPattern.test(key) && !allowedSecretMetadataFields.has(key.split(".").at(-1) ?? key)) {
      throw new Error(`Workflow run facade payload contains secret-like field ${key}`);
    }
  }
}

function secretSafeWorkflow(workflow: WorkflowFacadeDefinition): WorkflowFacadeDefinition {
  const safe = { ...workflow, secretDependencies: workflow.secretDependencies.map(secretSafeSecretDependency) };
  assertWorkflowRunFacadeSecretSafe(safe);
  return safe;
}

function secretSafeRun(run: WorkflowFacadeRun): WorkflowFacadeRun {
  const safe = { ...run, secretDependencies: run.secretDependencies.map(secretSafeSecretDependency) };
  assertWorkflowRunFacadeSecretSafe(safe);
  return safe;
}

function secretSafeSecretDependency(secret: WorkflowSecretDependency): WorkflowSecretDependency {
  return {
    namespace: secret.namespace,
    ref: secret.ref,
    status: secret.status,
    required: secret.required,
    description: secret.description,
  };
}

function denied(code: WorkflowFacadeErrorCode, message: string, action: string): WorkflowFacadeResult<never> {
  return { ok: false, error: { code, message, action } };
}

function authorizationReasonToFacadeError(reason: "allowed" | "missing-entitlement" | "workspace-mismatch" | "connection-not-ready"): WorkflowFacadeErrorCode {
  if (reason === "allowed") return "missing-entitlement";
  return reason;
}

function flattenObject(value: unknown, prefix = ""): Record<string, unknown> {
  if (!value || typeof value !== "object") return {};
  const entries: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    const dotted = prefix ? `${prefix}.${key}` : key;
    entries[dotted] = child;
    if (child && typeof child === "object") Object.assign(entries, flattenObject(child, dotted));
  }
  return entries;
}

const allowedSecretMetadataFields = new Set(["secretDependencies", "secretRef", "secretMaterialPresent"]);
const secretLikeFieldPattern = /(secretValue|secret_value|tokenValue|token_value|apiKey|api_key|privateKey|private_key|password|credential|recoveryMaterial|recovery_material|keyMaterial|key_material)$/i;
const secretLikeValuePattern = /(sk-[a-z0-9]{8,}|ghp_[a-z0-9]{8,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|correct-horse-battery-staple|raw-workflow-secret|access-token-value|refresh-token-value|private-key-material|recovery phrase|client_secret=|password=)/i;
