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
immutable, versioned canonical template contract**. It may materialize the
validated manifest through the same exclusive direct-child import boundary used
by `AC-4CF`. It does not install, acquire release assets, run setup, start,
stop, restart, reload, resolve secrets, adopt a running process, or grant
semantic approval of a service.

`#1463` remains the separate staged transfer of a checksum-bound asset selected
from an approved published Service Lasso release. Its release identity fields
and `confirm: true` grammar are not source-admission inputs, and source
admission must not add arbitrary URLs, arbitrary server paths, inline manifests,
or a generic upload route to that protocol.

## Required template authority before implementation

The current `service-template` draft requires GitHub template origin, but does
not yet publish the machine-readable immutable contract needed here. Core must
not invent the missing policy. Before implementation, the owning
`service-template` work needs to publish a reviewed, versioned template-contract
release containing all of the following:

1. a stable `templateId`, immutable full `templateCommit`, semantic
   `templateVersion`, and SHA-256 `contractDigest`;
2. a closed file inventory with per-file digest and mode, normalized archive
   path rules, and explicit maximum file/total-byte limits;
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
Until a release satisfies that ownership contract, all source-admission requests
fail with `template_contract_unrecognized` before a stage is created. A client
may create a local project in any caller-selected directory, but that local path
is never an API field, Audit field, operation field, or diagnostic.

## Closed transport grammar

All JSON request bodies reject unknown properties. JSON is UTF-8, at most
`64 KiB`, with a maximum nesting depth of `16`; a string is at most `4 KiB`
unless a narrower bound appears below. `Content-Type` must be exact JSON for
JSON endpoints. Identifier and digest comparisons are case-sensitive.

