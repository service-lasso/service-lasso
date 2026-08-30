# Process ownership registry

Service Lasso persists the operating-system identity of every runtime and
service process it starts. This record is the authority used to decide whether
a later `stop`, `restart`, or recovery operation still owns a PID.

The registry is stored at:

    workspaceRoot/.service-lasso/processes.json

It is distinct from the [runtime instance registry](runtime-instance-registry.md),
which advertises local API instances for discovery. A PID or an unexpired lease
in that discovery registry is not sufficient evidence that Service Lasso owns a
process.

## Durable identity

Each active process record includes:

- the owner type (`runtime` or `service`) and owner id;
- the workspace id, runtime instance id, and runtime generation id when known;
- the PID;
- the process creation time reported by the operating system;
- the resolved executable path;
- a SHA-256 hash of the process command line;
- the allocation revision, allocated ports, and safe endpoints known at launch;
- the owned process-tree boundary (`posix` process group, Windows Job Object, or explicit no-group fallback);
- lifecycle and identity status, with created and updated timestamps.

Raw command lines and environment variables are never written to this file.
Endpoint credentials, query strings, and fragments are removed before an
endpoint is persisted. The registry therefore contains the evidence needed for
identity comparison without becoming a second source of secrets.

The runtime generation id links the runtime process record and every managed
service process record back to the same startup attempt. Legacy records may
have a null generation id, but new runtime launches persist the generation
before allocation or launch and propagate it before readiness can succeed.
Runtime lane selection requires this fingerprint and generation to agree; a
PID, port, health response, or lease never establishes authority by itself.

## Atomic lifecycle

Service Lasso writes a `launching` record immediately after the child process is
created and before readiness can succeed. It changes that record to `running`
only after readiness succeeds, then to `stopping` and `stopped` during a normal
stop. A stopped record retains safe audit metadata but has no active PID or
fingerprint.

Registry updates use the workspace lifecycle lock, a temporary file, file sync,
and atomic rename. Lock ownership carries the same verifiable process identity
plus a unique token, so an exited or PID-reused owner can be recovered without
one process releasing another process's lock. The previous valid document is retained as
`processes.json.bak`; readers use that backup if an interrupted primary write is
invalid. Stale lock files are bounded and recovered rather than waited on
indefinitely.

The record written for an exiting process is conditional on its expected PID.
This prevents a delayed exit callback from an older process clearing the
ownership record of a replacement process.

## Identity decisions

Before Service Lasso acts on a stored PID, it inspects the live process and
compares all durable identity fields:

| Classification | Meaning | Safe action |
| --- | --- | --- |
| `owned` | PID, creation time, executable, and command hash all match. | The process is the recorded process. |
| `not_running` | The PID does not currently exist. | Clear the stale active PID; there is nothing to terminate. |
| `identity_mismatch` | The PID exists but one or more identity fields differ. | Clear the stale ownership claim and do not signal the process. |
| `unknown_owner` | The operating system cannot provide enough evidence. | Fail safely: do not terminate or replace the process automatically. |

Creation time is required because operating systems reuse PIDs. PID equality by
itself never authorises termination.

Windows identity inspection uses one native process handle for PID, creation time, executable image, and command-line evidence. Linux inspection uses `/proc`
identity data, with a bounded `ps` fallback, and macOS uses `ps` metadata.

## Legacy state migration

Older service runtime state can contain only a PID, start time, and command. It
is migrated only when a live inspection agrees on creation time, executable,
and command hash. A definite mismatch clears the stale PID without touching the
unrelated live process. Incomplete or unavailable inspection remains
`unknown_owner` and is not treated as ownership.

## Adoption and process-tree stop

At startup, a persisted service is adopted only after its PID, creation time,
executable and command hash all match. Its existing allocation and process-tree
boundary are retained. Adopted owners are polled with OS identity inspection;
when the root exits, the runtime confirms or terminates the remaining verified
tree before clearing running state or releasing ownership.

New Linux and macOS service launches run in a dedicated POSIX process group.
Normal stop signals that group, waits for the complete non-zombie group to
exit, escalates to `SIGKILL` after the bounded timeout, and fails without
clearing ownership if the tree still cannot be confirmed stopped.

New Windows service launches use a published static launcher started through
the absolute System32 Windows PowerShell path. The launcher waits behind
unpredictable, phase-specific release, files-bound, continuation, and
acknowledgement tokens; pre-created workspace files do not authorize progress.
It creates a kill-on-close Job Object, creates the real service suspended,
assigns it to the Job, and only then resumes it. Guarded
executable inputs are opened by the launcher at their approved size and SHA-256
digest while write/delete sharing remains denied. The final guard reverifies
the inputs while those handles are held, then process creation consumes the
canonical executable and file-argument paths obtained from the same handles.
An explicitly guarded launch fails closed unless the executable itself resolves
to one of those approved, held files, including when the approved set is empty.
If enrollment fails before release, no service code has run; if the launcher
exits after release, closing the Job terminates its whole tree.

Older persisted services may have no group record. For those services, the
runtime snapshots the root's child and grandchild relationships and captures a
full identity fingerprint for every descendant. Each fingerprint is checked
again immediately before signalling, so a reused descendant PID is not killed.

On Windows, the supervisor independently verifies the retained launcher handle
and its immutable root identity. It enumerates ancestry with Toolhelp, queries
each process's immutable inherited-parent PID through the same handle used for
creation time, image and command evidence, and rejects snapshot/handle drift.
A normal Windows stop has a bounded 15-second convergence window and uses
`taskkill /PID <pid> /T`, adding `/F` only after the graceful timeout; explicit
shorter caller deadlines remain authoritative. Job closure is the OS
containment boundary if a descendant is created or the root exits between
monitor snapshots. Freshly verified descendants are merged into the root-exit
termination set. If containment cannot be proved, the operation returns
boundedly, both start and restart persist truthful live lifecycle state, and
the retained process remains stoppable through the API rather than clearing the registry. The Windows/Linux matrix in
`.github/workflows/lifecycle-process-tree.yml` runs the same
root/child/grandchild behavior proof on both platforms.

## Scope of this contract

This registry is the authority for persistence, PID-reuse safety, verified
adoption and process-tree termination. Startup-wide endpoint negotiation and
propagation are tracked in `#869`, and the operator-facing CLI contract is
tracked in `#870`.
