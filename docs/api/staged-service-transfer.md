# Staged service transfer contract

Issue #1463 defines `SPEC-002` `AC-4CH`: a bounded v1 API for moving a caller-local
service archive to a remote Core without assuming a shared filesystem. The durable
registration dependency landed in `a83133cc` (PR #1464); this contract consumes its
operation, actor, permission, confirmation, audit, and metadata-only readback
surfaces. It does not add generic upload permission or any lifecycle authority.

## V1 resources and schemas

All requests use authenticated `/api/v1/service-transfers` resources and derive the
actor from the trusted request policy. Every response is closed-world JSON with
`code`, `message`, and the documented fields only. Unknown fields fail validation.

| Request | Required schema | Result |
| --- | --- | --- |
| `POST /api/v1/service-transfers` | `archiveSha256`, `manifestSha256` (64 lowercase hex each); `archiveBytes` (1..67,108,864); `targetServiceId`; immutable `provenance` (`owner`, `repo`, `releaseTag`, `commitSha`); `manifestSchemaVersion: "service-lasso.service-manifest/v1"` | `201` with opaque `stageId`, expiry, chunk size, and an actor-bound upload token; never a path or URL |
| `PUT /api/v1/service-transfers/{stageId}/chunks/{ordinal}` | Exact next ordinal, `Content-Range`, declared digest and bytes; ordinal is `0..63` | `204` for a new committed chunk or exact replay; status reports next ordinal |
| `GET /api/v1/service-transfers/{stageId}` | None | Actor-scoped metadata-only stage status |
| `POST /api/v1/service-transfers/{stageId}/finalize` | Exact declared archive and manifest digests | `200` `ready` only after complete rehash and archive/manifest validation |
| `POST /api/v1/service-transfers/{stageId}/registration` | Server-issued confirmation, actor-scoped idempotency key, exact stage digest | `202` with the #1462 durable operation ID; it neither installs nor starts a service |

The `GET` status schema is `{ stageId, state, targetServiceId, archiveBytes,
receivedBytes, receivedChunks, archiveDigestPrefix, manifestDigestPrefix,
provenance: { owner, repo, releaseTag, commitSha }, expiresAt, code }`; `state` is
one of `uploading`, `ready`, `rejected`, `expired`, `quarantined`, `consumed`, or
`cleaned`. It never returns archive bytes, client or server paths, raw manifests,
URLs, credentials, configuration, or secrets.

## Bounds and prevalidation

Before Core allocates a stage it verifies schema version, authentication, the trusted
actor's `service:configure` permission, declaration syntax and bounds, provenance,
actor quota, and no conflicting active request identity. Before each chunk it
verifies stage ownership, live nonterminal state, upload token, ordinal and range,
declared length, and sequence. Before finalization it requires the complete ordered
sequence and rehashes exact bytes. Before registration it requires a `ready` stage,
matching actor/digest, and the server confirmation below. Any failed precondition
performs no registration or lifecycle mutation.

The fixed v1 maximum is 64 MiB archive bytes in at most 64 chunks. Archive validation
uses no extraction and accepts at most 1,024 entries, 128 MiB expanded bytes, 20:1
expanded-to-compressed ratio, and 16 directory levels. Each entry name must be a
unique portable UTF-8 relative path with no NUL, empty segment, traversal, absolute,
drive-qualified, or encoding-ambiguous form. Symlinks, hardlinks, devices, FIFOs,
other unsupported entry types, duplicate normalized paths, and all extractor output
are rejected. Core validates archive and manifest identity before registration, and
registration later retains the exact immutable staged digest rather than an extracted
client supplied tree.

## State, resume, expiry, and cleanup

The only nonterminal states are `uploading` and `ready`. Chunk persistence commits
the byte range, ordinal, rolling hash state, and next ordinal together. An identical
retry after disconnect returns the same acknowledgement; an altered chunk, skipped
ordinal, altered declaration, or changed content returns a conflict and never
advances the sequence. A stage can resume only while its actor-bound token and expiry
remain valid.

Stages expire after 30 minutes; `ready` stages expire after 10 minutes. Finalization
makes a digest-valid stage immutable. Registration atomically changes `ready` to
`consumed` only after the #1462 operation journal records the exact actor, key, and
digest. Terminal outcomes are `rejected`, `expired`, `quarantined`, `consumed`, and
`cleaned`. Cleanup first atomically claims eligible terminal or expired stages, then
removes only Core-owned bytes; it cannot race finalization or registration. Failed
validation quarantines bytes for the bounded retention policy and permanently denies
registration. Cleanup preserves no paths or raw bytes in status or Audit.

## Confirmation, idempotency, and errors

Core issues a confirmation only for a `ready` stage after it rechecks trusted actor,
permission, exact archive/manifest digests, provenance, and target service ID. The
confirmation is opaque, expiring, single-use, and bound to actor, stage digest,
provenance, and target service ID. Registration rejects a missing, expired, consumed,
cross-actor, target- or digest-mismatched confirmation before the durable operation
call.

The registration idempotency key is bounded opaque text and scoped to actor, stage,
exact digest, and target service ID. Exact retry returns the original operation ID
without another registration. Reusing a key with a different stage, digest,
confirmation, provenance, or target returns `idempotency_conflict`. Stable errors are `invalid_request`,
`forbidden`, `stage_not_found`, `stage_expired`, `stage_terminal`,
`chunk_sequence_conflict`, `digest_mismatch`, `archive_unsafe`,
`manifest_invalid`, `confirmation_required`, `confirmation_invalid`,
`idempotency_conflict`, and `registration_unavailable`. They carry no raw parser,
filesystem, archive, credential, or upstream error text.

Durable Audit records safe denial, finalize, confirmation issuance/consumption, exact
replay/conflict, registration, expiry, quarantine, and cleanup results with actor,
opaque IDs, counts, digest prefixes, timestamps, and stable codes only.

## Implementation and evidence gate

No implementation starts until a fresh independent specification and security review
accepts this bounded contract. The implementation plan must retain #1462's actor and
durability authority and separately review lifecycle behavior under `SPEC-006`
`AC-6E`; staging and registration never imply install, start, restart, reload, or
other lifecycle work.

Required direct evidence is a concrete HTTP matrix covering authorization denial,
schema/prevalidation ordering, each bound, archive traversal and all forbidden entry
types, duplicate and encoding-normalized names, digest mismatch, interruption/exact
replay/resume/conflict, expiry/quarantine/cleanup races, actor isolation, confirmation
misuse, registration replay/conflict, durable secret-free Audit/status, and no
lifecycle effect. A packaged Core plus external CLI matrix must prove successful
caller-local transfer and registration, denied and expired transfers, resume/replay,
conflict, and a clean consumer environment. Mock transport or source-only checks are
supporting evidence, not substitutes.
