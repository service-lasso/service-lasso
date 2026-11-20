# Core/TUI candidate-entry binder design (proposed, 2026-11-20)

Status: design only. This document selects no source body, native ABI, compiler
input, ROOT admission, execution, qualification, publication, or authority. It
responds to Core #1562 and the proposed TUI #28 Core entry contract at
[service-lasso-tui PR #54](https://github.com/service-lasso/service-lasso-tui/pull/54).

Traceability: Core #1562, TUI #28, SPEC-002 AC-4DI.4 (source-only boundary),
and `TUI28-CORE-ENTRY-CONTRACT-20261119.md` in the TUI repository. This design
adds no requirement acceptance and does not change any protected test.

## 1. What Core is, and what this binder is for

Core is the Service Lasso Node/TypeScript standalone runtime. It owns the
service manifest and lifecycle, secrets resolution, operator HTTP/MCP surfaces,
the launch path, and the candidate-entry lease. Core is the parent/supervisor
and the only entry issuer. Core is not the TUI, and it is not a general pointer
broker. It may add a private native helper later if Node cannot provide a
required kernel primitive, but the authority plane stays in Core.

The TUI is a Go/native consumer. It renders the operator surface and calls the
native owner entry. The CLI is a view. Neither consumer may create a charge,
source, domain, issuer, deadline, or custody object.

The proposed TUI contract requires `entry.bind.v1` to return exact
consumer-local views of Core-owned charge/source/domain/actors/bases, real public
inputs, deadline source/root/sequence, issuer relation, and custody handles.
The current Core contract binds only lease IDs and public input. The current
launcher retains only the executable bytes and observed consumer identity.
This document defines the missing binder boundary; it does not pretend those
originals already exist.

## 2. Decision

Use a Core-authored, versioned **binding image** on the existing inherited
handoff channel, materialized by a TUI-local binder into a sealed anonymous
memory mapping and an offset-based native view table.

The moving parts are:

1. Core retains the real launch, reservation, source, domain, issuer, deadline,
   and custody originals for the attempt.
2. Core sends the handoff carrying the lease and a closed binary binding image
   over inherited fd `3` after it has verified the consumer's fd `4`
   observation.
3. The TUI binder validates the image against the exact handoff bytes and digest,
   creates a sealed `memfd`, maps it read-only, and builds view descriptors.
4. The native owner entry receives only the binder context and view table. It
   never receives a Core pointer, a path, an environment string, or a caller
   numeric value as authority.
5. Core marks the lease bound only after the TUI acknowledges the exact image
   digest. Core releases the lease after the consumer's last borrower.

The image is operand data, not authority. It cannot be renewed, rebound, used
for another attempt, or used after release. The authority remains the Core-held
original plus the live single-use lease. A copied operand image is no more a
bearer token than a printed copy of a reservation; the binder refuses unless
the live Core session delivered it for this exact attempt.

This design deliberately rejects:

- pointer or handle handoff across exec;
- path, flag, environment variable, JSON file, or database row as authority;
- writable shared memory or a writable alias of the binding image;
- `LD_PRELOAD`, executable patching, or loader interposition;
- consumer-side `/proc` reconstruction or fresh clock construction between bind
  and native entry;
- any fallback when the binder, lease, image, or seal is unavailable.

## 3. Trust boundary and invariants

The following are invariants, not suggestions.

- Core is the only issuer. The TUI binder can build views but cannot mint a
  lease, charge, source, domain, deadline, issuer, or custody object.
- The lease is single-use and attempt-bound. `issued -> bound -> released` is
  the normal path. `expired` and `failed` are terminal. A failed bind does not
  become a retryable lease once an image has been delivered.
- Core verifies the consumer's PID, process start identity, executable identity,
  domain identity, exact `argv`, and exact environment bytes before it emits an
  image. The TUI binder rechecks the image against the handoff bytes it received.
- The image is bound to the exact handoff line bytes. The digest input is the
  received UTF-8 line without the terminating LF, not a re-serialized object.
- The image is immutable in the consumer. The TUI creates it with
  `memfd_create(..., MFD_CLOEXEC | MFD_ALLOW_SEALING)`, writes it, applies
  `F_SEAL_WRITE | F_SEAL_GROW | F_SEAL_SHRINK | F_SEAL_SEAL`, verifies
  `F_GET_SEALS` is exactly that set, and maps it `PROT_READ | MAP_PRIVATE`.
- No image section contains a raw pointer, an absolute address, or a
  Core-local offset. All offsets are relative to the image base and are
  range-checked before use.
- The native entry accepts a binder context and view table only. The view table
  is immutable and the binder context is opaque. It must reject an unsealed
  mapping, a writable mapping, an unknown ABI version, a missing required view,
  a duplicate view, an out-of-range view, or a view whose length exceeds its
  section.
- No fallback path reads a file, environment variable, argument, or `/proc`
  entry to reconstruct a missing view. A missing binder is a refusal.
- Core retains every original through the consumer's last borrower. The image
  is a snapshot for this attempt, not a replacement for Core custody.

Threat-model limit: this binder prevents substitution by the honest consumer
and by external files, paths, and replayed messages. It does not make a
compromised TUI binary trustworthy; a process that can execute arbitrary native
code can call the native entry with fabricated operands. That is an attestation
and signed-execution problem, not a lease-format problem. The design keeps that
limit explicit rather than claiming that a digest creates issuer authority.

## 4. Transport

The existing launcher uses inherited fd `3` for Core-to-consumer handoff and fd
`4` for consumer-to-Core acknowledgement. Keep those descriptors and their
direction. Do not add an environment-variable or path-based channel.

Control messages are UTF-8 JSON lines, one object per line, LF-terminated,
with a 64 KiB maximum. They are transport only; no control field is authority.
Reject duplicate keys, unknown keys, NUL bytes, trailing data, and non-object
roots. The binding image is a separate length-delimited binary frame, not JSON.

Sequence:

1. Core writes a `handoff` line on fd `3`. The handoff carries the lease.
2. TUI reads the line, applies the closed handoff/lease schema, and retains the
   exact received bytes for the handoff digest.
3. TUI observes itself on Linux (PID, process start, executable SHA-256,
   PID/mount namespace identity, exact `argv`, exact environment) and writes an
   `observation` line on fd `4`.
4. Core validates the observation against the lease book and the launched
   process. On failure, Core writes `refused` on fd `3` and closes the attempt.
5. Core materializes the binding image from retained originals. If any required
   original is unavailable, Core writes `refused` with
   `binder_originals_unavailable`; it must not emit synthetic production data.
6. Core writes a `binding` line with `leaseId`, `imageBytes`, and
   `imageSha256`, then writes exactly `imageBytes` raw bytes on fd `3`.
7. TUI reads the exact bytes, verifies size and hash, validates the image
   header, handoff digest, image digest, section table, and section bounds, then
   creates the sealed mapping and view table. On failure, TUI writes `refused`
   on fd `4` and exits nonzero before any native effect.
8. TUI writes an `ack` line with `leaseId` and the exact `imageSha256`.
9. Core verifies the ack against the image it sent, marks the lease `bound`,
   and writes `bound` on fd `3`.
10. TUI waits for `bound`, then calls `sl_candidate_owned_entry`.
11. If the native entry refuses, TUI writes `refused` on fd `4`; Core marks the
    lease `failed` and releases retained resources.
12. After the last borrower, TUI writes `release` on fd `4`; Core releases the
    lease and any retained image resources. TUI closes the mapping and memfd.

Every phase has the existing finite timeout. There is no retry, reconnect, or
second bind. A timeout closes the attempt and kills the child if it is still
running. A closed fd is a refusal, not a reason to fall back.

The current pipes are sufficient because the image is copied into a
consumer-created sealed memfd. If a later review requires kernel-enforced
single-copy delivery, the same image format can be carried by `SCM_RIGHTS` on a
`SOCK_SEQPACKET` control socket. That upgrade needs a Core native helper because
Node does not expose `sendmsg(2)` directly. It is not required for this design.

## 5. Binding image format

All integers are little-endian. The image is a fixed header, a section table,
and section payloads. Sections are 8-byte aligned. Padding is zero. The total
image is at most 4 MiB. A production image must contain every required section.

### 5.1 Header

| Offset | Size | Field |
| --- | --- | --- |
| 0 | 8 | magic `SLBIND1\0` |
| 8 | 2 | `version` = 1 |
| 10 | 2 | `headerBytes` = 128 |
| 12 | 4 | `flags`: bit 0 = `DEVELOPMENT_SYNTHETIC`; all other bits zero |
| 16 | 8 | `imageBytes` |
| 24 | 8 | `sectionCount` |
| 32 | 8 | `sectionTableOffset` |
| 40 | 8 | `sectionTableBytes` |
| 48 | 8 | `sectionEntryBytes` = 40 |
| 56 | 32 | `handoffDigest` |
| 88 | 32 | `imageDigest` |
| 120 | 8 | reserved, zero |

`handoffDigest` is SHA-256 of the ASCII domain
`service-lasso.candidate-entry-handoff.v1\0` followed by the exact received
handoff line bytes without LF. `imageDigest` is SHA-256 of the ASCII domain
`service-lasso.entry-binding.v1\0`, followed by the header with the
`imageDigest` field zeroed, followed by the section table and section payload
bytes in image order.

### 5.2 Section table entry

| Offset | Size | Field |
| --- | --- | --- |
| 0 | 4 | `kind` |
| 4 | 4 | `flags` = 0 |
| 8 | 8 | `offset` |
| 16 | 8 | `length` |
| 24 | 8 | `alignment` |
| 32 | 8 | `itemCount` |

`sectionTableBytes` must equal `sectionCount * sectionEntryBytes`.
`sectionTableOffset` must be at least 128 and 8-byte aligned. Section payload
offsets must be 8-byte aligned and must not overlap the header or the table.

### 5.3 Section kinds

| Kind | Name | Required | Meaning |
| --- | --- | --- | --- |
| 1 | `CHARGE` | yes | Containing reservation/charge rows, capacity, copies, page size |
| 2 | `SOURCE` | yes | Containing source graph/domain/items and immutable source bytes |
| 3 | `DOMAIN` | yes | Containing domain identity and domain-owned state |
| 4 | `ACTORS` | yes | Actor principals and original relations |
| 5 | `BASES` | yes | Original bases used by the native owner |
| 6 | `PUBLIC_INPUT` | yes | Exact `argc`, `argv`, environment, and public entry identity |
| 7 | `DEADLINE` | yes | Deadline source, constructed root, enrolled sequence |
| 8 | `ISSUER` | yes | Issuer-to-operation relation and operation identity |
| 9 | `CUSTODY` | yes | Held files, memfd/custody references, readbacks, failure prefixes |
| 10 | `CAPTURE` | no | Public capture material and parent-supervision inputs |
| 11 | `OBSERVATION` | no | Core's original launch/consumer observations for diagnostics |

The payload grammar of each section belongs to the private native owner schema
version selected by review. The binder does not invent field meanings. It
enforces the top-level section table, bounds, alignment, required-kind set,
duplicate refusal, and total limits. The native owner validates its own payload
before use.

Limits: `PUBLIC_INPUT` and `SOURCE` are each at most 1 MiB; every other section
is at most 256 KiB; the complete image is at most 4 MiB. A required section with
zero length is invalid. A section may not overlap another section, the header,
or the section table. No section may extend past `imageBytes`.

### 5.4 Validation order

Validate in this order so a malformed image fails closed without consuming a
lease or creating a view:

1. exact byte count and SHA-256 against the `binding` line;
2. magic, version, header size, reserved bytes, and flags. A production
   validator requires exactly zero flags; a test build may accept only bit 0
   (`DEVELOPMENT_SYNTHETIC`) and must reject every other bit;
3. `imageBytes` equality, section table bounds, entry size, and table size;
4. handoff digest against the exact handoff bytes;
5. image digest with the digest field zeroed;
6. section table: known kinds, no duplicates, required set, alignment, bounds,
   no overlap, per-section limits, total limit;
7. seal result and exact `F_GET_SEALS`;
8. view table construction and native ABI version.

A failure after Core has delivered the image is terminal for the attempt. Core
marks the lease `failed`, not `issued`, so a tampered image cannot be retried
under the same lease.

## 6. Native view ABI

The native ABI is private to the TUI candidate. It is not a public C ABI and
must not be exported from the package. The design proposes a private header
such as `native/entry/sl_candidate_bound_entry.h`; adding it requires a separate
source review.

```c
enum sl_candidate_view_kind {
  SL_VIEW_CHARGE = 1,
  SL_VIEW_SOURCE = 2,
  SL_VIEW_DOMAIN = 3,
  SL_VIEW_ACTORS = 4,
  SL_VIEW_BASES = 5,
  SL_VIEW_PUBLIC_INPUT = 6,
  SL_VIEW_DEADLINE = 7,
  SL_VIEW_ISSUER = 8,
  SL_VIEW_CUSTODY = 9,
  SL_VIEW_CAPTURE = 10,
  SL_VIEW_OBSERVATION = 11
};

struct sl_candidate_view {
  uint32_t kind;
  uint32_t flags;
  uint64_t offset;
  uint64_t length;
  uint64_t alignment;
  uint64_t item_count;
};

struct sl_candidate_bound_entry {
  uint32_t abi_version;
  uint32_t view_count;
  const uint8_t *image_base;
  uint64_t image_bytes;
  const struct sl_candidate_view *views;
  void *binder;
};

enum sl_candidate_entry_result {
  SL_ENTRY_RELEASED = 1,
  SL_ENTRY_RETAINED_UNAVAILABLE = 2,
  SL_ENTRY_REFUSED = 3
};

enum sl_candidate_entry_result
sl_candidate_owned_entry(const struct sl_candidate_bound_entry *entry);
```

`sl_candidate_owned_entry` must:

- reject null `entry`, null `image_base`, null `views`, or `view_count == 0`;
- reject an unknown `abi_version`;
- reject a binder context that is not live or whose mapping is not sealed
  read-only;
- require every required view kind exactly once;
- range-check every `offset + length` against `image_bytes`;
- check alignment and `item_count` against the section;
- return `SL_ENTRY_REFUSED` for any failure and create no effect;
- never read a path, environment variable, command line, or `/proc` entry to
  fill a missing view.

The current generated `sl_candidate_owned_entry` composition seam has no
operands and no product `main`. It must not be relabelled as this ABI. The
signature change is a later reviewed source unit, not part of this document.

## 7. Core binder source

The binder needs real originals. The current `CandidateEntryLeaseBook` does not
hold them, so the production binder must refuse until they exist.

Proposed seam, not implemented:

```ts
export interface CandidateEntryBinderSource {
  materialize(request: {
    lease: CandidateEntryLease;
    observation: CandidateEntryConsumerObservation;
    handoffMessage: Uint8Array;
  }): CandidateEntryBinderImageResult;
  release(leaseId: string): void;
}

export type CandidateEntryBinderImageResult =
  | { ok: true; image: Uint8Array; imageSha256: string }
  | { ok: false; code: CandidateEntryBinderRefusalCode };
```

The source must be resolved from Core's retained launch record by object
identity, not by a caller-supplied path, string, hash, or boolean. A lease ID is
a lookup key, not authority. Core's launch owner retains the record; the binder
source reads immutable originals from that record and returns a frozen image.

Production rules:

- If any required original is missing, return `binder_originals_unavailable`.
- If an original is mutable, copy it under Core custody before encoding; do not
  point at it from the image.
- If an original changes after encoding, the image is stale; refuse the bind.
- Do not synthesize a charge, source, domain, actor, base, deadline, issuer, or
  custody record from a manifest, hash, ID, clock, or environment value.
- Do not accept a caller-provided image, image digest, or `classification` as
  authorization.

Development fixtures may provide a labelled `development-synthetic` source to
exercise the encoder and refusal matrix. The test encoder sets image flag bit 0;
the production encoder always sets zero. The production TUI build must refuse a
synthetic image, and no test fixture may be presented as issuer authority.

## 8. Lease state and refusal matrix

Add `failed` to the lease state machine. `failed` is terminal and cannot be
bound, released into `issued`, or reused. A pre-image observation refusal does
not consume the lease. An image-delivery refusal does.

Core-side refusals:

- `binder_originals_unavailable`
- `binder_image_too_large`
- `binder_image_encoding_failed`
- `binder_message_invalid`
- `binder_ack_mismatch`
- `binder_lease_failed`
- `binder_channel_closed`
- `binder_timeout`

Consumer-side refusals:

- `binder_channel_absent`
- `binder_image_missing`
- `binder_image_hash_mismatch`
- `binder_image_magic_invalid`
- `binder_image_version_unsupported`
- `binder_image_flags_unsupported`
- `binder_image_size_invalid`
- `binder_image_digest_mismatch`
- `binder_handoff_digest_mismatch`
- `binder_section_table_invalid`
- `binder_section_unknown`
- `binder_section_duplicate`
- `binder_section_missing`
- `binder_section_bounds`
- `binder_section_overlap`
- `binder_section_alignment`
- `binder_section_limit`
- `binder_seal_failed`
- `binder_view_invalid`
- `binder_native_abi_mismatch`

The existing lease, consumer identity, public input, duplicate, expiry, replay,
and release refusals remain unchanged. A refusal never creates a partial entry.

## 9. TUI integration boundary

The product TUI entry must start with the inherited lease and must refuse if the
binder channel is absent. It must not fall back to a local launch. The current
manual TUI `main` predates this contract; do not silently break it while Core
has no launch path. The transition is one of:

- a separate product entry built only for Core launch, or
- an explicit build-tag entry that replaces the manual `main` after Core launch
  is available.

Do not use an environment variable or flag as the production switch. A runtime
flag would become a local authority switch. A compile-time product entry keeps
the refusal boundary honest.

The TUI binder is responsible for the fd `3`/fd `4` conversation, self
observation, image validation, sealed mapping, view table, `ack`, `bound`,
native call, and `release`. It must preserve every borrowed view through public
capture, parent supervision, and last use. It must close the mapping and memfd
only after `release`.

## 10. Verification plan

This design is source-only. No native execution is authorized by it.

Core source tests:

- image encoder produces the exact header, table, alignment, and digest;
- decoder accepts the valid image and rejects every refusal class;
- handoff digest uses the exact received line bytes, not re-serialized JSON;
- duplicate, unknown, missing, overlapping, misaligned, and oversized sections
  are refused;
- a stale or changed original refuses rather than producing an image;
- a production binder with no originals returns
  `binder_originals_unavailable`;
- a synthetic image sets flag bit 0, a production encoder sets zero, and a
  production TUI build refuses the synthetic flag;
- existing lease/launcher tests remain unchanged.

Consumer source tests:

- valid image bytes produce a sealed read-only mapping with exact seals;
- a write attempt through the mapping fails;
- a second mapping with `PROT_WRITE` is refused by the binder;
- hash, magic, version, size, handoff digest, image digest, section, and ABI
  refusals are distinct;
- no path, environment, argument, or `/proc` read can supply a missing view;
- the native entry refuses a null/foreign binder context and a missing required
  view;
- release is once-only and prevents a later bind;
- a tampered image after delivery marks the attempt failed and cannot be
  retried.

Integration tests:

- Core parent plus a child fixture exercises the full line/binary sequence;
- truncated image, extra bytes, wrong ack digest, closed fd, and timeout fail
  closed;
- the child cannot bind a second time or reuse another attempt's lease;
- a production attempt without authentic originals never reaches native entry.

These tests prove source correspondence and refusal behavior. They do not prove
native execution, issuer authority, or qualification.

## 11. Implementation order

1. Review this design and decide the transport question in section 12.
2. Core contract change: add `failed`, binder image types, encoder/validator,
   refusal codes, and source tests. Freeze the contract for review.
3. Core binder adapter: retain originals, materialize images, refuse when
   originals are unavailable. Do not add synthetic production data.
4. TUI binder: fd `3`/`4` client, image validation, sealed memfd, view table,
   and refusal path. This can be source-tested without native execution.
5. Native ABI: replace the operand-free seam with the reviewed private ABI and
   compile/link a refusal fixture. No product `main` before authentic inputs.
6. End-to-end native execution only after authentic inputs, separate ROOT
   admission, and matching-host qualification.

Do not reorder step 3 before step 2. Do not add a product `main` to satisfy a
linker. Do not weaken `nativeEntrySupplied:false` or
`authenticatedIssuer:false` before the real path exists.

## 12. Open decisions for review

1. **Copy versus kernel-enforced single copy.** This design copies the image
   into a consumer-created sealed memfd. That avoids a Core native fd-passing
   helper. If review requires Core to own the only sealed copy, the same image
   format can use `SCM_RIGHTS`; that adds a private Core helper and a socket
   control channel.
2. **Image ceiling.** The proposed 4 MiB total and per-section limits are
   design bounds, not measured capacity. Review must select the actual finite
   limits before implementation.
3. **Control codec.** JSON lines are proposed for control because they are easy
   to audit and independent of the binary image. A fixed binary control frame
   would remove JSON ambiguity at the cost of more code.
4. **Private ABI location.** The header name, ownership, and build inclusion
   must be selected with the TUI native owner.
5. **Lease `failed` state.** Adding it is a contract change and needs explicit
   review against the existing lease tests.
6. **Manual TUI transition.** A separate product entry or a build tag must be
   selected before the current manual `main` changes.
7. **Authentic originals.** The charge/source/domain/deadline/custody originals
   remain unavailable in current source. Until they exist, the only honest
   production behavior is `binder_originals_unavailable`.

## 13. Non-claims

This document is not an implementation, a Core API, a closed ABI, a native
entry, a product `main`, or evidence of issuer authority. It does not authorize
a compiler, native build, test execution, ROOT admission, pin change,
qualification, merge, publication, or deployment. The existing lease contract,
launcher tests, TUI native input bundle, and all protected evidence remain
unchanged.
