# Staged service transfer contract

Issue #1463 defines `SPEC-002 AC-4CH` / `AC-4CH.1`: a v1, release-asset-only protocol that carries a caller-held copy of one approved published archive to remote Core. Core resolves the allowlisted GitHub release, its one `service.json`, target ID, and selected platform asset before allocating a stage. It adds no generic upload, client manifest authoring, client/server path, URL, installation, or lifecycle authority.

This protocol does **not** admit a locally authored template project. Such a project has no published allowlisted release, immutable tag/commit, released `service.json`, or selected-asset checksum. The full remote client-local input goal remains open in [#1513](https://github.com/service-lasso/service-lasso/issues/1513), mapped to `SPEC-002` and `SPEC-006 AC-6E` and linked to CLI #1, CLI #8, and #1463. #1513 must define a separate source-admission contract before product work; it must not be silently folded into this endpoint.

## Constants, transport, and grammars

JSON bodies reject unknown fields. A public error is exactly `{ "code": "<stable-code>", "message": "<safe text>" }`. Errors, status, operations, Audit, logs, and CLI diagnostics omit paths, URLs, headers, raw bytes/manifests, parser detail, credentials, tokens, and secrets. Tokens are accepted only in their dedicated request headers. The sole body exception is an issuance response: it carries the just-issued opaque credential once and is never returned by GET, replay, error, Audit, operation, or any later response.

| Limit | Value |
| --- | --- |
| archive / chunks | 67,108,864 bytes (64 MiB) / 64 |
| chunk bytes | `min(1,048,576, max(262,144, ceil(archiveBytes / 64)))` |
| entries / expanded bytes / ratio / depth | 1,024 / 134,217,728 / 20:1 / 16 |
| uploading / ready / confirmation lifetime | 30 / 10 / 10 minutes |
| rejected or expired metadata / quarantined bytes / consumed metadata | 24 hr / 7 days / 24 hr |
| stage ID / upload token / confirmation ID | `stg_` + 32 / `sut_` + 43 / `scf_` + 32 base64url characters |
| stage ID / confirmation entropy | 192 bits from OS CSPRNG; store only SHA-256(token) |
| upload-token entropy | 256 bits from OS CSPRNG; store only SHA-256(token) |

`targetServiceId` is `^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$`; `repo` is `^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$`; `releaseTag` is `^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$`; commit and SHA-256 are lowercase 40/64 hex; `platform` is `win32`, `linux`, `darwin`, or `default`; `assetName` is `^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$`; idempotency key is `^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$`. `stageId`, `uploadToken`, and `confirmationId` are respectively `^stg_[A-Za-z0-9_-]{32}$`, `^sut_[A-Za-z0-9_-]{43}$`, and `^scf_[A-Za-z0-9_-]{32}$`; base64url has no padding. Core uses 24 CSPRNG bytes for stage/confirmation values and 32 CSPRNG bytes for upload tokens, base64url encoding, constant-time hash comparison, and rejects an invalid grammar before lookup.

Exactly one `Authorization: Service-Transfer <uploadToken>`, one `X-Service-Transfer-Confirmation: <confirmationId>`, one `X-Chunk-SHA256: <lowercase-64-hex>`, and one `Content-Range` are permitted where required. Duplicate occurrences, comma-joined duplicates, whitespace variation, obs-fold, another authorization scheme, or an unlisted token-bearing header is `400 invalid_request` before state lookup.

`Content-Range` is exact ASCII `^bytes ([0-9]+)-([0-9]+)/([0-9]+)$`. Numerals have no sign, leading zero unless exactly `0`, comma, suffix, wildcard, or overflow. Parse unsigned 64-bit values and require `start <= end`, `end < total`, `total == archiveBytes`, `start == ordinal * chunkBytes`, and `end - start + 1 == body.length`; all chunks equal `chunkBytes` except the final, which is exactly remaining bytes. `ordinal` is `^(0|[1-9][0-9]{0,1})$`, equals next ordinal, and is below 64. The retry fingerprint is SHA-256 of canonical stage ID, actor ID, ordinal, start, end, total, chunk digest, and raw body bytes separated by NUL. A committed ordinal accepts only its identical fingerprint and returns `204`; all other retries return `409 chunk_sequence_conflict`.

## Resources and release binding

| Request | Exact request / success |
| --- | --- |
| `POST /api/v1/service-transfers` | `{archiveBytes,targetServiceId,provenance:{repo,releaseTag,commitSha},platform,assetName,manifestSchemaVersion:"service-lasso.service-manifest/v1"}` → `201 {stageId,state:"uploading",expiresAt,chunkBytes,uploadToken}`. `uploadToken` is issuance-only. |
| `PUT /{stageId}/chunks/{ordinal}` | octet-stream body plus upload header, ordinal, exact range and chunk digest → `204` for new commit or exact retry. |
| `GET /{stageId}` | `200 {stageId,state,targetServiceId,archiveBytes,receivedBytes,receivedChunks,archiveDigestPrefix,manifestDigestPrefix,provenance,platform,assetName,expiresAt,code}`. |
| `POST /{stageId}/finalize` | empty body → `200 {stageId,state:"ready",archiveDigestPrefix,manifestDigestPrefix,expiresAt,code}`. |
| `POST /{stageId}/confirmation` | empty body → `200 {confirmationId,expiresAt,stageId,archiveDigestPrefix,code:"confirmation_issued"}`. `confirmationId` is issuance-only. |
| `POST /{stageId}/registration` | `{idempotencyKey}` plus confirmation header → `202 {operation,replayed:false}` or `200 {operation,replayed:true}`. |

Before allocation Core authenticates the actor and `service:configure`, checks quota/bounds, then uses the released-reference resolver. It server-resolves the allowlisted repo/tag/commit, the exact release asset IDs, and exactly one released `service.json`; parses that manifest with the canonical parser; derives its SHA-256 and ID; and requires the derived ID to equal `targetServiceId`. It selects the requested platform entry (named entry, else `default`) and derives the archive SHA-256 through the same canonical resolver path used by released consumers: `checksum.value`, `sha256`, or the declared `checksum.assetName` release asset (including `SHA256SUMS.txt`). A caller supplies no archive or manifest digest and cannot select a checksum source, URL, or asset ID. Creation fails closed when Core cannot resolve one exact release asset and one exact canonical checksum. The durable stage persists the release ID, manifest asset ID, selected archive asset ID, checksum source and checksum-asset ID where applicable, derived manifest digest, derived archive digest, and staged digest; it never retains a client manifest, URL, or caller-trusted digest.

Finalize rehashes exact complete bytes then validates only immutable bytes using the profile below. It never extracts or writes a member. A changed ordinal/range/digest/body/token/retry fingerprint is `409 chunk_sequence_conflict`. `GET` remains metadata-only after cleanup: `cleaned` has zero received byte/count fields and `quarantined` exposes only its stable code.

## Versioned archive parser profile and TAR qualification gate

`release-archive-profile-v1` is a closed profile for `zip`, `tar.gz`, and
`tgz`. The archive type comes only from the server-resolved selected release
asset name and manifest declaration; a caller cannot select a parser. ZIP is
specified below. TAR is specified here so the Linux and macOS release assets
remain part of the intended released-asset transfer surface. It is a parser
contract for the future implementation, not evidence that the current Core
already admits TAR: until the evidence gate below is met, an implementation
must fail closed with `409 archive_unsafe` for `tar.gz`/`tgz`.

The owned producer is `createReleaseArchive` in
`scripts/release-artifact-lib.mjs`: it invokes the host command
`tar -czf <archive> -C <output> <artifact>` without `--format`. The current
release workflow runs that producer on Ubuntu; the same owned source can run
with GNU tar or BSD tar on Linux/macOS. Neither a generic extractor nor a
successful Linux build proves the record sequence from either producer. GNU
tar documents GNU long-name records and POSIX PAX extended headers; the
profile therefore accepts only the bounded forms below, rather than denying
the Linux/macOS release formats or accepting general TAR.

**Gzip envelope.** Inflate exactly one gzip member with compression method 8.
Reject reserved flags, a second member, trailing non-zero decompressed bytes,
and an invalid header or CRC/ISIZE. Optional gzip extra, name, comment, and
header-CRC fields are bounded to 4,096 bytes each and consumed only as envelope
metadata. The implementation streams inflate under the 128 MiB expanded-byte
cap and stops before any member write or extraction.

**TAR blocks and headers.** The inflated stream is 512-byte blocks. Require a
valid unsigned TAR checksum for every header, two consecutive all-zero end
blocks, and only zero padding thereafter. Reject base-256 numbers, malformed
octal fields, malformed `ustar`/GNU magic or version fields, a non-zero device
field, sparse markers, continuation/volume records, and unknown typeflags.
Accept only regular files (`0` or NUL), directories (`5`), POSIX per-file PAX
headers (`x`), and GNU long-name headers (`L`). Links (`1`, `2`), devices
(`3`, `4`), FIFOs (`6`), global PAX (`g`), GNU long-link (`K`), sparse records,
and every other extension are rejected. Regular-file size is strict octal and
counts toward the existing 128 MiB and 20:1 limits; directory size is zero.
Header count is at most 2,048, logical file/directory entries at most 1,024,
and extension headers at most 1,024. Each payload is padded to a 512-byte
boundary and the parser skips it without materialising a member.

**Names and logical entries.** Decode `name` and `prefix` as strict UTF-8,
require NUL termination followed only by NUL padding, and combine a non-empty
prefix as `prefix/name`. The effective name for a regular file or directory is
the ordinary header name or one immediately preceding accepted extension name.
It must be at most 4,096 UTF-8 bytes and normalize under the same rules as ZIP:
no NUL, empty component, `.` or `..`, leading slash, backslash, drive or UNC
form, normalization change, duplicate normalized path, or more than 16 path
components. Directories end in `/` and have zero payload; regular files do not
end in `/`. Mode is parsed only to reject setuid, setgid, sticky, and file-type
bits other than regular/directory; ownership, timestamps, and permissions are
never applied.

**Per-file extensions.** An extension is bound to exactly one immediately
following regular-file or directory header. It cannot follow another extension,
cannot appear after the terminal blocks, and cannot be shared, reordered, or
retained as metadata for a later member.

* A GNU `L` record has a payload of 2–4,097 bytes: exactly one strict UTF-8
  normalized path followed by a single NUL. Its header declares a regular
  payload and its path/link fields are ignored. The following member receives
  that path; a GNU long-link record is always denied.
* A POSIX `x` record has a payload of 1–8,192 bytes containing at most 16 PAX
  records. Each record is exact ASCII decimal `length`, one space, then
  `key=value\n`; the declared length equals its complete byte length, has no
  leading zero except `0`, and no record is duplicated. Only `path`, `size`,
  and `mtime` keys are permitted. `path` is a strict UTF-8 normalized path of
  1–4,096 bytes. `size` is ASCII decimal, at most 134,217,728, and must equal
  the following regular-file effective size (it is forbidden for a directory).
  `mtime` is unsigned decimal seconds with an optional 1–9 digit fractional
  part, at most 20 bytes. A PAX record with no `path` is allowed only for an
  otherwise ordinary member; its values remain validation-only and are never
  applied. PAX `path` and GNU `L` cannot both modify the same member.

These rules admit ordinary USTAR members and the bounded GNU/POSIX long-path
forms that the owned GNU/BSD producer can emit. They intentionally reject
global, sparse, link, device, ownership, ACL, xattr, vendor, and unknown
metadata instead of silently ignoring it. Any parser failure returns only
`409 archive_unsafe`, without a member name or parser detail.

**TAR implementation qualification.** Before TAR is enabled, a fresh
independent review must approve the parser implementation and a producer
receipt for each supported producer lane: current GNU tar on Linux and current
BSD tar on macOS, including command/version, exact source revision, archive
SHA-256, and the server-resolved release/asset IDs. The fixture set must retain
real produced archives for ordinary paths, the longest actual bundled path,
GNU `L`, POSIX `x` (`path`, `size`, and `mtime`), and all supported platform
asset names. Byte-level tests must prove accepted order/bounds and every denial
above, plus no extraction/write/lifecycle effect. Packaged Core and the
released CLI/TUI journey must then transfer the checksum-bound Windows ZIP,
Linux TAR, and macOS TAR assets on all three operating systems. Current
evidence has not supplied those producer receipts, parser tests, or three-OS
released-artifact journey; this specification does not claim them delivered.

**ZIP.** Require first local header, one terminal EOCD, and a central directory fully inside the archive. Reject prefix/SFX bytes, multi-disk, trailing bytes, ZIP64 locator/EOCD/extra fields, encrypted or strong-encrypted flags (0/6), patched-data flag 5, central-directory encryption flag 13, and every general-purpose flag except bit 3 and UTF-8 bit 11. Permit only stored (0) and deflate (8), rejecting AES/other methods. Every central record has one local record at its declared offset; filename bytes, method, allowed flags, CRC-32, compressed size, and uncompressed size agree. Bit 3 allows zero local CRC/sizes only where its immediate signed descriptor supplies the same 32-bit values; no ZIP64 descriptor. Reject overlap between local records/descriptors, central directory, EOCD, or declared member ranges; reject nonzero extra fields. Filename is strict UTF-8 with bit 11, or ASCII-only without bit 11; CP437, Unicode-path extras, and non-ASCII unflagged names fail. Count all members; add regular-file uncompressed size; stream regular files under an output cap and verify CRC-32. Directories end `/` and have zero payload; regular files do not end `/`. Reject symlink/device mode bits and unrecognized external attributes.

For the admitted ZIP profile normalize names by rejecting NUL, empty components, `.`/`..`, leading `/`, `\\`, drive/UNC forms, encoding ambiguity or normalization change; split only `/`; reject duplicate normalized names and depth over 16. Stop before inflate/read beyond 1,024 entries, 134,217,728 regular expanded bytes, or 20:1 ratio (`expanded / max(1, immutable archive bytes)`). Return only `409 archive_unsafe`, never a parser reason/member name.

## Confirmation, adapter, replay, and recovery

Confirmation rechecks actor, permission, ready/nonexpired stage, stage digest, target, and full resolved release binding. It is actor-bound, ten-minute, opaque, and single-use.

Registration first performs durable lookup by actor, idempotency key, and full fingerprint: stage ID, staged archive digest, server-derived manifest digest, target ID, repo/tag/commit, release ID, manifest/selected-asset/checksum-asset IDs, canonical checksum source and digest, selected platform/asset/archive type, and manifest schema. Exact replay returns the original operation without reading or consuming confirmation; altered reuse is `409 idempotency_conflict`.

The old #1464 request is `{repo,tag,expectedCommit,expectedManifestSha256,idempotencyKey,confirm:true}`. It has no stage, archive digest, platform asset, or stage-claim state. It cannot be asserted to implement this protocol. Core needs a reviewed **staged-registration adapter** over the source-safe resolver and direct-child importer. Its operation extends the safe #1464 operation with `source:"staged_release_asset"`, stage ID, staged-digest prefix, platform, asset name, and archive type. It reuses the one durable operation store; it does not create an incompatible journal.

For a new request under the cross-process lock: (1) reconcile unfinished staged-registration journal; (2) re-resolve and compare retained binding; (3) validate confirmation; (4) durably write `{version:1,operationId,stageId,fingerprint,phase:"prepared"}`; (5) atomically consume confirmation and claim stage with operation ID; (6) create/update the single durable operation as `unknown`; (7) invoke direct-child import once; (8) durably record completed/conflict/unknown and Audit outcome; (9) transition stage to `consumed`, delete bytes only by normal retention, and seal journal. Audit write failure retains a pending safe outcome and never repeats import.

Recovery under the same lock reads that journal first. A prepared/unclaimed journal may revalidate. A claimed/unknown operation reconciles its direct-child target before recording completion or retaining `unknown`; a terminal operation seals the stage and emits pending safe Audit. Contradictory stage, confirmation, operation, or journal IDs fail closed as `503 registration_unavailable`. Cleanup claims only eligible expired/terminal stages, deletes Core-owned bytes after retention, preserves metadata, never races a claim, and never repeats uncertain mutation.

Stable outcomes: `400 invalid_request`; `401 upload_token_invalid` / `confirmation_invalid`; `403 forbidden` / `unapproved_release`; `404 stage_not_found`; `409 release_binding_mismatch`, `chunk_sequence_conflict`, `stage_expired`, `stage_terminal`, `digest_mismatch`, `archive_unsafe`, `manifest_invalid`, `confirmation_required`, `confirmation_expired`, `idempotency_conflict`; and `503 release_provenance_unavailable` / `registration_unavailable`.

## Evidence gate

Implementation waits for fresh independent specification and security review. Required evidence: HTTP/JSON/status matrix; canonical resolver coverage for `checksum.value`, `sha256`, and checksum-release-asset (`checksum.assetName` / `SHA256SUMS.txt`) forms, including exact release/asset ID binding and caller-digest refusal; every admitted ZIP-parser denial without extraction; duplicate-header/grammar/range/retry conflicts; issuance-only token redaction; retention/GET-after-cleanup; confirmation-before-new-only replay order; adapter atomic order, cross-process and hard-exit recovery; secret-free Audit; and packaged Core plus external CLI released-asset transfer. A future TAR profile additionally needs exact-producer byte fixtures and parser tests. It must prove no install, start, restart, reload, or lifecycle effect.