| Endpoint                                                             | Request and success response                                                                                                                                                                                                                                                                    | Authority and effect                                                                                                                                                                                                                                                                                                                                                                                 |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/service-source-admission/stages`                          | Request: `{ "template": { "templateId", "templateCommit", "templateVersion", "contractDigest" }, "declared": { "serviceId", "version", "archiveSha256", "archiveBytes", "archiveEntries", "manifestSha256" } }`. Success `201`: `{ "stage": { "id", "expiresAt", "maxBytes", "maxEntries" } }`. | Requires `service:configure`. Creates an actor-scoped, opaque, uncommitted staging reservation. `templateCommit` is 40 lowercase hex; `contractDigest`, `archiveSha256`, and `manifestSha256` are 64 lowercase hex; `serviceId` uses the existing manifest ID grammar; `version` is a bounded declared manifest version. `archiveBytes` is `1..10_485_760`; `archiveEntries` is `1..512`.            |
| `PUT /api/service-source-admission/stages/{stageId}/content`         | Body is one `application/vnd.service-lasso.template-project+zip` stream. Exact `Content-Length` equals `archiveBytes`. Success `204`.                                                                                                                                                           | Actor-scoped opaque `stageId` only; no path, URL, token, manifest, or filename parameter. Core streams into a private stage, enforces compressed and expanded byte limits, entry count/depth/path rules, no duplicate/absolute/device/traversal/symlink/hardlink entries, and then verifies `archiveSha256`. A stage is write-once and expires after 15 minutes.                                     |
| `POST /api/service-source-admission/preflights`                      | Request: `{ "stageId", "archiveSha256" }`. Success `201`: `{ "preflight": { "id", "candidateRevision", "serviceId", "template": { "templateId", "templateCommit", "templateVersion", "contractDigest" }, "stagedDigest", "expiresAt", "confirmation": { "id", "expiresAt" } } }`.               | Requires `service:configure`. Parses the staged archive with the recognized template contract, validates the declared manifest digest/schema, computes the normalized staged digest and `candidateRevision`, and issues a server-side single-use confirmation bound to actor, stage, candidate revision, target service ID, template identity, and no-lifecycle effect set. It has no import effect. |
| `POST /api/service-source-admission/preflights/{preflightId}/commit` | Request: `{ "confirmationId", "idempotencyKey" }`. Success `202` (or `200` for an exact replay): `{ "operation": { "id", "kind": "source_admission", "status", "replayed", "serviceId", "template", "candidateRevision", "stagedDigest", "createdAt", "completedAt", "errorCode" } }`.          | Requires `service:configure`, a valid server confirmation, and a unique opaque 8–128-character idempotency key matching `^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$`. The only durable product mutation is direct-child manifest admission.                                                                                                                                                                  |
| `GET /api/service-source-admission/operations/{operationId}`         | Success `200` returns the operation projection above.                                                                                                                                                                                                                                           | Actor-scoped readback only. Operation IDs match `sao_[a-f0-9]{32}`. Unknown, foreign, expired, or malformed IDs return the same `404 operation_not_found`.                                                                                                                                                                                                                                           |

The stage upload credential is the authenticated transport session; the API must
not mint an upload bearer token. Redirects, multipart forms, chunked requests,
content encodings, resumable offsets, and server-selected source locations are
unsupported in v1. A lost upload is retried only by creating a new stage.

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
7. provenance record and the template contract's repository/template-origin
   rules.

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

Before creating the service directory, Core durably writes an `unknown`
operation with a hashed request fingerprint and hashed idempotency-key identity.
It serializes admission per workspace and service ID. The persisted record holds
only operation ID, actor ID, stable service/template/version identifiers,
digests, timestamps, status, and safe error code; it never holds the raw key,
confirmation, archive, manifest, paths, URLs, config, logs, credentials, or
secret values.

An exact retry by the same actor with the same request fingerprint returns the
stored result and `replayed: true` without another import. Changed input,
including a different preflight, confirmation, stage digest, template tuple, or
target, returns `409 idempotency_key_reused`. Concurrent exact retries return
`409 idempotency_in_progress` until a terminal record is safely readable.

After a process crash or write uncertainty, Core reconciles only when the
exclusive direct-child target has the recorded manifest digest and discovery
finds exactly the recorded service ID. It then records `completed`. Any absent,
different, redirected, symlinked, duplicate, or undiscoverable target remains
`unknown` with `admission_reconciliation_required`; Core must not repeat the
import, overwrite a target, delete retained content, or infer adoption.

`completed`, `conflict`, `denied`, `failed`, and `unknown` are terminal
operation statuses. A terminal Audit write failure leaves `unknown` with
`audit_unavailable`; it never reports success or repeats the mutation.

## Stable errors and HTTP status

| Status  | Code                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Meaning                                                                      |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| 400     | `invalid_body`, `invalid_stage_metadata`, `invalid_stage_content_type`, `invalid_archive_digest`, `invalid_idempotency_key`                                                                                                                                                                                                                                                                                                                                 | Closed grammar, declared limits, media type, or digest/key syntax failed.    |
| 401/403 | `authentication_required`, `permission_denied`                                                                                                                                                                                                                                                                                                                                                                                                              | No trusted actor or no `service:configure`; no stage/import mutation.        |
| 404     | `stage_not_found`, `preflight_not_found`, `operation_not_found`                                                                                                                                                                                                                                                                                                                                                                                             | Missing, expired, foreign, or malformed opaque reference.                    |
| 409     | `stage_already_written`, `stage_digest_mismatch`, `stage_expired`, `archive_limit_exceeded`, `archive_unsafe`, `template_contract_unrecognized`, `template_difference_forbidden`, `manifest_contract_mismatch`, `provenance_mismatch`, `confirmation_required`, `confirmation_invalid`, `confirmation_expired`, `confirmation_already_used`, `confirmation_binding_mismatch`, `target_manifest_exists`, `idempotency_key_reused`, `idempotency_in_progress` | Safe conflict or policy denial; response reveals no file/path/source detail. |
| 413     | `archive_too_large`                                                                                                                                                                                                                                                                                                                                                                                                                                         | Declared or streamed compressed/expanded limit exceeded.                     |
| 422     | `template_contract_invalid`, `manifest_schema_invalid`, `provenance_invalid`                                                                                                                                                                                                                                                                                                                                                                                | A complete but semantically invalid closed contract input.                   |
| 429     | `admission_rate_limited`                                                                                                                                                                                                                                                                                                                                                                                                                                    | Actor/client stage or preflight quota exceeded.                              |
| 503     | `operation_store_unavailable`, `audit_unavailable`, `admission_reconciliation_required`                                                                                                                                                                                                                                                                                                                                                                     | Durable safety state cannot be established.                                  |

Responses use `{ "error": { "code": "…", "message": "safe stable summary", "correlationId": "…" } }`. They contain no raw parser exception, archive listing, file path, source content, config, URL, credential, token, or secret.

## Audit and evidence

Every allowed, denied, parser-rejected, confirmation-rejected, failed,
replayed, reconciled, and Audit-unavailable attempt appends one durable safe
Audit event. Its metadata is limited to correlation ID, action, actor/client
identity, stage/preflight/operation opaque IDs, template tuple, service ID,
candidate/staged digests, outcome, replay flag, and stable error code.

Implementation must add a contract matrix covering:

| Scenario                         | Required proof                                                                                                                                                                                       |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| valid template-derived project   | Stage, preflight, confirmed admission, direct-child discovery, and no install/setup/start/reload.                                                                                                    |
| client-selected local output     | CLI packages an arbitrary caller-selected directory; HTTP capture proves no local path is transmitted.                                                                                               |
| schema and archive abuse         | Unknown JSON fields, oversized/deep JSON, archive traversal/absolute/device/symlink/duplicate entries, compression and count limits, digest mismatch, wrong media type, expired/write-twice stage.   |
| template and provenance variance | Unknown tuple, altered commit/contract digest, missing/changed required file, forbidden executable/command/source/workflow/hook/provider/secret/URL edit, allowed scalar edit, malformed provenance. |
| authority and confirmation       | unauthenticated, ungranted, cross-actor stage/preflight/operation access, expiry, reuse, and every actor/target/digest/template/candidate binding alteration.                                        |
| durable outcomes                 | concurrent request, exact replay, altered-key retry, crash before/during/after direct-child write, restart reconciliation, collision, symlink/redirected target, Audit outage.                       |
| output safety                    | Audit, operation, HTTP errors, CLI stdout/stderr, and retained artifacts have no raw archive/manifest/path/config/log/token/credential/secret material.                                              |
| distribution                     | Exact-head Core CI plus a fresh packaged Core and released external CLI on Windows, Linux, and macOS; direct remote runtime proof remains distinct from mocked transport tests.                      |

The packaged CLI evidence must prove `service init` or its successor produces a
recognized-template-derived local project, stages only the selected output,
waits/readbacks the durable operation safely, and does not claim release,
deployment, GA, or lifecycle success. Independent specification and security
review are required before implementation.

## Self-check

This contract has one source-admission mutation (validated manifest admission),
never accepts either client or server paths, uses template provenance rather
than release-asset provenance, and does not make `#1463` a general uploader.
It requires a template-owner contract before implementation, keeps client
authoring output supportable through a bounded stage, and keeps permission,
confirmation, idempotency, recovery, Audit, and packaged proof distinct.
