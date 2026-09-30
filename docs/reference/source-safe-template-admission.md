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

## Required template authority before implementation

`service-template` issue #17 / PR #18 now supplies a candidate
`template-contract.json` and verifier. They define a closed inventory with
hashes and Git modes, allowed `service.json` fields, `config/example.env`, and
`template-provenance.json`; the verifier checks the immutable baseline and
allowed differences. That is useful owner evidence, but the current
`1.0.0-dev` candidate is neither a reviewed published release nor an approved
immutable Core catalog pin. Core must not treat a repository branch, PR,
verifier result, or candidate version as catalog authority.

Before implementation, the owning `service-template` work must publish a
reviewed, versioned template-contract release, and Core must separately approve
and pin its immutable tuple in its catalog. Together they must provide all of
the following:

1. a stable `templateId`, immutable full `templateCommit`, semantic
   `templateVersion`, and SHA-256 `contractDigest`;
2. a closed file inventory with per-file digest and final materialized mode,
   normalized archive path rules, and explicit maximum file/total-byte limits.
   Every allowed-difference path also has an exact catalog path-policy entry
   with its final mode. The only v1 final modes are non-executable `0644` and
   executable `0755`; a `0755` entry additionally fixes immutable bytes and
   digest in the catalog;
3. an allowlist of each permitted authoring difference: its exact path, type,
   size bound, schema/version, whether it is replaceable, and any value-level
   constraints;
4. the closed `service.json` schema version and the exact fields the author may
   change, including a statement that artifact acquisition, executable/command,
   setup-hook, provider, isolation, secret-reference, and external URL changes
   are either prohibited or separately contract-defined;
5. the required provenance record shape, including the GitHub
   `template_repository` identity when applicable, the derived repo commit, and
   a non-secret build manifest; and
6. fixture archives and a verifier that emits the canonical normalized archive
   digest and allowed-difference report.

This prerequisite is tracked as
[service-template#17](https://github.com/service-lasso/service-template/issues/17).
Until both the reviewed published candidate and Core's immutable catalog pin
exist, all source-admission requests fail with `template_contract_unrecognized`
before a stage is created. A client may create a local project in any
caller-selected directory, but that local path is never an API field, Audit
field, operation field, or diagnostic.

The Core catalog approval is a server-side decision over that published template
tuple and its closed per-path policy. Candidate provenance only proves the
candidate's asserted derivation under that already-approved policy; it cannot
select, widen, replace, or become a Core catalog entry. In particular, a
derived-repository commit in `template-provenance.json` is candidate evidence,
not a template commit or catalog-approval identity.

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
- Each local and central name has identical valid UTF-8 bytes, decodes to its
  already-NFC Unicode form, and matches
  `^[a-z0-9][a-z0-9._-]*(/[a-z0-9][a-z0-9._-]*)*$`. It has at most 12
  segments, 96 bytes per segment, and 240 bytes total. Names are unique after
  this validation. This prevents absolute, empty, dot/traversal,
  backslash-separated, case-colliding, device-like, control, and Unicode
  normalization-colliding paths.
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
represented consistently. The only states are `accepted`
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

After a crash or write uncertainty, Core reconciles only an `accepted` record.
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
`audit_unavailable`, returns `503` with a safe operation projection containing
the `sao_` ID, and does not retry. Actor-authorized GET of that ID returns `200`
with the same stored safe projection. The `503` reports missing Audit certainty;
the `200` only reports durable readback. Exact replay returns that projection
with `200` and `replayed: true`.

## Stable errors and HTTP status

| Status  | Code                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Meaning                                                                                                                              |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| 400     | `invalid_body`, `invalid_stage_metadata`, `invalid_stage_content_type`, `invalid_upload_framing`, `invalid_archive_digest`, `invalid_idempotency_key`                                                                                                                                                                                                                                                                                                       | Closed grammar, declared limits, required upload headers/framing, media type, or digest/key syntax failed.                           |
| 401/403 | `authentication_required`, `permission_denied`                                                                                                                                                                                                                                                                                                                                                                                                              | No trusted actor or no `service:configure`; no stage/import mutation.                                                                |
| 404     | `stage_not_found`, `preflight_not_found`, `operation_not_found`                                                                                                                                                                                                                                                                                                                                                                                             | Missing, expired, foreign, or malformed opaque reference.                                                                            |
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
| distribution                     | Exact-head Core CI plus a fresh packaged Core and released external CLI on Windows, Linux, and macOS; direct remote runtime proof remains distinct from mocked transport tests.                                                                                                                                                                  |

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
