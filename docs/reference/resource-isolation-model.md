# Resource and isolation model

## Status

Design summary for capability item **#4 — Resource/isolation model**.

This is not yet a final runtime contract. It captures the agreed direction so implementation issues can be split cleanly after the design pass.

Related backlog:

- `service-lasso/work-agents#43` — EPIC: Resource isolation model backlog
- `service-lasso/work-agents#37` — EPIC: Docker Compose Node service reference backlog
- `service-lasso/service-lasso-app-docker-node-service#1` — Build reference Docker Compose based Node service example

## Product goal

Service Lasso should support a practical ladder of runtime isolation options.

The default should remain portable and simple, but Linux/server installs should be able to opt into stronger resource controls and isolation where the host supports them.

The model should not force Docker as the default. Docker and Docker Compose should be supported as optional service implementation patterns or later as an execution provider.

## Core principle

Service Lasso owns the service contract.

The service definition remains the source of truth for:

- service identity
- lifecycle actions
- endpoints
- healthchecks
- env/globalenv projection
- files/workspace boundaries
- actions, audit and permissions
- backup/export rules

Isolation providers only decide **how** the service process is launched and constrained.

## Recommended ladder

### 1. Current-user execution

The service runs as the same OS user that launched Service Lasso.

This is the default portable/local mode.

Useful for:

- desktop use
- development
- simple local service bundles
- low-friction onboarding

Limits:

- no strong OS-level isolation between services
- services can generally access whatever the current OS user can access
- Service Lasso must rely on workspace boundaries, permissions, audit and safe defaults

### 2. Resource limits

Apply CPU, memory, process and IO controls where the host supports them.

On Linux this usually means cgroups, preferably via systemd scopes when systemd is available.

Useful for:

- preventing runaway services
- per-service resource accounting
- enforcing process count limits
- making service health/resource status visible in Service Admin

This is likely the first serious Linux resource-control feature to implement.

### 3. Workspace/file boundary enforcement

Constrain service file access to known service-owned roots where practical.

Useful for:

- protecting other service workspaces
- making Files UI boundaries match runtime boundaries
- supporting safe backup/export/archive selection
- reducing accidental host filesystem access

Possible Linux mechanisms include normal filesystem permissions, dedicated service users, Landlock where available, or later namespace-based mounting.

### 4. Dedicated service user mode

Run selected services as dedicated Unix users/groups on server installs.

Useful for:

- stronger filesystem isolation
- service-to-service separation
- traditional Linux hardening

Limits:

- usually requires elevated setup privileges
- less suitable for portable desktop mode
- needs careful ownership/migration rules for service workspaces

This should be optional server-mode behaviour, not the local default.

### 5. Namespace and hardening mode

Use Linux namespaces and hardening controls where available.

Possible controls:

- private temporary directory
- restricted mount view
- process namespace isolation
- optional network namespace
- hostname/domain isolation
- dropped Linux capabilities
- no-new-privileges
- Landlock filesystem restrictions where supported
- seccomp profiles only for known/supported services

This is the path toward container-like isolation without requiring Docker.

### 6. Docker/Compose service implementation pattern

A service repo can already use Docker today by declaring normal Service Lasso actions that call Docker or Docker Compose scripts.

The service repo may include:

- `service.json`
- `docker-compose.yml` or `platforms/docker/docker-compose.yml`
- `.env.template`
- wrapper scripts for start, stop, status, logs and backup

Service Lasso still owns lifecycle, healthchecks, endpoints, env resolution, audit and permissions.

Docker Compose is only an implementation detail inside that service repo.

### 7. Future Docker/Podman execution provider

A first-class Docker/Podman provider may be useful later for:

- better status detection
- better log integration
- volume inspection
- resource reporting
- container lifecycle mapping
- reduced per-service scripting

This should remain optional and should not replace the default portable direct execution model.

## Gaming manager reference model

Gaming server managers commonly use one of these approaches:

- Docker/container based isolation for hosted multi-server panels
- dedicated Linux service users and filesystem ownership for simpler managers
- direct current-user process execution for lightweight local/home usage

Service Lasso should borrow the ladder, not copy a single model.

The best fit is:

1. portable current-user mode by default
2. cgroup/systemd resource limits for Linux/server installs
3. optional file/process hardening where supported
4. optional Docker/Compose pattern for services that want it
5. possible provider abstraction later if Docker/Podman becomes common enough

## Manifest direction

The eventual manifest model should be explicit and provider-neutral.

Possible future shape:

- `resources`
  - CPU limit/share
  - memory limit
  - process/PID limit
  - IO limits where supported
- `isolation`
  - mode: `none`, `workspace`, `user`, `namespace`, `container`
  - fallback policy when unsupported
- `filesystem`
  - writable roots
  - read-only roots
  - denied roots
  - workspace-only mode
- `network`
  - bind rules
  - connect rules
  - namespace/provider hints
- `user`
  - current user
  - dedicated service user
  - configured user/group
- `hardening`
  - drop capabilities
  - no-new-privileges
  - Landlock profile
  - seccomp profile

These names are not final. They are design placeholders only.

## Runtime responsibilities

Service Lasso runtime should eventually be able to:

- detect host support for isolation/resource features
- choose an execution strategy per service
- apply resource limits before launch
- fail clearly or degrade according to policy when a feature is unavailable
- expose effective isolation/resource state through the runtime API
- record isolation/resource decisions in audit/history
- keep lifecycle actions provider-neutral where possible
- keep all service actions permission-gated

## Service Admin responsibilities

Service Admin should eventually show:

- selected execution mode
- effective resource limits
- whether limits are enforced or degraded
- process/resource usage per service
- filesystem boundary status
- warnings when a service requested isolation that is not supported by the host
- clear difference between direct mode and Docker/Compose mode

## Important boundaries

Resource/isolation controls do not replace Service Lasso permissions.

They complement:

- action permissions
- audit logging
- service-scoped grants
- workspace/file source boundaries
- Secrets Broker policy
- backup/export rules

A user who can run a dangerous service action still needs permission. A service process with OS isolation still needs Service Lasso policy around files, secrets and actions.

## Suggested implementation order

1. Document the model and decide the initial manifest shape.
2. Add host capability detection for Linux resource controls.
3. Implement cgroup/systemd scope resource accounting and limits.
4. Expose resource status in runtime API and Service Admin.
5. Add workspace/file boundary enforcement improvements.
6. Add optional dedicated Unix user mode for server installs.
7. Explore namespace/Landlock hardening.
8. Keep Docker Compose as a service-repo pattern first.
9. Consider Docker/Podman provider only after real examples prove the need.

## Open questions

- Should resource limits be part of service manifest, install profile, runtime policy, or all three?
- Should unsupported isolation fail closed or degrade by default?
- How should portable desktop mode expose warnings without feeling broken?
- How should Service Lasso migrate workspace ownership when switching to dedicated service users?
- Should Docker Compose services run foreground under Service Lasso supervision or detached with explicit lifecycle actions?
- How much isolation state should be stored as durable service metadata?
- Which controls must be cross-platform versus Linux-only?

## Current decision

Use a laddered model.

Do not make Docker the default.

Start with portable current-user mode, then add Linux resource controls, then add stronger optional isolation layers as the product matures.