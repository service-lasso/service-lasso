# Staged service transfer contract

Issue #1463 defines `SPEC-002 AC-4CH` / `AC-4CH.1`: a v1, release-asset-only protocol that carries a caller-held copy of one approved published archive to remote Core. Core resolves the allowlisted GitHub release, its one `service.json`, target ID, and selected platform asset before allocating a stage. It adds no generic upload, client manifest authoring, client/server path, URL, installation, or lifecycle authority.

This protocol does **not** admit a locally authored template project. Such a project has no published allowlisted release, immutable tag/commit, released `service.json`, or selected-asset checksum. The full remote client-local input goal remains open in [#1513](https://github.com/service-lasso/service-lasso/issues/1513), mapped to `SPEC-002` and `SPEC-006 AC-6E` and linked to CLI #1, CLI #8, and #1463. #1513 must define a separate source-admission contract before product work; it must not be silently folded into this endpoint.

## Constants, transport, and grammars

JSON bodies reject unknown fields. A public error is exactly `{ "code": "<stable-code>", "message": "<safe text>" }`. Errors, status, operations, Audit, logs, and CLI diagnostics omit paths, URLs, headers, raw bytes/manifests, parser detail, credentials, tokens, and secrets. Tokens are accepted only in their dedicated request headers. The sole body exception is an issuance response: it carries the just-issued opaque credential once and is never returned by GET, replay, error, Audit, operation, or any later response.

| Limit | Value |
| --- | --- |
| archive / chunks | 67,108,864 server-resolved asset bytes (64 MiB) / 64 |
| chunk bytes | `min(1,048,576, max(262,144, ceil(resolvedAssetBytes / 64)))` |
| entries / expanded bytes / ratio / depth | 1,024 / 134,217,728 / 20:1 / 16 |
| uploading / ready / confirmation lifetime | 30 / 10 / 10 minutes |
| rejected or expired metadata / quarantined bytes / consumed metadata | 24 hr / 7 days / 24 hr |
| aggregate reservation ceilings | per actor: 8 stages, 256 MiB compressed, 512 chunks, 8,192 entries, 1 GiB expanded; per workspace: 64 stages, 1 GiB compressed, 4,096 chunks, 65,536 entries, 8 GiB expanded |
| stage ID / upload token / confirmation ID | `stg_` + 32 / `sut_` + 43 / `scf_` + 32 base64url characters |
| stage ID / confirmation entropy | 192 bits from OS CSPRNG; store only SHA-256(token) |
| upload-token entropy | 256 bits from OS CSPRNG; store only SHA-256(token) |

`targetServiceId` is `^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$`; `repo` is `^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$`; `releaseTag` is `^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$`; commit and SHA-256 are lowercase 40/64 hex; `platform` is exactly `win32`, `linux`, or `darwin` (there is no `default`, generic, or cross-platform fallback); the **server-derived** `assetName` is `^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$`; idempotency key is `^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$`. `stageId`, `uploadToken`, and `confirmationId` are respectively `^stg_[A-Za-z0-9_-]{32}$`, `^sut_[A-Za-z0-9_-]{43}$`, and `^scf_[A-Za-z0-9_-]{32}$`; base64url has no padding. Core uses 24 CSPRNG bytes for stage/confirmation values and 32 CSPRNG bytes for upload tokens, base64url encoding, constant-time hash comparison, and rejects an invalid grammar before lookup.

Every route requires exactly one ordinary Core actor credential, `Authorization: Bearer <actorAccessToken>`, which is validated before any stage state is disclosed. The upload route additionally requires exactly one `X-Service-Transfer-Token: <uploadToken>`; the registration route additionally requires exactly one `X-Service-Transfer-Confirmation: <confirmationId>`; no route accepts either opaque stage credential in `Authorization`. The upload route requires exactly one `X-Chunk-SHA256: <lowercase-64-hex>` and `Content-Range`. The actor bearer and its route-specific stage credential therefore coexist as separate, non-interchangeable headers. Duplicate occurrences, comma-joined duplicates, whitespace variation, obs-fold, another authorization scheme, a stage token in any unlisted header, or an unlisted token-bearing header is `400 invalid_request` before authentication or state lookup.

The deterministic failure order is: (1) parse every required and token-bearing header and reject the malformed/duplicate request as `400 invalid_request`; (2) a missing bearer is `401 actor_credential_missing`, and an invalid, expired, or unverifiable bearer is `401 actor_credential_invalid`; (3) a valid actor lacking `service:configure` is `403 forbidden`; (4) for a stage route, look up only the record keyed by that actor ID and `stageId`, returning `404 stage_not_found` if absent; then (5) evaluate route state and the required upload token or confirmation. Thus malformed actor and stage/confirmation headers always win before authentication, while a missing/invalid actor always wins before any stage state or stage credential result. A different authenticated actor receives the same `404 stage_not_found` for a non-owned or nonexistent stage; Core never returns `forbidden` for another actor's stage. A stage's persisted actor ID must equal that actor ID on **every** route; upload-token/confirmation validation supplements rather than replaces those checks.

`Content-Range` is exact ASCII `^bytes ([0-9]+)-([0-9]+)/([0-9]+)$`. Numerals have no sign, leading zero unless exactly `0`, comma, suffix, wildcard, or overflow. Parse unsigned 64-bit values and require `start <= end`, `end < total`, `total == archiveBytes`, `start == ordinal * chunkBytes`, and `end - start + 1 == body.length`; all chunks equal `chunkBytes` except the final, which is exactly remaining bytes. `ordinal` is `^(0|[1-9][0-9]{0,1})$`, equals next ordinal, and is below 64. The retry fingerprint is SHA-256 of canonical stage ID, actor ID, ordinal, start, end, total, chunk digest, and raw body bytes separated by NUL. A committed ordinal accepts only its identical fingerprint and returns `204`; all other retries return `409 chunk_sequence_conflict`.

## Resources and release binding

| Request | Exact request / success |
| --- | --- |
| `POST /api/v1/service-transfers` | `{targetServiceId,provenance:{repo,releaseTag,commitSha},platform,manifestSchemaVersion:"service-lasso.service-manifest/v1"}` → `201 {stageId,state:"uploading",archiveBytes,expiresAt,chunkBytes,uploadToken}`. `archiveBytes` is the server-resolved selected release-asset size; `uploadToken` is issuance-only. |
| `PUT /{stageId}/chunks/{ordinal}` | octet-stream body plus upload header, ordinal, exact range and chunk digest → `204` for new commit or exact retry. |
| `GET /{stageId}` | `200 {stageId,state,targetServiceId,archiveBytes,receivedBytes,receivedChunks,archiveDigestPrefix,manifestDigestPrefix,provenance,platform,assetName,expiresAt,code}`. |
| `POST /{stageId}/finalize` | empty body → `200 {stageId,state:"ready",archiveDigestPrefix,manifestDigestPrefix,expiresAt,code}`. |
| `POST /{stageId}/confirmation` | empty body → `200 {confirmationId,expiresAt,stageId,archiveDigestPrefix,code:"confirmation_issued"}`. `confirmationId` is issuance-only. |
| `POST /{stageId}/registration` | `{idempotencyKey}` plus confirmation header → `202 {operation,replayed:false}` or `200 {operation,replayed:true}`. |

| Route | Required authenticated actor and stage condition |
| --- | --- |
| create | Bearer actor has `service:configure`; Core records that actor as the new stage owner before issuing its upload token. |
| upload | Bearer actor has `service:configure`, owns the addressed stage, and supplies the matching unexpired `X-Service-Transfer-Token`. |
| status | Bearer actor has `service:configure` and owns the addressed stage; this metadata route accepts no stage credential. |
| finalize | Bearer actor has `service:configure` and owns the addressed stage; this mutation route accepts no stage credential. |
| confirmation | Bearer actor has `service:configure` and owns the ready addressed stage; this issuance route accepts no stage credential. |
| registration | Bearer actor has `service:configure`, owns the ready addressed stage, and supplies the matching unexpired `X-Service-Transfer-Confirmation`. |

Before allocation Core authenticates the actor and `service:configure`, then uses the released-reference resolver before admitting quota. It server-resolves the allowlisted repo/tag/commit, the exact release asset IDs, and exactly one released `service.json`; parses that manifest with the canonical parser; derives its SHA-256 and ID; and requires the derived ID to equal `targetServiceId`. The caller may name only its target platform. Core selects exactly that platform's required manifest entry: `win32` maps only to the Windows ZIP asset, `linux` only to the Linux TAR asset, and `darwin` only to the macOS TAR asset named by the release-asset policy. A missing per-OS entry, a `default` entry, a generic TAR fallback, or a ZIP substitute fails closed as `403 unapproved_release`; no platform falls back to another platform or a generic asset. Core resolves the selected canonical asset name, exact release asset ID, **and release API byte size** itself, rejecting a non-positive size or one above 64 MiB. Core derives the archive SHA-256 through the same canonical resolver path used by released consumers: `checksum.value`, `sha256`, or the declared `checksum.assetName` release asset (including `SHA256SUMS.txt`). A caller supplies no archive length, archive/manifest digest, or checksum source, and cannot select a URL or asset ID. Creation fails closed when Core cannot resolve one exact release asset, its byte size, and one exact canonical checksum. The durable stage persists the release ID, manifest asset ID, selected server-derived asset name/asset ID/byte size, checksum source and checksum-asset ID where applicable, derived manifest digest, derived archive digest, and staged digest; it never retains a client manifest, URL, caller-selected size, or caller-trusted digest.

Allocation atomically reserves the server-derived `archiveBytes`, 64 chunk slots, 1,024 entry slots, and 134,217,728 expanded-byte ceiling against both actor and workspace ceilings before returning a token. The fixed ceilings are the table above; an implementation may lower them through a bounded static configuration that declares every actor/workspace count, compressed-byte, chunk, entry, and expanded-byte ceiling, but may never raise them or omit a dimension. If either aggregate would exceed a ceiling, creation returns `429 stage_quota_exceeded` before allocation and with no stage/token. Counters are durable per actor/workspace across every dimension.

Each reservation is held in `uploading` through its 30-minute expiry, `ready` through its 10-minute expiry, and `rejected`/`expired`/`consumed` for 24 hours after their terminal transition. `quarantined` holds its full reservation for seven days after quarantine. `claimed` holds it until the operation becomes terminal, then follows `consumed`; `unknown`, contradictory, and unreconciled recovery records hold it indefinitely until a durable reconciliation or an explicitly authorized operator disposition makes the operation terminal. Recovery never ages, discards, or downgrades those uncertain records to free capacity. Finalize replaces provisional entry/expanded ceilings with actual admitted counts only after validation, retaining the larger reservation on any parse failure. Claim, expiry, quarantine, cleanup, terminal transition, and recovery change counters in the same durable transaction as stage state. On startup or crash recovery Core recomputes every counter from durable stage/journal records, repairs only a provably missing or duplicated reservation under the cross-process lock, and fails closed with `503 registration_unavailable` if accounting cannot be reconciled. Deleting bytes never releases a reservation before the durable terminal record and its stated retention permit it.

Finalize first requires received byte/count coverage to equal the server-derived selected-asset byte size, then rehashes the exact complete staged bytes and compares the full SHA-256 in constant time with the server-resolved canonical archive digest. Any byte-size or digest mismatch is terminal `409 digest_mismatch` before parser/admission/ready state. Only an exact match validates immutable bytes using the profile below. It never extracts or writes a member. A changed ordinal/range/digest/body/token/retry fingerprint is `409 chunk_sequence_conflict`. `GET` remains metadata-only after cleanup: `cleaned` has zero received byte/count fields and `quarantined` exposes only its stable code.

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
blocks, and only zero padding thereafter. Header bytes 257–262 and 263–264
must be exactly one of USTAR `ustar\\0` / `00` or GNU `ustar ` / ` \\0`;
all other magic/version pairs, including old/v7, are denied. Numeric fields are
ASCII octal digits followed by NUL or space padding only; base-256, a missing
terminator, an empty required size, or a value above the stated bound is denied.
Reject a non-zero device field, sparse markers, continuation/volume records,
and unknown typeflags.
Accept only regular files (`0` or NUL), directories (`5`), POSIX per-file PAX
headers (`x`), and GNU long-name headers (`L`). Links (`1`, `2`), devices
(`3`, `4`), FIFOs (`6`), global PAX (`g`), GNU long-link (`K`), sparse records,
and every other extension are rejected. Regular-file size is strict octal and
counts toward the existing 128 MiB and 20:1 limits; directory size is zero.
Header count is at most 2,048, logical file/directory entries at most 1,024,
and extension headers at most 1,024. Every header has a `headerSize`, its
strict-octal size field. An extension record is always framed by its own
`headerSize`; a regular member's `effectiveSize` is its `headerSize` unless its
immediately preceding PAX `x` record supplies `size`, in which case that
decimal PAX value is its `effectiveSize`. The parser consumes exactly the
applicable size and then exactly `(512 - (size mod 512)) mod 512` padding before
the next header: PAX `size` changes the following regular member's framing,
bounds, ratio, and accounting, never the PAX record's framing. This profile
rejects a regular header whose raw `headerSize` is less than its effective PAX
size, a PAX size on a directory, or an over-bound value. The parser skips those
bytes without materialising a member.

**Names and logical entries.** Decode `name` and `prefix` as strict UTF-8,
require NUL termination followed only by NUL padding, and combine a non-empty
prefix as `prefix/name`. The effective name for a regular file or directory is
the ordinary header name or one immediately preceding accepted extension name.
It must be 1–4,096 UTF-8 bytes, already Unicode NFC (a normalization change is
denied), and have at most 16 `/`-separated components. Each component is
non-empty and not `.` or `..`; the whole name has no NUL, leading slash,
backslash, colon, drive or UNC form. The admission key is NFC followed by
Unicode default case folding; a duplicate key is denied, so paths that differ
only by case or canonical Unicode spelling cannot collide on Windows or a
case-insensitive macOS volume. Components ending in a dot or space, DOS device
names (`CON`, `PRN`, `AUX`, `NUL`, `COM1`–`COM9`, `LPT1`–`LPT9`) even with an
extension, and an explicit DOS 8.3 alias of another component after Win32
trim/case rules are denied. The collision check is over the complete logical
entry set, is performed before any extraction, and must use the documented
Win32 alias grammar rather than the host filesystem's current 8.3 setting.
Directories end in `/` and have zero payload; regular files do not end in `/`.
Mode is parsed only to reject setuid, setgid, sticky, and file-type bits other
than regular/directory; ownership, timestamps, and permissions are never
applied.

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
  1–4,096 bytes. `size` is ASCII decimal, at most 134,217,728, and replaces
  the following regular-file `headerSize` as that member's `effectiveSize` and
  physical framing value (it is forbidden for a directory); the header size
  remains recorded solely for raw-field validation. `size` may not be smaller
  than that header value.
  `mtime` is unsigned decimal seconds with an optional 1–9 digit fractional
  part, at most 20 bytes. A PAX record with no `path` is allowed only for an
  otherwise ordinary member; its `size` still controls that member's framing
  while `mtime` remains validation-only and is never applied. PAX `path` and
  GNU `L` cannot both modify the same member.

These rules admit ordinary USTAR members and the bounded GNU/POSIX long-path
forms that the owned GNU/BSD producer can emit. They intentionally reject
global, sparse, link, device, ownership, ACL, xattr, vendor, and unknown
metadata instead of silently ignoring it. Any parser failure returns only
`409 archive_unsafe`, without a member name or parser detail.

**TAR implementation qualification.** TAR remains disabled in v1 unless all
of these gates are satisfied for the exact enabling commit: (T1) a fresh
independent specification and security review approves the parser and this
closed USTAR/GNU grammar; (T2) current GNU tar on Linux and current BSD tar on
macOS each produce retained receipts containing command/version, exact source
revision, archive SHA-256, and server-resolved release/asset IDs; (T3) real
fixtures from both producers cover ordinary paths, the longest actual bundled
path, GNU `L`, POSIX `x` (`path`, `size`, and `mtime`), and every supported
platform asset name; (T4) byte-level parser tests prove each allowed
order/framing/bound and every denial above, including Unicode/case/Windows
alias collisions, without extraction, member write, or lifecycle effect; and
(T5) packaged Core and the released external CLI/TUI journey transfer the
checksum-bound Windows ZIP, Linux TAR, and macOS TAR assets on Windows, Linux,
and macOS. Current evidence supplies none of the required fresh producer
receipts, parser tests, or three-OS journey. This specification therefore does
not claim TAR qualification or admission.

**ZIP.** Require first local header, one terminal EOCD, and a central directory fully inside the archive. Reject prefix/SFX bytes, multi-disk, trailing bytes, ZIP64 locator/EOCD/extra fields, encrypted or strong-encrypted flags (0/6), patched-data flag 5, central-directory encryption flag 13, and every general-purpose flag except bit 3 and UTF-8 bit 11. Permit only stored (0) and deflate (8), rejecting AES/other methods. Every central record has one local record at its declared offset; filename bytes, method, allowed flags, CRC-32, compressed size, and uncompressed size agree. Bit 3 allows zero local CRC/sizes only where its immediate signed descriptor supplies the same 32-bit values; no ZIP64 descriptor. Reject overlap between local records/descriptors, central directory, EOCD, or declared member ranges; reject nonzero extra fields. Filename is strict UTF-8 with bit 11, or ASCII-only without bit 11; CP437, Unicode-path extras, and non-ASCII unflagged names fail. Count all members; add regular-file uncompressed size; stream regular files under an output cap and verify CRC-32. Directories end `/` and have zero payload; regular files do not end `/`. Reject symlink/device mode bits and unrecognized external attributes.

For the admitted ZIP profile split only `/` and apply the same strict UTF-8,
NFC, Unicode-default-case-folded, Windows-trim/device/DOS-8.3-alias collision
rule as TAR logical entries; reject NUL, empty components, `.`/`..`, leading
`/`, `\\`, colon, drive/UNC forms, normalization change, and depth over 16.
Stop before inflate/read beyond 1,024 entries, 134,217,728 regular expanded
bytes, or 20:1 ratio (`expanded / max(1, immutable archive bytes)`). Return
only `409 archive_unsafe`, never a parser reason/member name.

## Confirmation, adapter, replay, and recovery

Confirmation rechecks actor, permission, ready/nonexpired stage, stage digest, target, and full resolved release binding. It is actor-bound, ten-minute, opaque, and single-use.

Registration first performs durable lookup by actor, idempotency key, and full fingerprint: stage ID, staged archive digest, server-derived manifest digest, target ID, repo/tag/commit, release ID, manifest/selected-asset/checksum-asset IDs, canonical checksum source and digest, selected platform/asset/archive type, and manifest schema. Exact replay returns the original operation without reading or consuming confirmation; altered reuse is `409 idempotency_conflict`.

The old #1464 request is `{repo,tag,expectedCommit,expectedManifestSha256,idempotencyKey,confirm:true}`. It has no stage, archive digest, platform asset, or stage-claim state. It cannot be asserted to implement this protocol. Core needs a reviewed **staged-registration adapter** over the source-safe resolver and direct-child importer. Its operation extends the safe #1464 operation with `source:"staged_release_asset"`, stage ID, staged-digest prefix, platform, asset name, and archive type. It reuses the one durable operation store; it does not create an incompatible journal.

For a new request under the cross-process lock: (1) reconcile unfinished staged-registration journal; (2) re-resolve and compare retained binding; (3) validate confirmation; (4) durably write `{version:1,operationId,stageId,fingerprint,phase:"prepared"}`; (5) atomically consume confirmation and claim stage with operation ID; (6) create/update the single durable operation as `unknown`; (7) invoke direct-child import once; (8) durably record completed/conflict/unknown and Audit outcome; (9) transition stage to `consumed`, delete bytes only by normal retention, and seal journal. Audit write failure retains a pending safe outcome and never repeats import.

Recovery under the same lock reads that journal first. A prepared/unclaimed journal may revalidate. A claimed/unknown operation reconciles its direct-child target before recording completion or retaining `unknown`; a terminal operation seals the stage and emits pending safe Audit. Contradictory stage, confirmation, operation, or journal IDs fail closed as `503 registration_unavailable`. Cleanup claims only eligible expired/terminal stages, deletes Core-owned bytes after retention, preserves metadata, never races a claim, and never repeats uncertain mutation.

Stable outcomes: `400 invalid_request`; `401 actor_credential_missing`, `actor_credential_invalid`, `upload_token_invalid`, or `confirmation_invalid`; `403 forbidden` or `unapproved_release`; `404 stage_not_found`; `409 release_binding_mismatch`, `chunk_sequence_conflict`, `stage_expired`, `stage_terminal`, `digest_mismatch`, `archive_unsafe`, `manifest_invalid`, `confirmation_required`, `confirmation_expired`, or `idempotency_conflict`; `429 stage_quota_exceeded`; and `503 release_provenance_unavailable` or `registration_unavailable`.

## Evidence gate

Implementation waits for fresh independent specification and security review.
Required evidence: HTTP/JSON/status matrix proving actor bearer plus
route-specific stage-token coexistence, actor ownership and `service:configure`
on every route, duplicate-header rejection, issuance-only token redaction, and
caller asset/digest refusal; canonical resolver coverage for `checksum.value`,
`sha256`, and checksum-release-asset (`checksum.assetName` / `SHA256SUMS.txt`)
forms, including exact release/asset ID binding and server-side canonical
platform-asset selection and server-derived byte-size/digest equality before
parser admission; quota-ceiling rejection plus durable actor/workspace counters,
terminal retention, and crash-recovery reconciliation evidence; actor/header
precedence and actor-scoped no-leak not-found evidence; every admitted ZIP-parser denial,
including Unicode/case/Windows alias collisions, without extraction;
grammar/range/retry conflicts; retention/GET-after-cleanup;
confirmation-before-new-only replay order; adapter atomic order, cross-process
and hard-exit recovery; secret-free Audit; and packaged Core plus external CLI
released-asset transfer. Enabling TAR additionally requires **all** T1–T5
before this v1 gate is satisfied: the independent reviews, current GNU/Linux
and BSD/macOS producer receipts and real fixtures, byte-level accepted and
denial/parser-no-effect evidence, and the checksum-bound Windows/Linux/macOS
released CLI/TUI/Core journey on all three operating systems. It must prove no
install, start, restart, reload, or lifecycle effect.
