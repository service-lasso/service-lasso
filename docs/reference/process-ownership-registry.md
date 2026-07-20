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
- the workspace id and runtime instance id;
- the PID;
- the process creation time reported by the operating system;
- the resolved executable path;
- a SHA-256 hash of the process command line;
- the allocation revision, allocated ports, and safe endpoints known at launch;
- lifecycle and identity status, with created and updated timestamps.

Raw command lines and environment variables are never written to this file.
Endpoint credentials, query strings, and fragments are removed before an
endpoint is persisted. The registry therefore contains the evidence needed for
identity comparison without becoming a second source of secrets.

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

Windows inspection uses CIM process metadata. Linux inspection uses `/proc`
identity data, with a bounded `ps` fallback, and macOS uses `ps` metadata.

## Legacy state migration

Older service runtime state can contain only a PID, start time, and command. It
is migrated only when a live inspection agrees on creation time, executable,
and command hash. A definite mismatch clears the stale PID without touching the
unrelated live process. Incomplete or unavailable inspection remains
`unknown_owner` and is not treated as ownership.

## Scope of this contract

This registry closes the persistence and PID-reuse safety part of lifecycle
management. Process-tree adoption and termination after a Service Lasso restart
are tracked separately in issue `#868`. Startup-wide endpoint negotiation and
propagation are tracked in `#869`, and the operator-facing CLI contract is
tracked in `#870`.
