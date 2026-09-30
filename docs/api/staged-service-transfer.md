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
| `POST /api/v1/service-transfers` | `{archiveSha256,manifestSha256,archiveBytes,targetServiceId,provenance:{repo,releaseTag,commitSha},platform,assetName,manifestSchemaVersion:"service-lasso.service-manifest/v1"}` → `201 {stageId,state:"uploading",expiresAt,chunkBytes,uploadToken}`. `uploadToken` is issuance-only. |
| `PUT /{stageId}/chunks/{ordinal}` | octet-stream body plus upload header, ordinal, exact range and chunk digest → `204` for new commit or exact retry. |
| `GET /{stageId}` | `200 {stageId,state,targetServiceId,archiveBytes,receivedBytes,receivedChunks,archiveDigestPrefix,manifestDigestPrefix,provenance,platform,assetName,expiresAt,code}`. |
| `POST /{stageId}/finalize` | empty body → `200 {stageId,state:"ready",archiveDigestPrefix,manifestDigestPrefix,expiresAt,code}`. |
| `POST /{stageId}/confirmation` | empty body → `200 {confirmationId,expiresAt,stageId,archiveDigestPrefix,code:"confirmation_issued"}`. `confirmationId` is issuance-only. |
| `POST /{stageId}/registration` | `{idempotencyKey}` plus confirmation header → `202 {operation,replayed:false}` or `200 {operation,replayed:true}`. |

Before creation Core authenticates the actor and `service:configure`, checks quota/bounds, then uses the released-reference resolver. It server-resolves the allowlisted repo/tag/commit and exactly one released `service.json`, parses it with the canonical parser, requires its digest and ID to equal `manifestSha256`/`targetServiceId`, and selects the requested platform entry (named entry, else `default`). That entry must have submitted `assetName`, archive type `zip`, `tar.gz`, or `tgz`, and SHA-256 equal to `archiveSha256`. The durable stage retains this resolved binding and staged digest, never client manifest or URL.

Finalize rehashes exact complete bytes then validates only immutable bytes using the profile below. It never extracts or writes a member. A changed ordinal/range/digest/body/token/retry fingerprint is `409 chunk_sequence_conflict`. `GET` remains metadata-only after cleanup: `cleaned` has zero received byte/count fields and `quarantined` exposes only its stable code.

## CLOSED archive parser profile

The selected published `artifact.platforms` contract supports `zip`, `tar.gz`, and `tgz`. `tar.gz` and `tgz` use one gzip member plus the POSIX ustar TAR profile below. Any future format needs a new versioned profile.

**ZIP.** Require first local header, one terminal EOCD, and a central directory fully inside the archive. Reject prefix/SFX bytes, multi-disk, trailing bytes, ZIP64 locator/EOCD/extra fields, encrypted or strong-encrypted flags (0/6), patched-data flag 5, central-directory encryption flag 13, and every general-purpose flag except bit 3 and UTF-8 bit 11. Permit only stored (0) and deflate (8), rejecting AES/other methods. Every central record has one local record at its declared offset; filename bytes, method, allowed flags, CRC-32, compressed size, and uncompressed size agree. Bit 3 allows zero local CRC/sizes only where its immediate signed descriptor supplies the same 32-bit values; no ZIP64 descriptor. Reject overlap between local records/descriptors, central directory, EOCD, or declared member ranges; reject nonzero extra fields. Filename is strict UTF-8 with bit 11, or ASCII-only without bit 11; CP437, Unicode-path extras, and non-ASCII unflagged names fail. Count all members; add regular-file uncompressed size; stream regular files under an output cap and verify CRC-32. Directories end `/` and have zero payload; regular files do not end `/`. Reject symlink/device mode bits and unrecognized external attributes.

