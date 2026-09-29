# Staged service transfer prerequisite

Issue #1463 defines the client-local transfer boundary that follows the unmerged
#1462 durable registration API. This document is a prerequisite contract only;
no HTTP route is available on `develop` and no client path is accepted.

## Proposed binding

1. An authenticated actor with `service:configure` requests an opaque staged ID
   with declared byte length, archive SHA-256, manifest SHA-256, and immutable
   source provenance.
2. Core accepts bounded upload chunks into an actor-scoped temporary object. It
   rejects path-bearing input, traversal entries, archive bombs, excess entries,
   changed digest, expired IDs, and cross-actor reads before registration.
3. A confirmed, idempotency-keyed registration request names only the staged ID
   and its exact digest. Core validates identity, writes a durable operation,
   and never installs, starts, or restarts implicitly.
4. Status readback is actor-scoped and metadata-only. It contains no client or
   server paths, archive bytes, credentials, or secret values. Expired or
   abandoned staged objects are removed by Core-owned cleanup.

## Dependency and evidence boundary

The durable-operation, actor/permission, confirmation, audit, registration and
restart reconciliation surfaces belong to #1462 / PR #1464 and are not on
`develop`. Implementation must wait for that dependency rather than introduce a
parallel generic upload endpoint. Required direct evidence after it lands is
real HTTP coverage for denial, traversal, digest mismatch, replay/conflict,
disconnect/reconnect, expiry cleanup, cross-actor access and secret-free status,
plus a packaged Core and external CLI integration run.
