# SPEC-004: Isolated WSL Runner Pool

## Intent

Provide an optional repository-owned path for provisioning dedicated, bounded
WSL 2 GitHub Actions runner capacity for Service Lasso. The runner pool must
avoid the shared Docker/workspace growth that previously made WSL storage
ownership and reclamation unclear.

## Scope

Included:

- one dedicated WSL distribution, Linux account, Docker daemon, work directory,
  GitHub registration, cleanup timer, and Windows autostart task per runner;
- idempotent desired-state scale-out through `RunnerCount`;
- Node.js 22, Docker, PowerShell, and GitHub runner dependencies;
- bounded VHD capacity, Docker logs, workspaces, caches, and journal storage;
- contract tests and an operator runbook.

Explicitly out of scope:

- changing existing workflow `runs-on` selectors;
- creating, recreating, unregistering, or pruning live distributions during
  repository validation;
- sharing a Docker daemon or workspace between pool members.

## Requirements and Acceptance Criteria

### `WSL-RUNNER-001` — Isolated member identity

Every requested runner has a distinct WSL distribution, VHD location, Linux
account, runner name, work directory, Docker daemon, and custom runner label.
Member 1 retains the unnumbered `service-lasso` name; members 2 onward use
`service-lasso-02`, `service-lasso-03`, and so on.

### `WSL-RUNNER-002` — Idempotent pool reconciliation

`RunnerCount` expresses total desired pool size. An existing member with an
Actions runner systemd service is left unchanged. Missing or unconfigured
members are provisioned independently, and destructive replacement requires
the explicit `ForceRecreate` switch.

### `WSL-RUNNER-003` — Secure toolchain and registration

The installer provisions Docker with `overlay2`, Node.js 22, PowerShell, and
official GitHub Actions runner dependencies. Linux passwords and registration
tokens are transferred through user-restricted temporary files and are absent
from runner service environment and `wsl.exe` command lines. GitHub CLI creates
a fresh repository registration token for every missing pool member; a supplied
single-use token cannot configure multiple members.

### `WSL-RUNNER-004` — Idle-aware storage control

Docker uses bounded `json-file` logs. Job lifecycle hooks and a systemd cleanup
timer coordinate through a lock and active-job marker. Cleanup skips active
`Runner.Worker` processes and otherwise prunes unused Docker resources,
completed workspaces, apt caches, old journal data, and free ext4 blocks.

### `WSL-RUNNER-005` — Host capacity and lifecycle

New distributions default to a 60 GB VHD ceiling. Before creation, aggregate
worst-case capacity for every missing member plus 15 GB Windows headroom is
required unless explicitly overridden. `WhatIf` provides a non-mutating plan,
and each configured distro receives a hidden current-user logon keepalive task
unless autostart is explicitly skipped.

## Tests and Evidence

- Contract test for repository defaults, pool naming, token behavior, cleanup,
  log limits, and autostart.
- PowerShell parser validation.
- Non-mutating three-member `WhatIf` plan.
- `npm test` regression suite.
- `git diff --check`.

## Documentation Impact

Create `docs/operations/self-hosted-wsl-runner.md` covering prerequisites,
secure installation, dry-run, scale-out, inspection, reaping, removal, and VHD
reclamation.

## Verification

Repository verification does not mutate WSL. The contract test proves the
declared installer behavior, the PowerShell parser proves script syntax, and
`WhatIf` exercises desired-state naming and capacity planning without creating
a distribution. A live runner may be provisioned separately after merge with
an operator-supplied SecureString password.

## Organisation runner groups

The installer must keep repository scope as its default and may register new
runners into an organisation-scoped runner group with selected-repository
access. Repository grants must be additive, public repositories require an
explicit opt-in, and existing repository-scoped runners must not be silently
converted.

## Change Notes

- 2026-07-20: Issue `#873` created for the first isolated Service Lasso WSL
  runner-pool installer. One distribution per runner was selected to make
  storage ownership, failure isolation, and disposal explicit.
- 2026-07-23: Issue `#885` added selected-repository organisation runner-group
  provisioning while preserving repository scope as the default.