**TAR.GZ/TGZ.** Require one gzip member `1f 8b`, CM 8, FLG 0, XFL in `{0,2,4}`, any four-byte MTIME and one-byte OS values, no optional fields, and a valid trailer whose ISIZE and CRC-32 agree with bounded decompressed TAR bytes. Reject concatenated gzip members/trailing bytes. TAR is 512-byte POSIX ustar headers/data rounded to 512 bytes, followed by exactly two zero blocks and no other bytes. Each header has `ustar\0`, version `00`, valid unsigned-octal checksum, NUL/space padded octal numeric fields without sign/base-256, and ASCII name/prefix; name is `prefix + "/" + name` when prefix exists. Permit only regular `0`/NUL and directory `5`; directory has zero size and ends `/`, regular does not. Reject PAX (`x`,`g`), GNU long name/link (`L`,`K`), sparse, continuation, link (1/2), devices (3/4), FIFO (6), volume (V), reserved/unknown typeflags, nonzero devmajor/devminor, and nonempty linkname. Count headers including directories; add regular size before consuming payload; skip without materializing it.

For both profiles normalize names by rejecting NUL, empty components, `.`/`..`, leading `/`, `\\`, drive/UNC forms, encoding ambiguity or normalization change; split only `/`; reject duplicate normalized names and depth over 16. Stop before inflate/read beyond 1,024 entries, 134,217,728 regular expanded bytes, or 20:1 ratio (`expanded / max(1, immutable archive bytes)`). Return only `409 archive_unsafe`, never a parser reason/member name.

## Confirmation, adapter, replay, and recovery

Confirmation rechecks actor, permission, ready/nonexpired stage, stage digest, target, and full resolved release binding. It is actor-bound, ten-minute, opaque, and single-use.

Registration first performs durable lookup by actor, idempotency key, and full fingerprint: stage ID, staged archive digest, manifest digest, target ID, repo/tag/commit, selected platform/asset/archive type, and manifest schema. Exact replay returns the original operation without reading or consuming confirmation; altered reuse is `409 idempotency_conflict`.

The old #1464 request is `{repo,tag,expectedCommit,expectedManifestSha256,idempotencyKey,confirm:true}`. It has no stage, archive digest, platform asset, or stage-claim state. It cannot be asserted to implement this protocol. Core needs a reviewed **staged-registration adapter** over the source-safe resolver and direct-child importer. Its operation extends the safe #1464 operation with `source:"staged_release_asset"`, stage ID, staged-digest prefix, platform, asset name, and archive type. It reuses the one durable operation store; it does not create an incompatible journal.

For a new request under the cross-process lock: (1) reconcile unfinished staged-registration journal; (2) re-resolve and compare retained binding; (3) validate confirmation; (4) durably write `{version:1,operationId,stageId,fingerprint,phase:"prepared"}`; (5) atomically consume confirmation and claim stage with operation ID; (6) create/update the single durable operation as `unknown`; (7) invoke direct-child import once; (8) durably record completed/conflict/unknown and Audit outcome; (9) transition stage to `consumed`, delete bytes only by normal retention, and seal journal. Audit write failure retains a pending safe outcome and never repeats import.

Recovery under the same lock reads that journal first. A prepared/unclaimed journal may revalidate. A claimed/unknown operation reconciles its direct-child target before recording completion or retaining `unknown`; a terminal operation seals the stage and emits pending safe Audit. Contradictory stage, confirmation, operation, or journal IDs fail closed as `503 registration_unavailable`. Cleanup claims only eligible expired/terminal stages, deletes Core-owned bytes after retention, preserves metadata, never races a claim, and never repeats uncertain mutation.

Stable outcomes: `400 invalid_request`; `401 upload_token_invalid` / `confirmation_invalid`; `403 forbidden` / `unapproved_release`; `404 stage_not_found`; `409 release_binding_mismatch`, `chunk_sequence_conflict`, `stage_expired`, `stage_terminal`, `digest_mismatch`, `archive_unsafe`, `manifest_invalid`, `confirmation_required`, `confirmation_expired`, `idempotency_conflict`; and `503 release_provenance_unavailable` / `registration_unavailable`.

## Evidence gate

Implementation waits for fresh independent specification and security review. Required evidence: HTTP/JSON/status matrix; release resolver/checksum mismatch; each CLOSED-parser denial without extraction; duplicate-header/grammar/range/retry conflicts; issuance-only token redaction; retention/GET-after-cleanup; confirmation-before-new-only replay order; adapter atomic order, cross-process and hard-exit recovery; secret-free Audit; and packaged Core plus external CLI released-asset transfer. It must prove no install, start, restart, reload, or lifecycle effect.
