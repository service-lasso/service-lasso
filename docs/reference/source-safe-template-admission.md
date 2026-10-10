---
title: Source-safe template admission contract
---

# Source-safe template admission contract

**Status:** specified for Core issue [#1513](https://github.com/service-lasso/service-lasso/issues/1513); no endpoint or source-ingestion implementation is supplied by this document.

**Bindings:** `SPEC-002` `AC-4CF.1`, `SPEC-006` `AC-6E`, Core `#1462`, Core `#1463`, CLI `#1` and CLI `#8`.

## Purpose and boundary

This contract lets an authenticated external client admit a caller-selected,
locally authored service project to a remote Core without a shared filesystem.
It is the missing source-admission path needed for CLI `#1` and `#8`; a local
starter alone is not a complete create-to-running-service workflow.

Admission is deliberately narrower than generic source ingestion. Core accepts
only a bounded archive which proves derivation from a **server-recognized,
immutable, versioned canonical template contract**. A successful admission
materializes the complete validated inventory, not only `service.json`, through
the same exclusive direct-child boundary used by `AC-4CF`: each locked template
file, every contract-authorized authored file (including the declared example
configuration and provenance record), and the exact bytes of an immutable
script or executable payload when the catalog names one. Admission writes those
bytes; it never interprets or executes them. It does not install, acquire
release assets, run setup, start, stop, restart, reload, resolve secrets, adopt
a running process, or grant semantic approval of a service.

`#1463` remains the separate staged transfer of a checksum-bound asset selected
from an approved published Service Lasso release. Its release identity fields
and `confirm: true` grammar are not source-admission inputs, and source
admission must not add arbitrary URLs, arbitrary server paths, inline manifests,
or a generic upload route to that protocol.

## Required template authority and actual owner provenance

Core #1633 records the reviewed complete source contract; product implementation is absent. Historical service-template #17/PR18 reviews and failed candidates remain historical evidence, not assertions about today's owner policy. The frozen current design input is service-template commit3a91decdb788f7052352fcacef80a2bcadc380a6/tree121459ae48e27ce60bbf85b0b582b0904eb3a2b8:73 inventory paths, policy self-member and generated provenance make75. Policy has exact seven keys schemaVersion/templateVersion/contractDigest/inventory/quotas/authoring/provenance; descriptor eight keys schemaVersion/kind/templateCommit/templateVersion/contractDigest/contractSha256/archiveSha256/releaseTag. That source is not immutable publication or a catalog grant.

Before enablement the template producer publishes the original service-template.tar.gz, template-candidate.json, template-contract.json and SHA256SUMS under protected producer/tag/private-draft/provider/credential controls and immutable raw-byte readback. Publication precedes consumer admission and wrapper success. Independently reviewed source-owned Core and CLI entries pin repository/full40commit/version/tag/descriptor kind/raw policy and archive hashes/semantic contractDigest/all original asset sizes/hashes. Recognizing development-template-candidate or 1.0.0-dev is permitted only with this actual immutable authority; the word dev grants nothing. Core catalog additionally fixes templateId, SLTP profile/path eligibility version, designated service.json/config/example.env/template-provenance.json paths, every exact final path/mode/digest-or-closed-typed-difference rule and owner approval. Missing entry returns409 template_contract_unrecognized before reservation. Fixture catalogs/source HEAD/verifier PASS do not grant production authority.

Provenance is exactly six fields schemaVersion,templateRepository,templateCommit,templateVersion,contractDigest,origin; schemaVersion1 and templateRepository service-lasso/service-template. Local origin is exactly `{kind:local-archive,archiveSha256}`; github-derived origin exactly `{kind:github-derived,repository}`, bounded `owner/repository<=140` bytes under owner identity syntax. Repository URL may only be the matching owner-authorized `https://github.com/<repository>.git<=256`. No derived commit/build-manifest/catalogIdentity seventh field is invented. catalogIdentity is trusted source side `data<=256` UTF8 bytes/no controls/exact entry equality, never provenance. Provenance is evidence under the approved tuple, cannot become or enlarge the catalog.

All immutable bytes,0755 payloads, commands/hooks/provider/isolation/artifact/secret/URL declarations and locked containers/properties remain exact. Typed author-editable owner pointers are `id1..63/name1..120/description<=512/version<=64/enabled` `boolean/developers<=8` closed name-only `objects<=120/tags<=12` `strings<=48`, with actual owner patterns. Canonical pretty serialization/LF and closed nested shape are enforced; decoded duplicate keys/invalid UTF8 deny. Config only config/example.env under actual forbidden-name/value rules and65536 aggregate; no new files. Policy unchanged16896 bytes; `manifest<=6298/provenance<=479`; `total<=417316/files<=128/archive262144/expanded524288/records128/depth12`. Immutable328107+policy16896+manifest6298+provenance479+config65536=417316; no double count config. Full expected75 list and owner byte/mode/difference policy are catalog inputs, not caller supplied metadata.

Selected prospective source paths: src/runtime/service-source-admission/catalog.ts, scripts/prove-source-admission.mjs, scripts/verify-source-admission-proof.mjs. Pending separately owned Core PR1631/CLI PR36/TUI PR30/Template PR24 supply the canonical docs/reference/template-consumer-register.json topology: exactly cli-canonical-authoring then core-source-admission, Windows/Linux only, all TC01..TC12 and CA01..CA08. Missing catalogSource/bindings remain null under its closed success/failure/R3 receipt union; no third role/new publication asset/generic native-proof pass-through. Current canonical .governance/project/ga-platform-scope.json blob e694c3e314c1bf11e03dc4656730a96467a765b8 (authority Corea0384e676c1b2dbf66b915563ea70c176c09d598) is unchanged.
## Closed transport grammar

All JSON request bodies reject unknown properties. JSON is UTF-8, at most
`64 KiB`, with a maximum nesting depth of `16`; a string is at most `4 KiB`
unless a narrower bound appears below. `Content-Type` must be exact JSON for
JSON endpoints. Identifier and digest comparisons are case-sensitive.

### Generated opaque references

Core creates every opaque ID from 16 cryptographically secure random bytes,
encoded as 32 lowercase hexadecimal characters. It never derives an ID from a
path, actor, archive, clock, or counter. The accepted forms are stage
`sas_[a-f0-9]{32}`, preflight `sap_[a-f0-9]{32}`, confirmation
`sac_[a-f0-9]{32}`, and operation `sao_[a-f0-9]{32}`. A stored-ID collision
causes random generation to retry. Timestamps are RFC 3339 UTC with exactly
three fractional digits and `Z`; no timestamp contributes to a fingerprint.

### Upload HTTP grammar

After HTTP field-name case normalization, the upload has exactly one
`Content-Type` and exactly one `Content-Length`. It has no
`Transfer-Encoding`, `Content-Encoding`, trailer declaration, or trailers.
Duplicate required fields, including equal duplicate lengths, are invalid. The
sole media-type value, after outer HTTP whitespace removal, is exactly
`application/vnd.service-lasso.template-project+zip`; parameters are invalid.

The sole `Content-Length` is ASCII matching `^[1-9][0-9]{0,7}$`, with no
leading zero, sign, inner whitespace, decimal point, comma, or non-ASCII
digit. Its base-10 value is at most `10485760`, equals the stage's declared
`archiveBytes`, and Core reads exactly that many body octets. Early EOF, an
additional octet, framing ambiguity, redirect, multipart body, chunked body,
content coding, resumable offset, or trailer fails before the stage is written.

### CLOSED ZIP profile `SLTP-ZIP-1`

This is the common versioned policy for source admission, not a loose reference
to the separate `#1463` asset-transfer work. A recognized template contract
must name `SLTP-ZIP-1` or a later explicitly versioned replacement.

- The raw body is `1..10,485,760` bytes and has one single-disk classic EOCD,
  zero archive comment, no ZIP64 EOCD/locator, no multi-disk fields, and only
  32-bit local/central offsets and sizes. ZIP64 extra field `0x0001` is banned.
- It has `1..512` regular-file entries. The central count, declared
  `archiveEntries`, and parsed local-header count are equal. Each entry has no
  extra field or file comment; local and central method, flags, UTF-8 name,
  CRC-32, compressed size, and uncompressed size match exactly. Each local
  offset identifies one header, each header is referenced once, and file
  regions neither overlap nor reach the central directory.
- Only stored (`0`) and raw DEFLATE (`8`) methods are accepted. General-purpose
  bit 11 is set; bits 0--10 and 12--15 are clear, so encryption, data
  descriptors, compression options, and reserved
  flags are rejected. Split archives, unaccounted bytes before the central
  directory, and all central/local conflicts are rejected.
- Path eligibility is explicitly versioned `SLTP-CATALOG-PATH-1` within the
  unchanged `SLTP-ZIP-1` framing. Local and central names have identical strict
  UTF8 bytes, already NFC, and exact byte equality to a recognized source-owned
  catalog path. Dot-leading, ASCII case and @ are permitted only for those
  catalog paths and their immutable bytes (for example .github/workflows,
  AGENTS.md and services/@java). The prior lowercase-alnum-leading regex rejects
  46 of the actual75 paths and is retired for this version; old/mismatched
  catalog eligibility versions deny rather than silently widen.
  Preserve `<=12` segments/96 bytes per segment/240 total bytes, slash-relative
  nonempty segments, no dot/dotdot/backslash/absolute/drive/colon/NUL/control,
  Win32 forbidden characters, ADS, DOS device or trailing dot/space. Validate
  full catalog namespace once; reject exact duplicates, ASCII case-fold aliases
  in canonical parents, file/ancestor collisions and Unicode aliases. The
  selected owner paths are ASCII and sorted by exact ASCII bytes for digest
  records. No arbitrary workflow/source edit authority follows. Unsupported
  catalog paths fail closed; every actual75 path must pass before activation.
- Every transport entry has Unix mode exactly `0644` and external attributes
  identifying a regular file. This is the ZIP transport mode only: it is not
  the final materialized mode. Directories, symlinks, hardlinks, devices,
  FIFOs, sockets, DOS directories, and executable encodings are rejected.
  Timestamp and host metadata are covered by the raw hash but excluded from
  normalized identity. The recognized immutable template catalog supplies the
  final mode for every admitted path; it may authorize an executable final mode
  such as `0755` only for an exact catalog entry.
- An entry expands to at most `8,388,608` bytes; total expanded bytes are at
  most `67,108,864`. A nonempty compressed payload expands by at most 100x; a
  zero-length payload has both sizes zero. Core streams output to a quota meter
  and CRC-32 accumulator: expanded size and CRC must match before inventory
  acceptance. It performs no filesystem extraction during validation.

This permits ordinary producer output with stored/DEFLATE entries and UTF-8
names while excluding features that defeat bounded single-pass validation.

### Canonical digests and admission fingerprint

Every SHA-256 below is 64 lowercase hexadecimal ASCII characters. `archiveSha256`
is SHA-256 over the exact received ZIP octets: it binds producer metadata,
ordering, compression, and every raw byte; it is not a normalized-content hash.

`stagedDigest` is SHA-256 of `SLTP-STAGED-1`: literal UTF-8
`SLTP-STAGED-1\\n`, followed by entries ordered by validated ASCII path. For
each entry, append exact UTF-8 records:

```
path=<decimal UTF-8 byte length>:<path>\n
transportMode=4:0644\n
bytes=<decimal ASCII length>:<base-10 uncompressed byte count>\n
sha256=64:<per-file lowercase SHA-256>\n
```

`decimal` is `0` or a nonzero ASCII digit followed by ASCII digits, with no
leading zero. Per-file digest comes from the bounded expanded-byte stream; Core
does not serialize JSON to obtain this digest. This normalizes ZIP timestamps,
compression representation, header order, and JSON property order while binding
each admitted path, transport mode, byte count, and file byte.

`materializationDigest` is SHA-256 of `SLTP-MATERIALIZATION-1`: literal UTF-8
`SLTP-MATERIALIZATION-1\\n`, followed in exactly this order by the recognized
source-catalog identity records `templateId`, `templateCommit`,
`templateVersion`, and `contractDigest`, each as
`<key>=<decimal UTF-8 byte length>:<value>\\n`. It then contains one ordered
record group for every admitted path. Each path record uses the same length
framing; each entry group is exactly:

```
path=<decimal UTF-8 byte length>:<path>\n
finalMode=4:<catalog-authorized four-octal-digit mode>\n
bytes=<decimal ASCII length>:<base-10 uncompressed byte count>\n
sha256=64:<per-file lowercase SHA-256>\n
```

In every digest grammar in this document, `\\n` denotes exactly one byte `0x0A`,
not a two-character escape or a platform newline. The byte stream has no BOM,
CRLF conversion, separators, padding, or implicit final record. `decimal` has
the grammar defined above; each `path` is the already-validated UTF-8 path
octets, and each mode/digest/byte-count value has the exact ASCII spelling shown
in its record. The path groups are ordered by validated ASCII path and the
digest includes the entire inventory, with no optional, synthetic, or omitted
entry. `finalMode` is exactly `0644` or `0755` and is the mode that the
materializer must apply, not the ZIP transport mode: every ZIP entry remains
`0644`, while only a catalog-authorized immutable executable payload can
therefore be materialized as `0755`. Core derives every final mode from the
recognized source catalog during preflight and rederives it during commit and
recovery; it never trusts an archive mode or a client-provided final mode.

`manifestSha256` is SHA-256 over the exact expanded bytes of the contract's
designated manifest entry (`service.json`). JSON parsing validates the schema,
but no digest relies on parsed-property order, whitespace, number spelling, or
Unicode reserialization.

`candidateRevision` and `admissionFingerprint` are the same SHA-256 result of
`SLTP-CANDIDATE-1`: literal UTF-8 `SLTP-CANDIDATE-1\\n`, then exactly these
records in this order, using `<key>=<decimal UTF-8 byte length>:<value>\\n`:

```
templateId
templateCommit
templateVersion
contractDigest
serviceId
version
archiveSha256
stagedDigest
manifestSha256
materializationDigest
effectSet
```

Each value is the validated preflight value; `effectSet` is exactly
`direct-child-source-materialization;no-lifecycle`. Fields are never optional,
reordered, truncated, JSON-encoded, Unicode-normalized at digest time, or
represented as JSON numbers. Declared byte/count values are rechecked against
the archive and stage before this sequence is made. `candidateRevision` is the
client-visible name; `admissionFingerprint` is the same value retained by
confirmation, idempotency, Audit, and recovery. They are never distinct
algorithms.

| Endpoint                                                             | Request and success response                                                                                                                                                                                                                                                                                                                                                   | Authority and effect                                                                                                                                                                                                                                                                                                                                                                                 |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/service-source-admission/stages`                          | Request: `{ "template": { "templateId", "templateCommit", "templateVersion", "contractDigest" }, "declared": { "serviceId", "version", "archiveSha256", "archiveBytes", "archiveEntries", "manifestSha256" } }`. Success `201`: `{ "stage": { "id", "expiresAt", "maxBytes", "maxEntries" } }`.                                                                                | Requires `service:configure`. Creates an actor-scoped `sas_` reservation. `templateCommit` is 40 lowercase hex; `contractDigest`, `archiveSha256`, and `manifestSha256` are 64 lowercase hex; `serviceId` uses the existing manifest ID grammar; `version` is a bounded declared manifest version. `archiveBytes` is `1..10_485_760`; `archiveEntries` is `1..512`.                                  |
| `PUT /api/service-source-admission/stages/{stageId}/content`         | Body is one fixed-length `application/vnd.service-lasso.template-project+zip` stream under the upload HTTP grammar. Success `204`.                                                                                                                                                                                                                                             | Actor-scoped opaque `sas_` stage only; no path, URL, token, manifest, or filename parameter. Core verifies exact `archiveSha256` and the complete `SLTP-ZIP-1` profile while streaming to a private stage. A stage is write-once and expires after 15 minutes.                                                                                                                                       |
| `POST /api/service-source-admission/preflights`                      | Request: `{ "stageId", "archiveSha256" }`. Success `201`: `{ "preflight": { "id", "candidateRevision", "serviceId", "template": { "templateId", "templateCommit", "templateVersion", "contractDigest" }, "stagedDigest", "materializationDigest", "expiresAt", "confirmation": { "id", "expiresAt" } } }`.                                                                              | Requires `service:configure`. Parses the staged archive with the recognized template contract, validates the declared manifest digest/schema, computes the normalized staged digest, canonical complete materialization digest, and `candidateRevision`, and issues a server-side single-use confirmation bound to actor, stage, candidate revision, materialization digest, target service ID, template identity, and no-lifecycle effect set. It has no import effect. |
| `POST /api/service-source-admission/preflights/{preflightId}/commit` | Request: `{ "confirmationId", "idempotencyKey" }`. New durable admission: `202` with `{ "operation": { "id", "kind": "source_admission", "status": "accepted", "replayed": false, "serviceId", "template", "candidateRevision", "stagedDigest", "materializationDigest", "inventoryCount", "createdAt", "completedAt": null, "errorCode": null } }`. Exact replay: `200` with the stored projection and `replayed: true`. | Requires `service:configure`, a valid server confirmation, and a unique opaque 8–128-character idempotency key matching `^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$`. The only durable product mutation is atomic direct-child materialization of the complete validated inventory.                                                                                                                                                  |
| `GET /api/service-source-admission/operations/{operationId}`         | Success `200` returns the stored safe operation projection, including `accepted` and every terminal status.                                                                                                                                                                                                                                                                    | Actor-scoped readback only. Unknown, foreign, expired, or malformed IDs return the same `404 operation_not_found`.                                                                                                                                                                                                                                                                                   |

The stage upload credential is the authenticated transport session; the API must
not mint an upload bearer token. Redirects, multipart forms, chunked requests,
content encodings, resumable offsets, trailers, and server-selected source
locations are unsupported in v1. A lost upload is retried only by creating a
new stage.

## Validation and provenance rules

Core validates the archive before preflight completion in this order:

1. transport limits and archive structural safety;
2. exact archive digest and declared entry/byte counts;
3. recognized immutable template tuple and contract digest;
4. normalized file inventory, required files, file modes, and all unchanged
   template-file digests;
5. allowed-difference paths, schemas, value constraints, and aggregate limits;
6. the closed `service.json` schema, declared `serviceId`, `version`, and
   manifest digest; and
7. the required `config/example.env` and `template-provenance.json` entries,
   their exact path-policy/digest-or-allowed-difference rule, and every
   immutable script or executable catalog payload byte/digest; and
8. provenance record and the template contract's repository/template-origin
   rules.

Preflight has no service-root effect. It may retain the bounded private stage
until expiry, but it does not create a target directory or a durable admitted
project. Commit constructs the fingerprint-bound capsule only from the already
validated staged bytes, persists it with the `accepted` record, and recomputes
the same canonical `materializationDigest` from its complete inventory and
current recognized source catalog before the first filesystem write. A stage,
preflight, or capsule from another actor, service ID, template tuple, candidate
revision, materialization digest, or fingerprint is unusable.

Executable files, command lines, shell/PowerShell/Node scripts, source code,
workflow files, action/setup/update hooks, artifact source/checksum data,
provider/isolation declarations, secret references, and URLs are rejected with
`template_difference_forbidden` unless a later immutable template contract
names that precise path and rule. Core never interprets accepted project files
as commands during admission.

The server accepts no `clientPath`, `serverPath`, `manifest`, `archive`,
`sourceUrl`, `repo`, `tag`, `expectedCommit`, or `confirm` field in any
source-admission request. It uses only its private stage path internally and
never returns that path. The template commit is provenance, not release-asset
authority: Core validates it against its recognized template-contract catalog;
it does not fetch a repository, resolve a branch/tag, or download an asset.

## Confirmation, durability, and recovery

The confirmation is issued only after a complete preflight and expires after
five minutes. It is consumed exactly once by `commit`; it fails closed if its
actor, target service ID, stage digest, candidate revision, template tuple, or
declared no-lifecycle effects change. A boolean confirmation is never accepted.
The existing shared confirmation issuer may be reused only after a reviewed
adapter proves all of those bindings and single-use storage semantics.

Before creating the service directory, Core durably writes an `accepted`
operation. `accepted` is the sole nonterminal source-admission status: the
actor, confirmation, `admissionFingerprint`, `materializationDigest`,
idempotency identity, intended direct-child mutation, and a private
fingerprint-bound materialization capsule are durable, but no target write is
claimed. The capsule contains the exact expanded bytes and the canonical
complete materialization inventory: source-catalog identity, validated path,
final catalog-authorized mode, byte count, and digest for **every** admitted
entry. It is private implementation state, encrypted at rest where Core's
storage supports encryption, accessible only to the admission worker and
reconciliation, and deleted only after a completed durable Audit outcome. The
capsule bytes are never represented in an operation, Audit, HTTP response, CLI
output, or diagnostic; the safe `materializationDigest` and inventory count are
represented consistently. The only initial states are `accepted`
(nonterminal), then terminal `completed` (complete inventory and exclusive
discovery prove one admission), `conflict` (collision proven and no admission),
`denied` (post-acceptance revalidation denied before mutation), `failed` (known
pre-write failure), or `unknown` (write/reconciliation/Audit uncertainty
prevents a result claim).

The materializer uses the existing workspace-root trust boundary, serializes by
workspace and service ID, and creates only the requested service ID as one
exclusive direct child of that root. It opens the trusted root and every child
segment without following links or reparse points; it rejects a substituted,
redirected, existing, or non-directory root/target. It creates a private
same-volume direct-child staging directory with exclusive creation, writes each
capsule entry through no-follow directory handles, verifies its byte count and
SHA-256 before close, applies only the final catalog-authorized mode, fsyncs files and
directories where supported, then atomically renames that complete staging
directory to the previously absent service-ID child. It never creates parents
outside that child, follows a symlink/reparse point, overwrites an existing
target, merges into retained content, or makes a target visible before the full
inventory is present. An immutable executable payload may be written only as a
catalog-inventory byte/mode entry; it remains non-executed by admission.

The durable operation record contains only the operation ID, actor ID, stable
service/template/version identifiers, `admissionFingerprint`/candidate
revision, `stagedDigest`, `materializationDigest`, inventory count, timestamps,
status, and safe error code. It stores an HMAC of the idempotency key under a server-held key
only for lookup. The private capsule is referenced by an opaque internal handle
and is not an operation record. Neither record nor Audit stores raw keys,
confirmations, archives, manifests, paths, URLs, config, logs, credentials, or
secrets.

Confirmation binds the same `admissionFingerprint` and
`materializationDigest`; commit recomputes both before consuming confirmation.
Idempotency is actor plus key-HMAC: the same actor, key, fingerprint, and
materialization digest returns the stored operation with `200` and
`replayed: true`, whether `accepted` or terminal. It never creates another
operation or repeats an import. A changed fingerprint returns `409
idempotency_key_reused`. Concurrent callers receive `409 idempotency_in_progress`
only until the first durable `accepted` record is readable, after which they
receive the exact replay. A different actor cannot read or replay the record.

After a crash or write uncertainty, Core reconciles only the original durable accepted lineage (including its retained unknown outcome under the no-loss adapter below).
It first reopens the recognized source catalog and recomputes the complete
canonical `materializationDigest` from the capsule's full inventory, including
every path, final mode, byte count, file digest, and source-catalog identity;
that value must equal the stored operation, the capsule, the confirmation
binding, and the digest input to the recorded fingerprint. It then reopens the
trusted root and target with the same no-follow containment checks, discovers
exactly the recorded service ID, and independently recomputes that complete
materialization digest from every target file before it may make any completed
publication, Audit outcome, response claim, or stored status transition to
`completed`. If no target was ever created and the intact fingerprint-bound
capsule is available, Core may resume the one atomic materialization under the
original operation only after the same full recomputation and verification; it
does not create a second operation. Any partial staging state is private
recovery state and may be discarded only after no-follow containment and target
absence are proved. Any absent-with-uncertain-write, different, redirected,
symlinked, duplicate, catalog-identity-mismatched, materialization-digest-
mismatched, or undiscoverable target becomes `unknown` with
`admission_reconciliation_required`; Core never overwrites a target, deletes
retained content, or infers adoption.

Audit uses the same `admissionFingerprint`. If required Audit cannot be made
durable before mutation, commit returns `503 audit_unavailable` and creates no
operation or target. If it becomes unavailable after `accepted` is durable or a
write might have occurred, Core records terminal `unknown` with
`audit_unavailable`; before the commit response it returns `503` with a safe
operation projection containing the `sao_` ID. If `202` already returned, the
worker changes durable operation/GET to unknown and cannot retroactively change
that HTTP response. It does not retry mutation. Actor-authorized GET of that ID returns `200`
with the same stored safe projection. The `503` reports missing Audit certainty;
the `200` only reports durable readback. Exact replay returns that projection
with `200` and `replayed: true`.

## Stable errors and HTTP status

| Status  | Code                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Meaning                                                                                                                              |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| 400     | `invalid_body`, `invalid_stage_metadata`, `invalid_stage_content_type`, `invalid_upload_framing`, `invalid_archive_digest`, `invalid_idempotency_key`                                                                                                                                                                                                                                                                                                       | Closed grammar, declared limits, required upload headers/framing, media type, or digest/key syntax failed.                           |
| 401/403 | `authentication_required`, `permission_denied`                                                                                                                                                                                                                                                                                                                                                                                                              | No trusted actor or no `service:configure`; no stage/import mutation.                                                                |
| 404     | `stage_not_found`, `preflight_not_found`, `operation_not_found`                                                                                                                                                                                                                                                                                                                                                                                             | Missing, foreign, or malformed opaque stage/preflight reference; operation expired/missing/foreign/malformed remains404. Owning stage expiry is409 stage_expired; owning confirmation expiry is409 confirmation_expired.                                                                            |
| 409     | `stage_already_written`, `stage_digest_mismatch`, `stage_expired`, `archive_limit_exceeded`, `archive_unsafe`, `template_contract_unrecognized`, `template_difference_forbidden`, `manifest_contract_mismatch`, `provenance_mismatch`, `confirmation_required`, `confirmation_invalid`, `confirmation_expired`, `confirmation_already_used`, `confirmation_binding_mismatch`, `target_service_exists`, `idempotency_key_reused`, `idempotency_in_progress` | Safe conflict or policy denial; response reveals no file/path/source detail.                                                         |
| 413     | `archive_too_large`                                                                                                                                                                                                                                                                                                                                                                                                                                         | Declared or streamed compressed/expanded limit exceeded.                                                                             |
| 422     | `template_contract_invalid`, `manifest_schema_invalid`, `provenance_invalid`                                                                                                                                                                                                                                                                                                                                                                                | A complete but semantically invalid closed contract input.                                                                           |
| 429     | `admission_rate_limited`                                                                                                                                                                                                                                                                                                                                                                                                                                    | Actor/client stage or preflight quota exceeded.                                                                                      |
| 503     | `operation_store_unavailable`, `audit_unavailable`, `admission_reconciliation_required`                                                                                                                                                                                                                                                                                                                                                                     | Durable safety state cannot be established. A stored `unknown` includes its safe operation projection for actor-scoped GET readback. |

Responses use `{ "error": { "code": "…", "message": "safe stable summary", "correlationId": "…" } }`. They contain no raw parser exception, archive listing, file path, source content, config, URL, credential, token, or secret.

## Audit and evidence

Every allowed, denied, parser-rejected, confirmation-rejected, failed,
replayed, and reconciled attempt appends one durable safe Audit event. Its
metadata is limited to correlation ID, action, actor/client identity,
stage/preflight/operation opaque IDs, template tuple, service ID,
`admissionFingerprint`, candidate/staged/materialization digests, inventory
count, outcome, replay flag, and
stable error code. `audit_unavailable` explicitly claims no successful required
Audit append; its durable safe operation record is recovery evidence, not an
Audit substitute.

Implementation must add a contract matrix covering:

| Scenario                         | Required proof                                                                                                                                                                                                                                                                                                                                   |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| valid template-derived project   | Stage, preflight, confirmed admission, atomic direct-child discovery of the full closed inventory (locked files, allowed manifest/configuration, provenance, and immutable script/executable bytes), and no install/setup/start/reload.                                                                                                   |
| client-selected local output     | CLI packages an arbitrary caller-selected directory; HTTP capture proves no local path is transmitted.                                                                                                                                                                                                                                           |
| schema and archive abuse         | Unknown JSON fields, oversized/deep JSON; duplicate/missing upload headers, invalid decimal length, transfer/content coding, trailers, wrong media type; each forbidden ZIP method/flag, descriptor, ZIP64, local/central conflict, UTF-8/path, offset, CRC, count, quota, and no-extract condition; digest mismatch; expired/write-twice stage. |
| template and provenance variance | Unknown tuple, altered commit/contract digest, missing/changed required file, forbidden executable/command/source/workflow/hook/provider/secret/URL edit, allowed scalar edit, malformed provenance.                                                                                                                                             |
| authority and confirmation       | unauthenticated, ungranted, cross-actor stage/preflight/operation access, expiry, reuse, and every actor/target/digest/template/candidate binding alteration.                                                                                                                                                                                    |
| durable outcomes                 | `202 accepted` readback, exact nonterminal/terminal replay, altered-key retry, fingerprint-bound capsule construction, transport-`0644` versus catalog-final-mode (including catalog-authorized `0755`) distinction, crash before/during/after staging or atomic rename, and restart recomputation of the full source-catalog identity/path/final-mode/byte/digest materialization digest before any completed publication; target collision, symlink/reparse/redirection containment denial, and the `503` Audit-outage versus `200` stored-operation distinction. |
| output safety                    | Audit, operation, HTTP errors, CLI stdout/stderr, and retained diagnostic artifacts have no raw archive/manifest/path/config/log/token/credential/secret material; capsule access and cleanup are proved without exposing its bytes.                                                                                                         |
| distribution                     | Exact-head Core CI plus a fresh packaged Core and released external CLI on Windows and Linux; Darwin is deferred under canonical platform policy, never PASS. Direct remote create-to-running-service proof remains distinct from mocked transport tests.                                                                                                                                                                  |

The packaged CLI evidence must prove `service init` or its successor produces a
recognized-template-derived local project, stages only the selected output,
waits/readbacks the durable operation safely, and does not claim release,
deployment, GA, or lifecycle success. Independent specification and security
review are required before implementation.

## Self-check

This contract has one source-admission mutation (complete validated source
materialization), never accepts either client or server paths, uses template
provenance rather than release-asset provenance, and does not make `#1463` a
general uploader. It requires both a published template-owner contract and a
reviewed Core catalog pin before implementation, keeps client authoring output
supportable through a bounded stage, and keeps permission, confirmation,
idempotency, recovery, Audit, and packaged proof distinct.

## Selected admission v1 actor, response and expiry precedence (#1633)

This section completes the selected contract and takes precedence over historical general wording above. All route bodies remain exactly the endpoint table, including `preflight.confirmation{id,expiresAt}`; no sibling confirmation field. Trusted middleware actor/client/workspace identities are internal authority, never request fields. Admission routes and actor-scoped GET require authentication then service:configure before bounded schema/reference processing; only generic bounded transport rejection may precede auth. After auth and permission: closed request/header grammar, opaque reference syntax/actor ownership, exact replay where relevant, owning expiry/use/binding, policy/body parser. Foreign/missing/malformed lookup returns the same404 stage_not_found/preflight_not_found/operation_not_found without parser details. Existing stage of the owning authenticated actor expired returns409 stage_expired; existing expired owning confirmation409 confirmation_expired. Existing expired preflight with an owning confirmation uses confirmation_expired; otherwise preflight_not_found. GET malformed/missing/foreign/expired remains404 operation_not_found.

Commit first resolves exact retained actor/key-HMAC mapping after bounded body syntax and authentication, before preflight/stage/confirmation expiry or used rejection. Replay lookup retains original preflight/candidate association: same actor/key bound original preflight/fingerprint/materialization returns200 stored operation replayed:true, including accepted/unknown; changed preflight/fingerprint returns409 idempotency_key_reused. If no mapping exists perform owning lookup, stage/preflight expiry, confirmation syntax/existence/actor/bindings/expiry/single-use validation, full current catalog/capsule revalidation and durable admission. Raw confirmation/key never enters public projection. Idempotency mappings and operations are not GC'd with expired stage or a deliberately expired public GET reference. A retained mapping can replay even if its public GET reference is expired; this does not disclose another actor's record.

Safe operation exact keys id,kind,status,replayed,serviceId,template,candidateRevision,stagedDigest,materializationDigest,inventoryCount,createdAt,completedAt,errorCode. kind source_admission; template exact templateId/templateCommit/templateVersion/contractDigest; IDs/digests/timestamps retain the table's closed syntax; inventoryCount1..128 and for selected owner75. accepted has completedAt:null/errorCode:null. Terminal completed has RFC3339 completedAt/errorCode:null; conflict/denied/failed/unknown use a terminal timestamp and fixed safe error from the existing error table. replayed is request projection only. Actor authentication data/key/confirmation/path/manifest/config/capsule handle/URL/native custody do not appear. Errors retain exact `error{code,message,correlationId}`; postaccepted safe503 adds operation of this same grammar. All existing400/401/403/404/409/413/422/429/503 codes stay closed. Parser detail cannot cross ownership/auth boundaries.

## Selected finite admission and storage bounds

Core's dedicated `service-lasso.source-admission-journal.v1` is a source-admission-only versioned journal. It stores actor/client/workspace-qualified stages/preflights/confirmation bindings, operation records/key-version-HMAC mappings, opaque capsule references, reservation/IO ownership and fixed pending safe Audit payloads. It is not an implicit extension of registration store v1 or shared confirmation raw writeFile records. Complete strict schema/UTF8/duplicate-key/size/digest/version validation precedes use; current release registration/lifecycle journals remain separate.

Initialization is one explicitly owner-authorized native storage action over an established trusted Core workspace/provider identity. It verifies every exact source journal/capsule/storage marker absent, exclusive held root ownership and real persistent HMAC key provider/key-version identity, creates/flushed/verifies an empty v1 generation and custody marker under cross-process lock, then enables endpoints. A fixture grant or ordinary endpoint invocation never initializes storage. Thereafter missing/corrupt/partial/mismatched journal/key/marker returns503 operation_store_unavailable and retains state, never empty fallback, automatic new key or arbitrary scan. Provider identity and key version persist; rotation requires source-reviewed backward read mapping retaining old key-HMAC lookups and accepted records, no session-generated replacement. No raw key enters journal/Audit/output.

Source bounds:4 active-or-retained stages per actor/client,16 per workspace and Core instance;4 preflights per actor/client,16 per workspace/instance; one preflight/confirmation per stage/candidate revision. Rolling server-owned60s windows allow16 stage creations and32 preflights per actor/client; overage429 admission_rate_limited before allocation. Stage15min/confirmation5min cannot discard an accepted mapping. Reserve declared compressed plus catalog maximum expanded/capsule and copy allowance atomically before201; raw aggregate `<=167772160`, expanded/capsule `allowance<=1073741824` and parser/stream copy `allowance<=134217728` per Core instance, narrower catalog limits dominate. Accepted capsules, preaccepted orphans, unfinished expiry deletion, stalled IO and retained target/recovery resources count until actual owned completion and verified cleanup. Reservation is not released by timeout or happy-state transition. No accepted operation, capsule, key mapping or pending Audit payload is evicted to admit new work.

Finite durable storage ceilings are4096 stage/preflight history records,4096 operation/key mappings,8192 pending/acknowledged Audit records,16777216 journal bytes and1073741824 capsule/orphan bytes per instance. On reaching any ceiling deny new stage before growth (429); required journal/Audit transition capacity is pre-reserved at admission, including accepted, terminal, unknown and reconciliation acknowledgments. Reserve2 history records+1 operation/key record+8 Audit slots+32768 journal bytes per stage in addition to the byte/copy budget; inability to reserve denies. Retained reservations recover from the verified journal, not reconstructed happy paths. Exhaustion never deletes prior accepted history; a separately authorized reviewed no-loss archival/migration is required to regain capacity. These are selected source ceilings, not measured host license or authority to enlarge owner quotas. Actual crash/native acceptance must validate host resource bounds before enablement.

Logical deadlines use minimum of source values and existing stricter protected deadline:10s upload idle,40s upload absolute,10s preflight,40s commit acceptance/materializer absolute; native storage/Audit wait10s within that40s. Timers are independent of IO/state locks; locks are short except separate actual host-qualified cross-process serialization whose unresolved ownership remains retained. Late results cannot authorize writes. Logical timeout yields safe unknown when write/Audit may have occurred; actual owned IO/handles/buffers remain reserved/unresolved until completion. No arbitrary-kernel finite completion/no-atime/all-physical-descendants guarantee, unknown PID kill, privileged broker or cleanup authority is introduced. Supported Windows/Linux terminal original-child closure under original stricter deadlines remains an actual required acceptance gate.

## Selected no-loss transaction and durable Audit adapter

Before accepted generation or any target write, required premutation safe Audit event must be durably append-verified through the source-admission Audit adapter; failure503 audit_unavailable creates no accepted operation or target. Prepare a fixed event ID and exact safe payload in a durable preaccept intent so crash retry can verify this same event without mutation. If this intent/capsule is abandoned it remains a accounted private orphan until proved owned disposition. Audit alone is not accepted authority.

Under trusted-workspace/cross-process/service lock, exclusively create the full75 capsule, recompute all path/mode/length/digest/catalog/fingerprint bindings, flush and verify capsule object and parent directory with admitted host capabilities. Then one atomic durable journal generation binds consumed confirmation, actor+keyVersion+keyHMAC mapping, operation status accepted, original preflight/candidate and immutable capsule identity, reservation ownership and a pending accepted Audit event with fixed ID/exact safe payload. This generation is the linearization point. File/directory flush, atomic same-directory replacement and lock/native ownership need real Windows/Linux qualification; rename/append API success is not durability proof. No target write before capsule/journal/premutation Audit durability. Failure before generation has no accepted operation/target; uncertain generation or key/storage durability denies write and retains/reconciles safely.

Journal outbox entries are dedicated admission events, not a generic shared event platform. Each has fixed CSPRNG event ID, bounded exact safe payload, operation/correlation/phase identity and pending/acknowledged state. Allowed phases are premutation,accepted,outcome,reconciliation; phase payload is fixed once created. Payload allowed keys are correlationId,action,actorId,clientId,stageId,preflightId,operationId,template,serviceId,admissionFingerprint,candidateRevision,stagedDigest,materializationDigest,inventoryCount,outcome,replayed,errorCode, with null absent values, closed template shape and fixed action `source_admission_<phase>`. No raw auth/key/confirmation/path/source/content/config/log/capsule enters it. Denied/parser/confirmation/replay attempts use the same safe Audit sink with action source_admission_attempt; failed sink reports503 without accepted mutation.

Flush through an idempotent adapter: append fixed ID+payload once, enforce duplicate ID EXACT payload equality (mismatch is corruption503), flush supported durable file/storage and containing directory as needed, read back original event and byte-exact canonical safe payload/durable receipt; only then a later flushed journal generation acknowledges emission. Current Audit appendFile and duplicate-ID return without payload comparison do not satisfy this. It needs explicit flush/recovery/corruption behavior; no existing fsync claim is inferred. Crash after durable Audit but before acknowledgement replays SAME ID/SAME payload and readback, never second mutation/event with a new ID. Journal pending outcome survives outage/crash. No operation-only record is an Audit substitute.

Before materialization write intent is durably recorded; crash phases distinguish known-never-created target from uncertain write. Native held no-follow materializer uses established trusted root, exclusive same-volume staging, all75 held handles/full final modes+hash/byte-count readback/supported flush and no-replace atomic direct-child rename. It never receives input asset handles, generic caller path authority or lifecycle capability. JS lstat/realpath/rename prechecks cannot substitute. Immutable executable0755 bytes remain nonexecuted. Complete discovery and all75 target byte/mode/catalog materializationDigest readback are required before completed outcome. Any extra/missing/aliased/redirected/partial target, uncertain absence, lost capsule/catalog/key or digest divergence is unknown admission_reconciliation_required; retain target and evidence. Known collision with no admission=conflict; postaccepted denied before write=denied; proven prewrite failure=failed. Resume only original accepted operation with intact capsule and durable proven never-created target; no second import or install/start.

Outcome/reconciliation fixed Audit ID+payload is durably pending in the same generation as result evidence. Do not publish completed status until full discovery AND exact durable outcome Audit readback/acknowledgement; unresolved pending/outage/crash becomes retained unknown. Recovery validates journal/capsule/catalog/full digest, idempotently flushes all pending event IDs, readbacks and durably acknowledges; retained unknown may reconcile to completed only through this same original operation/evidence, never reexecute effects. Safe503 before commit response includes stored unknown operation if accepted existed; failure after202 changes durable operation/GET to unknown and cannot alter prior response. GET/exact replay200 means stored readback only. Capsule cleanup requires completed durable Audit and actual exclusive containment/closure; failed/unknown/pending/orphan evidence is retained under disposition. No target/evidence destruction or arbitrary directory scan.

## Complete CA acceptance and direct released journey

| Gate | Required proof |
| --- | --- |
|CA01|Full75 stage/upload/preflight/nested confirmation/accepted/terminal exclusive direct-child materialization and complete discovery; zero implicit lifecycle.|
|CA02|CLI packages only user-selected local output; no path HTTP/Audit/operation/diagnostic.|
|CA03|Closed JSON/header/SLTP framing/method/flags/CRC/regions/UTF8/catalog-path/quotas/EOF/depth/no-extract/digest/expiry/write-once matrix.|
|CA04|Independent actual tuple/pin, exact six-field provenance, all locked path/bytes/modes/containers, only typed allowed differences/config.|
|CA05|Trusted actor/service:configure, foreign indistinguishable404, owning expiry409, every single-use confirmation binding and exact retained replay precedence.|
|CA06|Atomic accepted+capsule+confirmation/key mapping before write; complete modes/digest/readback, crash at every write/rename/journal/Audit boundary, retained resources, no-loss restart/outbox acknowledgement, safe202/503/GET/unknown distinctions.|
|CA07|Closed public/Audit/diagnostic output, private capsule/IO access, proved owned cleanup and retained unknowns; no raw private material.|
|CA08|Exact source/natural CI and actual released external CLI+fresh packaged Core Windows/Linux remote create→complete discovery→separately authorized actual running-service/health/process/lifecycle.|

Actual sequence: legitimate original immutable four assets, independent reviewed CLI/Core pins, matching released native CLI init, independent owner full project verification, faithful complete SLTP ZIP with transport0644 and final modes catalog-only, authenticated remote stage/upload/preflight, operator confirmation of exact no-lifecycle source effects, commit/poll/safe terminal readback/full remote discovery. Then separately authorized confirmed setup/install/start through existing lifecycle facade and actual immutable manifest; prove running/health/original process ownership and durable lifecycle readback, preserving original stop/maintenance gates. Missing runtime/provider/secret grant or required forbidden edit is a real dependency, never fake health/fixture permission. Original TUI five actions, staged-service Windows ZIP/Linux-macOS TAR and identical published tools in Core archive/npm remain separate. No publication-to-consumer circular gate; wrapper failure cannot erase published assets.

Different fresh ENTIRE durable review and coordinated develop landing precede complete CLI/Core product authors. Pending errata owners' source is frozen separately, never branch origin. Each product author needs different entire source review and NEW complete-input ROOT/native admission before execution; original policy/provider/native failure evidence remains unchanged. Rollback disables endpoints/fails closed on version mismatch, preserves journals/key mappings/capsules/projects/original assets/failed evidence, and never silently resets or migrates missing state. Source GO, natural CI, native qualification, immutable publication, catalog admission, Core integration, technical readiness and owner GA remain distinct.

[Complete actual75 design inventory](canonical-template-path-inventory.md) records every owner path/baseline mode/size/digest without granting publication/catalog authority.

## Closed scalar/key and public retention completion

templateId is1..128 ASCII bytes matching `^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$` AND exact recognized catalog equality; this declares grammar, not a fabricated template ID. templateCommit exactly40 lowercase hex, all digests64 lowercase hex; templateVersion and declared version1..64 bytes match actual owner semantic version pattern `^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$` and catalog/manifest equality respectively. serviceId uses owner1..63 pattern. archiveBytes/archiveEntries are JSON integer numbers under prior tighter bounds (no string/coercion). JSON members are case-sensitive; strict UTF8, decoded duplicate property rejection, depth16, string4096, body65536, finite numbers, no BOM/unknown/trailing JSON. Preflight expiry is the earlier of stage expiry and confirmation5min expiry. Ordinary v1 does not expire accepted/terminal public operation references automatically; if a later authorized no-loss retention policy expires a public ref, GET404 remains while exact key replay mapping is retained. No GC follows stage expiry.

Key lookup is HMAC-SHA256 under actual persistent key version over `SLTP-IDEMPOTENCY-1`+one zero byte then u32 big-endian UTF8 actorId length/actorId then u32 key length/exact ASCII key. Trusted actor IDs are stable provider identities, `bounded<=256` UTF8 bytes/no controls; provider+workspace identity scopes storage so another provider's actor string cannot collide. Existing old key versions remain available through approved rotation read mapping. HMAC identity is internal, not API/Audit. Safe Audit canonical payload serialization is strict UTF8 recursively sorted object keys, array order unchanged, compact JSON plus exactly one LF; every field is present with null where unavailable. correlationId is existing source-owned safe correlation `identity<=128` bytes/no controls; Audit outcome is exactly allowed/denied/failed/replayed/accepted/completed/conflict/unknown/reconciled and errorCode null or existing stable table value, replayed boolean. Durable receipt binds fixed event ID, payload SHA256, byte count and actual native durable generation identity; no path or raw provider credentials. ID collision retries before persistence, never repurposes an existing ID/payload. These exact fields/limits are selected source contract, awaiting whole review rather than provisional implementation choices.

## Current integration authority (2026-10-04)

Core PR1631 and CLI PR36 are landed dependencies, integrated through current develop Core33e19ea24aaaff62e5dbfbb8d57001576fb2fb16 and CLIcf95d4577b5d9e4bb37c02807e738b512dec8be9. The landed four-repository errata/register takes precedence over historical CLI inner-ZIP blocker wording: CLI protected/portable authoring uses native TAR; Core #1534 staged-service and outer-release Windows ZIP remains required. Original TUI five actions and same published tool bytes in Core/npm remain required. Historical pending/review text above records earlier checkpoints, not current ownership or a reopened dependency.

Complete inventory means every file in the independently admitted owner tuple, with its exact path, mode, bytes or explicitly typed difference, policy self-member and generated provenance. Template PR25 owns the new prospective source tuple (reviewed source d3f9c86fc55f3bb4a31f0d127c2b3d5bad291885; 83 inventory members plus policy =84 source files) and its publication/source binding; generated provenance is derived separately. This contract grants it no admission and never makes84 a permanent inventory count. Historical 73+policy+provenance=75 tables and their size/quota arithmetic are informational bindings to the old frozen tuple only, never a 75-file cap or a grant for a newer tuple. All normative full75/all75/expected75 references above mean the complete inventory of the separately admitted tuple; no current or future file may be truncated to fit that historical example. Current owner quotas must be independently validated and all retained-copy/frame/parser/native limits met before enablement; an incompatible newer tuple fails closed pending an explicit reviewed limit amendment, never silently drops members or inherits old hashes/quotas. Native v3 HMAC/one-use session, full held readback, TC01..TC12/CA01..CA08, upload/stage/preflight/confirm/commit/poll and journal/key/fixed-ID exact-payload durable Audit no-loss outbox remain complete and unchanged. Missing immutable publication, catalog/provider/native capabilities and direct Windows/Linux released journey remain unmet.

This integration is source-only documentation. Different fresh ENTIRE final-source review is required for both complete integrated contracts before governed landing. Product source authorship, imports/parsers/build/npm/tests/native execution, new API decisions, publication and deployment are outside this integration unit.
