# SPEC-008: Host-runner privileged service boundary

## Intent

Provide a reviewable, owner-installed host-runner service package without
granting a repository helper authority over an arbitrary caller-owned file or
over a production host. This package is an implementation artifact for the
host owner; it does not install, publish, or activate a service itself.

## Requirements

- `AC-8A`: Darwin installation uses a root-owned `LaunchDaemon`, a root-owned
  executable and a root-only state directory. The daemon, rather than a
  caller-supplied helper, creates and observes its resident primary process.
- `AC-8B`: The daemon records and rechecks the primary's audit-token-derived
  identity, PID, OS birth time, direct daemon-parent relation, held executable
  digest and strict code identity before accepting a completion receipt. It
  accepts requests only over its declared LaunchDaemon Mach service from the
  reviewed signed client identity. A PID alone never authorises a result.
- `AC-8C`: For every daemon-issued job grant, the daemon opens its root-owned
  expected parent and leaf objects, records their device/inode/digest evidence,
  and retains those same held FDs until completion, revocation, or expiry. It
  validates their fixed-format parent/leaf relation. A
  client supplies neither paths, FDs, digests, nor the expected-object
  authority.
- `AC-8D`: A capability is an unreadable, single-use FD with a daemon-issued
  nonce and expiry. The daemon retains the peer end, verifies that exact nonce
  on completion, then consumes and closes both ends. It revokes grants on
  connection close, expiry or identity mismatch. Static/readable bearer values
  and arbitrary caller-selected inodes are denied. Receipt output is private,
  bounded and emits no digests, paths, commands, secret values or capability
  bytes.
- `AC-8E`: Linux sealed-FD, Windows held-handle, Darwin FD-relative/OS-death,
  denied-preopen-writer, replay, substitution and downgrade cases have source
  contracts and negative tests. Native activation evidence is distinct from
  source verification.

## Acceptance evidence

`tests/host-runner-service-package.test.js` checks the package grammar and
fails on path-based input, readable bearer capabilities, missing revocation,
or weak ownership modes. Isolated Windows source proof is retained as private
external qualification evidence and does not stand in for Darwin activation.
A root host owner must run the documented Darwin
commands and retain the private receipt before native acceptance is claimed.
