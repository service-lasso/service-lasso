# Workflow run facade

Service Lasso exposes product-facing workflow and run contracts so apps and Service Admin do not couple directly to Dagu internals. The first facade is metadata-only and can map to Dagu or another workflow runner later.

## Endpoint contract

The facade surface is workspace-scoped:

- `GET /api/platform/workspaces/{workspaceId}/workflows` — list workflows.
- `GET /api/platform/workspaces/{workspaceId}/workflows/{workflowId}` — get workflow.
- `POST /api/platform/workspaces/{workspaceId}/workflows/{workflowId}/runs` — start run.
- `GET /api/platform/workspaces/{workspaceId}/workflow-runs/{runId}` — get run by facade run id or mapped engine run id.
- `POST /api/platform/workspaces/{workspaceId}/workflow-runs/{runId}/cancel` — cancel run.
- `POST /api/platform/workspaces/{workspaceId}/workflow-runs/{runId}/retry` — retry run.
- `GET /api/platform/workspaces/{workspaceId}/workflow-runs/{runId}/logs` — run logs summary and cursor metadata.
- `GET /api/platform/workspaces/{workspaceId}/workflow-runs/{runId}/artifacts` — artifacts summary metadata.

The initial implementation lives in `src/platform/workflowRunFacade.ts` as a product contract and test fixture. Runtime HTTP binding can wrap the same shapes later.

## Workflow shape

A workflow definition includes:

- facade workflow id;
- workspace id;
- package id from the workflow package catalog;
- display name;
- engine kind and engine workflow id;
- required provider connection ids;
- secret dependency status by ref metadata only.

Dagu-specific fields are either hidden behind normalized fields or clearly namespaced under `engine.dagu`. Product clients should use the facade ids and normalized status values first.

## Run shape

A run includes:

- `facadeRunId` — stable Service Lasso run id for product clients;
- `engine.runId` — mapped engine run id for operator correlation;
- normalized `status`;
- engine status and optional namespaced Dagu run id;
- provider connection ids;
- secret dependency refs and status metadata;
- audit events linking facade run ids to engine run ids;
- run logs summary metadata;
- artifacts summary metadata.

## Status normalization

Engine-specific statuses use status normalization before product clients see them. Statuses are normalized to:

- `queued`
- `running`
- `succeeded`
- `failed`
- `cancelled`
- `cancelling`
- `retrying`
- `unknown`

For Dagu, `not_started` and scheduled states map to `queued`, `success` maps to `succeeded`, `error` maps to `failed`, and cancel/cancelled variants map to `cancelled`.

## Start policy

Before a start run request is accepted, the facade performs fail-closed workspace/provider/broker policy checks:

1. The request context workspace must match the target workspace.
2. The context must include `workflow:run` and provider-use entitlements.
3. Required provider connections must exist in the same workspace and be ready.
4. Required broker secret refs must be available and resolvable by metadata policy.
5. Missing or denied secret dependencies block the start request.

Errors are normalized and actionable: workspace mismatch, missing entitlement, connection not ready, missing secret, denied secret, workflow not found, run not found, and invalid transition.

## Secret dependency status by ref metadata only

The facade may return:

```json
{
  "namespace": "workflows/core-maintenance",
  "ref": "maintenance.API_TOKEN",
  "status": "available",
  "required": true
}
```

It must not return raw secret values, provider tokens, API keys, refresh tokens, private keys, passwords, recovery material, or broker payloads. Secret resolution happens behind the broker at run time.

## Cancellation, retry, logs, and artifacts

Cancel and retry produce audit events that link the facade run id, engine run id, workflow id, workspace id, actor, action, outcome, and timestamp. Cancellation enters `cancelling`; retry enters `retrying` and is only valid from failed/cancelled states.

Run logs and artifacts are summaries only. Product clients get availability, cursors, ids, names, content types, and sizes. Raw log streaming and artifact download policies can be layered behind the same facade later.
