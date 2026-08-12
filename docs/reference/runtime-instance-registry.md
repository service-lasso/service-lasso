# Runtime Instance Registry

Service Lasso records read-only runtime identity so operators and tools can distinguish multiple local instances on the same machine.

## API

GET /api/runtime/instance returns the current instance, host registry, workspace
generation history, and a stable lane-selection result.

`GET /api/runtime/endpoints/allocation` returns the runtime API and service
endpoints selected for this lane, including the allocation revision, attempt,
policy, resolution, bind, port, and safe URL selector. Endpoint allocation is
published separately from the instance lease because proposal ports can be
renegotiated before bind.

The current instance includes:

- instanceId: stable id derived from the resolved servicesRoot and workspaceRoot.
- generationId: cryptographically random id for the current startup attempt.
- pid: API process id.
- apiPort, apiUrl, and advertisedUrls.
- servicesRoot, workspaceRoot, and runtimeRoot.
- phase: starting, running, stopping, stopped, failed, or superseded.
- safe source identity: Git branch and commit when the runtime root is a Git checkout.
- startedAt, updatedAt, heartbeatAt, leaseExpiresAt, and leaseTtlMs.
- status: active, stale, or unknown.
- statusReason / staleReason when the runtime can classify why a record is not active.

The registry retains active and terminal generations from the local host
registry file. A running API process refreshes its lease heartbeat while it is
serving requests. Records are classified using the process ownership
fingerprint and lease together:

- active: PID, OS creation time, executable and command hash match, and the lease is current.
- stale: the generation is terminal, the verified process exited, or its fingerprint mismatches.
- unknown: ownership evidence is absent/unavailable or the verified owner's lease expired.

Stale and unknown entries are retained for troubleshooting instead of being trusted as live runtimes.

## CLI

Use `service-lasso instance --json` to inspect the same registry data without
starting a runtime. Add `--generation <id>` to require a particular immutable
generation. The result classification is one of `selected`, `not_found`,
`stale`, `ambiguous`, `wrong_lane`, or `unknown_owner`; the CLI never chooses
the first healthy endpoint.

## Files

The current instance record is stored below the workspace root at:

    workspaceRoot/.service-lasso/runtime-instance.json

The authoritative, versioned generation history is stored at:

    workspaceRoot/.service-lasso/runtime-generations.json

The host-level registry is stored at:

    ~/.service-lasso/instances.json

Set SERVICE_LASSO_INSTANCE_REGISTRY_PATH to place the registry somewhere else, which is useful for isolated tests and temporary multi-instance runs.

Instance and generation files use temporary-file sync, atomic rename, and a
`.bak` recovery document. Host-registry writers are serialized, and generation
creation is serialized by the verified workspace lifecycle lock. The registry
does not include secrets, raw environment values, credentials, or command
lines.

This registry is a discovery and lease mechanism, not termination authority.
Before signalling a runtime or service PID, lifecycle code must verify the
durable operating-system identity in the
[process ownership registry](process-ownership-registry.md). PID equality or an
unexpired instance lease alone does not prove process ownership.

The `instanceId` remains stable for one services/workspace pair. A
cryptographically random `generationId` is persisted while holding the
workspace lock before allocation, materialisation, autostart, or API listen.
A second invocation rejects a verified live owner; after a terminal generation,
a new invocation creates a new id and retains the prior record for diagnosis.

The generation is copied into runtime and service process ownership,
allocation revision, materialised service runtime state, readiness state, API,
CLI, and canonical demo verification. Selection follows explicit
workspace/generation, workspace generation history, verified process identity,
then the generation's published endpoint. Starting generations do not publish a
discoverable endpoint. A healthy response from another checkout,
worktree, workspace, or generation fails as `wrong_lane`.
