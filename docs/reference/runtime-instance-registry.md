# Runtime Instance Registry

Service Lasso records read-only runtime identity so operators and tools can distinguish multiple local instances on the same machine.

## API

GET /api/runtime/instance returns the current instance record and the local registry snapshot.

The current instance includes:

- instanceId: stable id derived from the resolved servicesRoot and workspaceRoot.
- pid: API process id.
- apiPort, apiUrl, and advertisedUrls.
- servicesRoot and workspaceRoot.
- startedAt, updatedAt, heartbeatAt, leaseExpiresAt, and leaseTtlMs.
- status: active, stale, or unknown.
- statusReason / staleReason when the runtime can classify why a record is not active.

The registry includes active, stale, and unknown recent entries from the local host registry file. A running API process refreshes its lease heartbeat while it is serving requests. Records are classified as:

- active: the process exists and its lease has not expired.
- stale: the process is explicitly stopped or no longer exists.
- unknown: the process id exists, but the lease expired or cannot be trusted.

Stale and unknown entries are retained for troubleshooting instead of being trusted as live runtimes.

## CLI

Use service-lasso instance --json to inspect the same registry data without starting a runtime. The command resolves the same --services-root and --workspace-root options as other read-only commands.

## Files

The current instance record is stored below the workspace root at:

    workspaceRoot/.service-lasso/runtime-instance.json

The host-level registry is stored at:

    ~/.service-lasso/instances.json

Set SERVICE_LASSO_INSTANCE_REGISTRY_PATH to place the registry somewhere else, which is useful for isolated tests and temporary multi-instance runs.

The registry does not include secrets or environment values.

This registry is a discovery and lease mechanism, not termination authority.
Before signalling a runtime or service PID, lifecycle code must verify the
durable operating-system identity in the
[process ownership registry](process-ownership-registry.md). PID equality or an
unexpired instance lease alone does not prove process ownership.
