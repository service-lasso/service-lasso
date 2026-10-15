# Released service producer policy

Issue [#1524](https://github.com/service-lasso/service-lasso/issues/1524) defines the producer-side prerequisite for the staged released-asset transfer in [#1463](https://github.com/service-lasso/service-lasso/issues/1463). It applies to a **service producer release**, not to Core's own runtime package or release-artifact inventory.

This policy is a closed release description. It does not add an upload route, archive discovery, release publication, service installation, or lifecycle authority. A locally authored project remains outside this policy and is governed by [source-safe template admission](./source-safe-template-admission.md).

## Eligible release shape

An eligible service producer release has all of the following in one GitHub release:

1. The release is published and non-draft. Its `tagName` resolves to one immutable full 40-character target commit SHA.
2. It contains exactly one release asset named `service-lasso-release-policy.json` and exactly one release asset named `service.json`. Neither may be an archive member, a Core package inventory entry, an attachment selected by a client, or a fallback filename.
3. `service-lasso-release-policy.json` is UTF-8 JSON matching schema `service-lasso.service-producer-release-policy/v1`. It declares the target service ID, tag, target SHA, the SHA-256 of the dedicated `service.json` asset, and every supported platform's archive and checksum asset names and SHA-256 values.
4. Every declared archive and checksum asset appears in that same GitHub release. The fixed policy and manifest assets cannot share an identity with a platform archive or checksum. Archive identities are unique. A checksum identity may be shared by several platforms only when every use declares the same asset name and SHA-256; this permits one immutable `SHA256SUMS.txt` asset without letting a second checksum description select different bytes. `win32` uses `zip`; `linux` and `darwin` use `tar.gz` or `tgz`. The policy has no `default`, generic, cross-platform, URL, client-selected asset, or archive-member manifest form.

The fixed policy filename gives Core one discovery point. The dedicated `service.json` asset gives the canonical parser one byte stream. The policy describes that stream's digest; it does not embed a self-digest in `service.json`.

## Policy asset schema

```json
{
  "schema": "service-lasso.service-producer-release-policy/v1",
  "serviceId": "example-service",
  "release": {
    "tag": "2026.10.1-0123456",
    "targetSha": "0123456789abcdef0123456789abcdef01234567"
  },
  "manifest": {
    "assetName": "service.json",
    "sha256": "<64-lowercase-hex>"
  },
  "platforms": {
    "win32": {
      "assetName": "example-service-win32.zip",
      "archiveType": "zip",
      "sha256": "<64-lowercase-hex>",
      "checksum": { "assetName": "SHA256SUMS.txt", "sha256": "<64-lowercase-hex>" }
    },
    "linux": {
      "assetName": "example-service-linux.tar.gz",
      "archiveType": "tar.gz",
      "sha256": "<64-lowercase-hex>",
      "checksum": { "assetName": "SHA256SUMS.txt", "sha256": "<64-lowercase-hex>" }
    },
    "darwin": {
      "assetName": "example-service-darwin.tar.gz",
      "archiveType": "tar.gz",
      "sha256": "<64-lowercase-hex>",
      "checksum": { "assetName": "SHA256SUMS.txt", "sha256": "<64-lowercase-hex>" }
    }
  }
}
```

`serviceId` uses the transfer target-ID grammar. `tag` uses the transfer release-tag grammar. `targetSha`, every `sha256`, all asset names, and every platform key use the grammar and limits in [the staged-transfer contract](../api/staged-service-transfer.md). The document's JSON object shape is closed: top level has only `schema`, `serviceId`, `release`, `manifest`, and `platforms`; `release` has only `tag` and `targetSha`; `manifest` has only `assetName` and `sha256`; each platform has only `assetName`, `archiveType`, `sha256`, and `checksum`; and `checksum` has only `assetName` and `sha256`. A release may omit an unsupported platform; Core must reject a request for it. A policy with no platform, an unknown platform, an overlapping asset identity, incoherent reuse of a checksum identity, or a platform/type combination outside the table is ineligible.

The dedicated `service.json` must parse through the canonical manifest parser. Its existing `artifact.kind` must be `archive`; its existing `artifact.source.type` must be `github-release`; its existing `artifact.source.repo` and `artifact.source.tag` must exactly equal the owner-approved repository and `release.tag`; and its derived ID must exactly equal `serviceId`. This policy adds no fields to `service.json` and does not invent a manifest-side target-SHA field: the full SHA is bound by the policy and release/tag resolution. The policy is deliberately not a second service manifest.

## Resolver and provenance requirements

Before #1463 allocates a stage, Core's future resolver must:

1. authenticate the actor and select the trusted workspace before looking up a release;
2. apply an owner-approved Core catalog entry for the exact `owner/repo`, policy schema, and fixed policy asset name;
3. fetch one published, non-draft release matching the requested tag; resolve its tag to a full SHA; and require that SHA to equal both the request and `release.targetSha`;
4. find exactly one fixed policy asset and one dedicated `service.json` asset, download each once through the release resolver, and calculate their SHA-256 values;
5. parse the policy, require the computed `service.json` digest and every selected archive/checksum digest to equal the policy, then derive the manifest ID and require `serviceId == targetServiceId`;
6. for the requested OS, find exactly one declared archive and exactly one declared checksum asset, record each GitHub release asset ID and release API byte size, and reject missing, duplicate, mismatched, zero-size, unapproved, or non-release assets; and
7. persist the release ID, tag, full target SHA, policy asset ID/digest, manifest asset ID/digest, selected archive asset ID/name/size/digest, checksum asset ID/name/digest, platform, and target service ID with the stage and later operation.

The client provides only the existing bounded provenance tuple and target platform. It does not provide policy/manifest/archive/checksum names, IDs, URLs, sizes, or digests. Any unavailable catalog decision, zero or multiple fixed assets, policy parse failure, manifest mismatch, tag/target mismatch, or unsupported platform must remain `503 release_provenance_unavailable` or `403 unapproved_release` as specified by #1463; Core must not scan archives or substitute a Core release asset.

## Producer evidence gate

Each producer candidate must retain a metadata-only receipt containing the repository, GitHub release ID, published/non-draft state, tag, full target SHA, policy/manifest/archive/checksum asset IDs and names, API byte sizes, and SHA-256 values. The receipt proves that the same release was inspected; it never records download URLs, tokens, paths, archive contents, or secrets.

The producer's release check must exercise the valid fixture plus denials for: missing or duplicate fixed policy/manifest assets; draft/unpublished release; short or mismatched target SHA; manifest digest or service-ID mismatch; an archive/checksum outside the release; duplicate archive asset names; `default` or unknown platforms; Windows TAR; Linux/macOS ZIP; missing checksum; and unapproved catalog repository. The accompanying repository-local checker and fixtures prove this closed schema only. They are not evidence that Core implements the resolver, TAR admission, external CLI transfer, release publication, deployment, or GA.

## Required owner decision

This document is a proposal, not an allowlist approval. After an independent producer-policy and security review, the service-producer/release-policy owner must approve a Core catalog entry for each service repository. The review packet must state:

```text
repo: owner/repo
policy schema: service-lasso.service-producer-release-policy/v1
policy asset: service-lasso-release-policy.json
service manifest asset: service.json
allowed target service ID: <id>
allowed release tag and full target SHA: <tag> / <40-hex>
approved policy and manifest SHA-256: <64-hex> / <64-hex>
approved platform archive/checksum identities: <per-platform asset names and SHA-256 values>
review evidence: <producer fixture/checker receipt and independent review>
```

Only that owner approval can create or update the catalog pin. This Core specification PR does not approve a repository, release, or semantic service identity.

## Traceability and current boundary

- `SPEC-002 AC-4CH.1` requires this identity before staging can allocate.
- `docs/api/staged-service-transfer.md` remains the closed consumer transport, parser, quota, recovery, and error contract.
- `#1524` is complete only after this policy and its independent review are accepted; #1463 stays fail-closed until Core implements a resolver against an owner-approved catalog entry.
- Core runtime packaging, `release-artifact.json`, and `@service-lasso/service-lasso` remain Core artifacts. They are not service-producer policy assets and cannot satisfy this contract.
