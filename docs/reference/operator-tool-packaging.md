---
title: External operator-tool packaging
---

# External operator-tool packaging

Core's `service-lasso` command remains the local-runtime command. The external tools are separate operator clients:

| Tool | Command | Role | Execution boundary |
| --- | --- | --- | --- |
| Service Lasso CLI | `service-lassoctl` | automation-first Core API client | noninteractive; mutations require the client's explicit confirmation contract |
| Service Lasso TUI | released platform executable | keyboard operator client | caller-owned attached terminal; never autostarted |

Neither tool is a Core managed service. Do not add `service.json`, catalog it, supervise it, report Core lifecycle/health for it, or start a terminal session from Core.

## Target platform contract

The API CLI is a Node 22+ package and the operator-tools manifest explicitly declares its supported platforms (`win32`, `linux`, `darwin`). The CLI may be packaged only where the Core package supports that Node runtime. The TUI release inventory must contain `win32-amd64`, `linux-amd64`, `darwin-amd64`, and `darwin-arm64` assets. An unsupported platform must return a stable unavailable result before extraction or process launch.

Core currently stages reviewed candidate releases `candidate-2026.9.30-0fa84ce` for the TUI and `cli-v0.1.0-dev.24d756e-candidate-24d756e` for the CLI. The TUI candidate is checksum-bound to source `0fa84ce38630e7f5b0066d2aaa103c55b0485c06`; its GitHub release API record is a mutable prerelease (`immutable: false`). Candidate releases are distribution evidence, not GA.

## Release identity gate

Core may package an external operator tool only after the owning repository supplies an approved checksum-bound candidate release that contains the reviewed source head. A mutable prerelease is never treated as immutable merely because it has a tag: Core re-reads its release metadata and verifies every retained byte against the pinned checksums before staging. The Core packaging record must pin all of the following before staging any tool bytes:

- source repository, tag, and full release target commit;
- the exact asset names and SHA-256 values reported by GitHub;
- the downloaded, nonempty checksum manifest and its SHA-256;
- a complete asset inventory for the supported platforms;
- installed relative paths and command names.

The stage must reject mutable selectors such as `latest`, an unmatched tag/target, a missing, extra, duplicate, malformed, redirected, path-traversing, unsupported, or checksum-mismatched asset. It must make no network fetch at Core startup.

The Core staging record verifies the GitHub release tag target, draft/prerelease/mutable state, full asset inventory, downloaded nonempty bytes, checksum manifest, independently pinned asset digest, and the parsed candidate manifest source/tag/commit/checksum/inventory. Qualification re-extracts each Windows, Linux, and macOS Core archive and re-verifies the retained manifests and bytes before any terminal probe. Earlier foundation releases target different commits, so Core must not package or qualify them as substitutes.

The staged Core artifacts retain the verified upstream archives and manifests; they do not extract, run, or register either tool. After staging, qualify a clean Core package/archive extraction or install on Windows, Linux, and macOS. Run the API CLI against the packaged Core for machine-readable success, safe error, and confirmation behavior. Run the TUI in a real caller terminal for startup, safe errors, keyboard navigation, and clean exit. Windows qualification uses a hash-pinned, test-only `pywinpty` ConPTY probe against the extracted Core archive; it gives the child a fixed Windows environment allowlist and passes an API URL only for the connected probe. Unix uses a PTY probe. Record the tested Core and tool heads, and distinguish direct runtime proof from surrogate checks.

## Complete immutable candidate migration (#1602)

The operator-tools manifest is now service-lasso.operator-tools.v2. Each available tool has receiptKind historical-mutable or protected-immutable. The two original exact historical release tuples remain source-owned distribution compatibility records, with explicit mutable public metadata and pinned same-byte verification; no altered tuple or generic mutable candidate is admitted. Their old pins remain unchanged and cannot establish current programme qualification.

New public candidates require draft:false, prerelease:true, immutable:true, exact repository/tag/full commit and complete digest-bound inventory. TUI uses the current closed schema2 manifest with refs/heads/develop and canonical four-platform names/executables. CLI retains all ten protected producer files: portable archive and candidate.json, three native TAR archives and three provenance sidecars, development-candidate.json and SHA256SUMS.txt. The manifest has eight declared assets and nine checksum entries. Native archive verification includes the exact five/six-member payload, executable/helper bytes, matching sidecar provenance, reviewed tools/SEA identity, dispatch context and no-Node host-acceptance digest. Nothing is extracted or launched during staging.

Retained verification checks all archives and records, exact file inventory, canonical confined paths, regular files/directories, and receipt authority. verifyRetainedOperatorTools with requireProtected:true requires both protected-immutable labels AND independently source-approved exact publication catalog identities. The production approved catalog is empty pending a separately reviewed pins-only admission of actual qualified immutable publication and public same-byte readback; labels and internally consistent bytes cannot satisfy it. Mandatory direct native/operator qualification remains separate. Normal distribution verification can preserve exact historical receipts. Consumer package evidence exposes receiptKind and selects the portable archive from the verified manifest rather than a hardcoded historical filename.

Migration order is source repair and different entire-source review, NEW ROOT complete-input admission, actual mandatory qualification, approved protected publication and public identical-byte evidence, then a separate pins-only Core PR. No future tag, digest or accepted admission is invented here. Current CLI native archives remain the approved TAR producer contract. Its literal Windows ZIP programme obligation remains unmet; this source repair does not rewrite that format or claim full programme acceptance. Tests are authored but UNEXECUTED.

## Independent protected authority and actual tag proof (#1602 F1/F2)

Producer-shaped records are observational byte contracts. validateRetainedOperatorToolBytes verifies their complete bytes and declarations; it confers no protected publication authority. verifyRetainedOperatorTools({requireProtected:true}) additionally invokes the production source-owned approved exact tuple/inventory catalog gate. That catalog is EMPTY here. Both actual historical catalogs and fully coherent invented nonhistorical bundles fail this gate, regardless of protected-immutable labels, caller/configuration/environment assertions or internally recomputed hashes. Only a separately reviewed pins-only source admission after real qualified immutable publication and public identical-byte readback may populate it.

The metadata gate independently reads fixed-repository git/ref/tags/<tag>, resolves lightweight commits and at most sixteen typed annotated tag objects, and requires the exact full source commit. Wrong/absent/malformed refs, object SHA mismatches, cycles and excessive depth fail even when release target_commitish is correct. Every authenticated request remains a fixed GitHub metadata GET with redirects denied. Public asset reads and redirects remain headerless. All previous inventory, digest, native, path, privacy and three-OS/operator requirements remain mandatory; authored regression sources are UNEXECUTED.