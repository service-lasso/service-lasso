# Runtime Instance Registry

Service Lasso records read-only runtime identity so operators and tools can distinguish multiple local instances on the same machine.

## API

GET /api/runtime/instance returns the current instance record and the local registry snapshot.

The current instance includes:

- instanceId: stable id derived from the resolved servicesRoot and workspaceRoot.
- pid: API process id.
- apiPort, apiUrl, and advertisedUrls.
- servicesRoot and workspaceRoot.
- startedAt and updatedAt.
- status: active or stale.

The registry includes active and stale recent entries from the local host registry file. Stale entries are retained for troubleshooting instead of being trusted as live runtimes.

## CLI

Use service-lasso instance --json to inspect the same registry data without starting a runtime. The command resolves the same --services-root and --workspace-root options as other read-only commands.

## Files

The current instance record is stored below the workspace root at:

    workspaceRoot/.service-lasso/runtime-instance.json

The host-level registry is stored at:

    ~/.service-lasso/instances.json

Set SERVICE_LASSO_INSTANCE_REGISTRY_PATH to place the registry somewhere else, which is useful for isolated tests and temporary multi-instance runs.

The registry does not include secrets or environment values.
