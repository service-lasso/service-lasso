# Release 1 independent security review evidence readback

**Date:** 2026-09-03  
**Author:** MegaMindG acting as Max Barrass's delivery-owner agent (not a named independent security reviewer)  
**Status:** `Technical evidence readback — AC-7H independent approval NOT recorded`

---

This document records evidence readback performed by the delivery-owner agent against the Release 1 independent security review packet. It is evidence collection and technical verification, not the independent security review required by `SPEC-007` `AC-7H`. The delivery owner must not self-certify that external gate.

## Exact review scope

| Component | Commit SHA | Tag |
| --- | --- | --- |
| Core | `1f4ec40f13fe3867b24ca901c42fe31c69e01e8d` | `2026.9.1-1f4ec40` |
| Service Admin | `f015b4445b0526546a309301270186a697588166` | `2026.8.31-f015b44` |
| Secrets Broker | `f340883056ec3cf74b535fb46490b39382e8c823` | `2026.8.31-f340883` |
| Packet/readback freeze commit | `6e1a932` | PR [#1211](https://github.com/service-lasso/service-lasso/pull/1211) |
| Initial packet PR | `c341552` | PR [#1210](https://github.com/service-lasso/service-lasso/pull/1210) |

## Scope of this readback

### What was done

- Live GitHub API identity readback against all three component releases
- Verification that Actions run `33509489660` is terminal green with matching headSha
- Issue state verification for umbrella #1151, packet #1208, and residual #1209
- Three-OS publication existence check (releases exist, not draft, targetCommitish matches)
- Worktree/HEAD drift analysis
- Packet-section coverage classification

### What was not done

- Abuse-case execution against a live isolated store
- Exploit proof-of-concept creation or reproduction
- Destructive matrix re-run against the candidate artifacts
- Independent code review of the frozen bytes
- External reviewer engagement or sign-off

## Live verifications

Readback performed 2026-09-03 using GitHub CLI against live API state:

### Release existence and identity

| Component | Release | Draft | targetCommitish | Status |
| --- | --- | --- | --- | --- |
| Core | `2026.9.1-1f4ec40` | `false` | `1f4ec40f13fe3867b24ca901c42fe31c69e01e8d` | **Verified** |
| Admin | `2026.8.31-f015b44` | `false` | `f015b4445b0526546a309301270186a697588166` | **Verified** |
| Broker | `2026.8.31-f340883` | `false` | `f340883056ec3cf74b535fb46490b39382e8c823` | **Verified** |

All three releases exist, are not draft, are not prerelease, and targetCommitish matches the exact SHAs in the packet scope table.

### Actions run verification

| Run ID | Conclusion | headSha | Status |
| --- | --- | --- | --- |
| `33509489660` | `success` | `1f4ec40f13fe3867b24ca901c42fe31c69e01e8d` | **Verified** |

The published-package workflow run is terminal green and headSha matches Core `1f4ec40f13fe3867b24ca901c42fe31c69e01e8d`.

### Issue state verification

| Issue | Title | State | Expected | Status |
| --- | --- | --- | --- | --- |
| [#1151](https://github.com/service-lasso/service-lasso/issues/1151) | P0 release: ship checksum-bound Core, Broker, and Service Admin working release | `OPEN` | OPEN (umbrella) | **Verified** |
| [#1208](https://github.com/service-lasso/service-lasso/issues/1208) | P0 release: refresh Release 1 ledger and prepare independent security review packet | `CLOSED` | CLOSED (packet prep, not sign-off) | **Verified** |
| [#1209](https://github.com/service-lasso/service-lasso/issues/1209) | P1 release: harden published-package startup and readiness reliability | `OPEN` | OPEN (startup reliability residual) | **Verified** |

## Worktree and HEAD drift analysis

At readback time, `origin/develop` HEAD is `ec33755` (PR [#1215](https://github.com/service-lasso/service-lasso/pull/1215)), which is **four commits after** the frozen packet Core `1f4ec40` (PR [#1210](https://github.com/service-lasso/service-lasso/pull/1210)):

| Commit | PR | Description |
| --- | --- | --- |
| `1f4ec40` | #1210 | Packet candidate (Core frozen bytes) |
| `c341552` | #1210 | Initial packet PR merge |
| `6e1a932` | #1211 | Final control readback freeze |
| `24e0c33` | #1212 | feat(permissions): bind in-process CLI and system actors to shared enforcement |
| `ec33755` | #1215 | feat(permissions): bind leftover HTTP durable mutations to shared actor model |

PRs #1212 and #1215 are **security-control deltas** (permission/actor model changes). Per packet requirements, a security-control change requires delta review and fresh qualification. The frozen `1f4ec40` packet remains the candidate, not the current `develop` HEAD.

**Local dirty state warning:** Any local worktree with deleted `packages/core/*` or `packages/image-size-safe/*` must not be treated as the candidate tree. The frozen packet bytes are at commit `1f4ec40` only.

## Findings

### High severity

| Finding | Description | Disposition |
| --- | --- | --- |
| HEAD ≠ packet bytes | Current `develop` HEAD (`ec33755`) is four commits ahead of frozen packet Core (`1f4ec40`). PRs #1212 and #1215 introduce security-control changes (permission/actor enforcement). | Packet candidate remains `1f4ec40`; current HEAD requires delta review. |
| AC-7H unsigned | `SPEC-007` `AC-7H` independent security approval has not been recorded. | Blocking: GA remains blocked until external reviewer completes and signs. |

### Medium severity

| Finding | Description | Disposition |
| --- | --- | --- |
| Dirty tree risk | Any local worktree state with deleted packages must not be confused with candidate tree. | Require clean checkout of `1f4ec40` or `6e1a932` for review. |
| CI/SBOM/alerts partial | CI run and release existence verified; full SBOM, Dependabot, CodeQL, and secret-scanning alert re-verification was not performed beyond the run/tag checks above. | Independent reviewer should re-run full supply-chain verification. |
| Secret-scanning validity unavailable | Per packet, secret-scanning validity checks remained `disabled` on repository/org entitlement despite API enablement requests. | Documented limitation; cannot be verified by readback. |
| Startup reliability residual | [#1209](https://github.com/service-lasso/service-lasso/issues/1209) remains open, tracking cross-platform startup/qualification intermittency. | Known residual; reviewer should assess reliability evidence. |

### Low severity

| Finding | Description | Disposition |
| --- | --- | --- |
| Windows-only lockout | Published-package harness `localOperatorLockout` is Windows-only in the current matrix. | Documented in packet; not a blocking finding. |
| 30s bounded fuzz | Broker `FuzzSecurityContractParsers` ran 30 seconds (785,686 executions, no crash). This is bounded evidence, not continuous fuzzing. | Pre-review evidence only; not proof of absence. |
| Ledger superseded fail evidence | Ledger may still show rows from earlier superseded failed runs. | Historical evidence retained; does not affect frozen candidate. |
| Windows test plan not in repo | `release-1-independent-windows-test-plan.md` is referenced but not present in the repository. | Test plan should be located or created for external reviewer. |

## Packet-section coverage map

| Packet section | Coverage | Notes |
| --- | --- | --- |
| Exact review scope | **Supported** | All three release SHAs, tags, and publications verified via live API. |
| Product and security boundaries | **Supported** | Documentation reviewed; no live boundary testing performed. |
| Threat model and mitigations | **Partial** | Mitigations documented; threat execution not independently reproduced. |
| Cryptography and key lifecycle | **Partial** | Documentation reviewed; no independent crypto verification performed. |
| Identity, IPC, and abuse cases | **Unverified** | Abuse-case execution not performed in this readback. |
| Dependency, SBOM, and supply-chain | **Partial** | Zero-vuln claims documented; full re-audit not performed beyond release identity. |
| Repository and publication control | **Supported** | Live ruleset, CODEOWNERS, and protection state verified in packet; API readback for releases performed. |
| Static, dynamic, and fuzz evidence | **Partial** | Run IDs documented; no independent re-execution of CodeQL/fuzz/scans. |
| Published three-platform acceptance | **Supported** | Run `33509489660` verified terminal green with matching headSha. |
| Recovery and incident response | **Partial** | Documentation reviewed; no incident-response drill performed. |
| Explicit non-claims | **Supported** | Non-claims documented and acknowledged. |
| Independent reproduction | **Unverified** | Reproduction steps documented; not executed in this readback. |
| Reviewer decision record | **Empty** | No external reviewer has signed. |

## Verdict

The frozen `1f4ec40` packet is internally consistent and ready for a named **external** reviewer:

- All three component releases exist, are not draft, and targetCommitish matches the exact packet SHAs.
- Actions run `33509489660` is terminal green at the correct Core headSha.
- Issue #1151 (umbrella) remains open; #1208 (packet prep) is closed; #1209 (reliability residual) remains open.
- Packet documentation is comprehensive and covers threat model, crypto, supply-chain, three-OS, and recovery.

However:

- **Current `develop` HEAD (`ec33755`) is not the candidate.** PRs #1212 and #1215 introduced security-control changes after the frozen packet.
- **Do not promote to `main`.** AC-7H independent approval is not recorded.
- **Do not GA-label.** External review is the blocking gate.
- **This readback is not a reject of the frozen bytes.** It confirms readiness for external review of `1f4ec40`.

## Recommended next actions for delivery owner

1. **Clean checkout:** Perform all further review from a clean checkout of `1f4ec40` (frozen candidate) or `6e1a932` (final control readback), not from current `develop` HEAD.

2. **Engagement letter:** Bind the external reviewer engagement to the exact three component SHAs:
   - Core: `1f4ec40f13fe3867b24ca901c42fe31c69e01e8d`
   - Admin: `f015b4445b0526546a309301270186a697588166`
   - Broker: `f340883056ec3cf74b535fb46490b39382e8c823`

3. **Delta decision:** Treat PRs #1212 and #1215 as either:
   - **Out of Release 1:** Candidate remains `1f4ec40`; post-release hardening ships in a subsequent release.
   - **In Release 1 with delta packet:** Prepare a supplemental packet covering the permission/actor changes, re-run full qualification at the new HEAD, and have the external reviewer assess both the base packet and the delta.

4. **Independent reproduction:** The external reviewer must execute the packet's Independent reproduction section themselves, including:
   - Verify immutable release objects and exact SHAs
   - Verify npm integrity, provenance, and gitHead
   - Run unchanged published-package workflow in isolated clean consumers on all three OSes
   - Execute abuse cases against an isolated temporary store
   - Re-run audits, scans, and fuzz targets

5. **Locate or create Windows test plan:** Ensure `release-1-independent-windows-test-plan.md` is available or create it for the external reviewer.

## Packet reviewer decision record

**Status:** Empty / unsigned

The independent reviewer must append or link a signed decision per the packet requirements. Until that record exists and every blocking finding is resolved, Release 1 is not approved for `develop`-to-`main` promotion or GA publication.

---

*This evidence readback was prepared by MegaMindG as delivery-owner agent. It does not constitute independent security review or AC-7H approval.*
