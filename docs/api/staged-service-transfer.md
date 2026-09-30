# Staged service transfer contract

Issue #1463 defines `SPEC-002 AC-4CH`: a v1 API that carries a caller-local
copy of a **released** archive to remote Core. It consumes #1464's approved
publisher allowlist, server-side GitHub release/tag/commit/`service.json`
resolver, `service:configure` permission, durable operation readback, Audit
boundary and exclusive direct-child manifest import. It adds no generic upload,
client manifest authoring, host path, URL, install or lifecycle capability.

The client can upload only bytes identical to one asset from an approved released
`service.json`. A client-local authored service, unpublished tag, unallowlisted
repository, or archive without that selected asset checksum is outside v1. The CLI
must direct the caller to publish/release first; it must not disguise authoring as
transfer.

## Constants, transports, and grammars

JSON bodies reject unknown fields. Successes have only documented fields. Every
error is exactly `{ "code": "<stable-code>", "message": "<safe text>" }`; errors
and all public state omit paths, URLs, headers, raw bytes/manifests, parser output,
credentials, tokens and secrets.

| Limit | Value |
| --- | --- |
| archive / chunks | 67,108,864 bytes (64 MiB) / 64 |
| server chunk size | `min(1,048,576, max(262,144, ceil(archiveBytes / 64)))` |
| entries / expanded bytes / ratio / depth | 1,024 / 134,217,728 / 20:1 / 16 |
| uploading / ready / confirmation lifetime | 30 min / 10 min / 10 min |
| rejected or expired metadata / quarantined bytes / consumed metadata | 24 hr / 7 days / 24 hr |

`targetServiceId` matches `^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$`.
`repo` matches `^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$`; `releaseTag` matches
`^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$`; commit is lowercase 40 hex; every
SHA-256 is lowercase 64 hex. `platform` is `win32`, `linux`, `darwin`,
or `default`; Core selects that `artifact.platforms` entry, falling back to
`default` only when the named entry is absent. `assetName` matches
`^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$`; idempotency keys match
`^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$`.

Opaque server values use only `Authorization: Service-Transfer <uploadToken>`
and `X-Service-Transfer-Confirmation: <confirmationId>`; neither goes in a
body, URL, status, operation, Audit or CLI diagnostic. `X-Chunk-SHA256` is one
SHA-256. `Content-Range: bytes start-end/archiveBytes` is inclusive: body length
is `end-start+1`, and total must equal the declared archive size.

## Resources and release binding

| Request | Exact request / success |
| --- | --- |
| `POST /api/v1/service-transfers` | `{archiveSha256,manifestSha256,archiveBytes,targetServiceId,provenance:{repo,releaseTag,commitSha},platform,assetName,manifestSchemaVersion:"service-lasso.service-manifest/v1"}` → `201 {stageId,state:"uploading",expiresAt,chunkBytes,uploadToken}` |
| `PUT /{stageId}/chunks/{ordinal}` | no JSON; upload header, next ordinal, exact range, chunk digest and octet-stream body → `204` for new commit or exact replay |
| `GET /{stageId}` | → `200 {stageId,state,targetServiceId,archiveBytes,receivedBytes,receivedChunks,archiveDigestPrefix,manifestDigestPrefix,provenance,platform,assetName,expiresAt,code}` |
| `POST /{stageId}/finalize` | empty body → `200 {stageId,state:"ready",archiveDigestPrefix,manifestDigestPrefix,expiresAt,code}` |
| `POST /{stageId}/confirmation` | empty body → `200 {confirmationId,expiresAt,stageId,archiveDigestPrefix,code:"confirmation_issued"}` |
| `POST /{stageId}/registration` | `{idempotencyKey}` plus confirmation header → `202 {operation,replayed:false}` or `200 {operation,replayed:true}` |

Before creation, Core authenticates the actor and `service:configure`, checks
quota/bounds, then invokes the existing #1464 resolver. It server-resolves the
allowlisted repo/tag/commit and exactly one released `service.json`, parses it
with the canonical parser, requires its digest and ID to equal
`manifestSha256` and `targetServiceId`, and selects the requested platform
asset. That entry must have the submitted `assetName`, one of `zip`, `tar.gz`
or `tgz`, and an SHA-256 checksum equal to `archiveSha256`. The durable stage
retains this resolved binding and exact staged digest, never a client manifest/URL.

Finalize parses only immutable staged bytes and never extracts. It rejects encrypted
or unsupported ZIP flags/headers; malformed, truncated or overlapping records; TAR
global/extended/PAX/sparse/GNU long-name/link records; nested archives; all entries
except regular files/directories; links, devices and FIFOs. Entries includes
directories; expanded bytes is regular-file logical size; compression ratio uses
expanded regular bytes divided by immutable archive bytes (one-byte minimum);
depth is normalized slash segment depth. Names must be UTF-8, NUL-free, unique after
portable normalization, relative and free of empty, dot, traversal, absolute,
drive/UNC or encoding-ambiguous forms.

Chunk commit atomically persists immutable bytes, ordinal/range, chunk digest,
rolling digest and next ordinal. The final chunk alone can be shorter. Changed
bytes/digest/range/ordinal/token/retry identity fail `409 chunk_sequence_conflict`.
`GET` stays available after byte cleanup: `cleaned` has zero received byte/count
fields and `quarantined` exposes only a stable code.

## Confirmation, replay and recovery

Confirmation rechecks actor, permission, ready/nonexpired stage, stage digest,
target and resolved repo/tag/commit/manifest/platform/asset binding. It is
actor-bound, ten-minute, opaque and single-use.

Registration's **first action** is durable lookup by actor, idempotency key and full
fingerprint (stage, staged digest, target, provenance and resolved binding). Exact
replay returns the original operation without reading or consuming confirmation;
changed reuse is `409 idempotency_conflict`. Only a new request validates/consumes
the confirmation and atomically creates the #1464 durable operation and claims the
ready stage. It retains the staged digest and invokes the existing #1464 resolver
and exclusive direct-child import boundary for the verified released manifest.

Stable outcomes are: `400 invalid_request`; `401 upload_token_invalid` or
`confirmation_invalid`; `403 forbidden`/`unapproved_release`; `404
stage_not_found`; `409 release_binding_mismatch`, `chunk_sequence_conflict`,
`stage_expired`, `stage_terminal`, `digest_mismatch`, `archive_unsafe`,
`manifest_invalid`, `confirmation_required`, `confirmation_expired`, or
`idempotency_conflict`; and `503 release_provenance_unavailable` or
`registration_unavailable`. Audit and operations contain only opaque IDs, counts,
digest prefixes, timestamps and stable codes.

Stage claim, confirmation consumption, operation journal, Audit outcome and byte
deletion share one durable cross-process lock and crash-recoverable journal. Restart
reconciles journal/stage before claim, finalize or cleanup. Cleanup atomically claims
only eligible expired/terminal stages, deletes only Core-owned bytes after retention,
keeps metadata through retention, never races a claim, and never repeats an uncertain
mutation.

## Evidence gate

Implementation waits for fresh independent specification and security review.
Required evidence is a concrete HTTP/JSON/status matrix; release resolver and
checksum mismatches; every parser/header/encryption/name/count/ratio/depth denial
without extraction; range/token/retry conflicts; retention and GET-after-cleanup;
confirmation-before-new-only/replay ordering; cross-process and hard-exit recovery;
secret-free Audit; and packaged Core plus external CLI released-asset transfer.
It must prove no install, start, restart, reload, or lifecycle effect.
