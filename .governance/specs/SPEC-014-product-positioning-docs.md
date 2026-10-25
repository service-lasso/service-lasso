# SPEC-014: Product positioning documentation

Status: Active, documentation only. Mode: Development. Governing issue: #1861.

## Intent and scope

Explain app-owned native supporting services and independently testable worktree
runtimes. Add three linked reader pages and navigation, reusing existing technical
and security contracts. No runtime/API changes, release qualification, deployment,
security-setting changes or merge are authorized by this work unit.

## Requirements

- POS-1: Explain how app builders supply service manifests and workspace ownership
  while Core supplies lifecycle operations; link the integration and packaging paths.
- POS-2: Explain independent worktree state/runtime/endpoints, testing, ownership
  discovery and cleanup using current source APIs and the existing proof helper.
  No speculative flags or MCP tools. Label the helper as a source-repository tool.
- POS-3: Compare natural fit with containers and process managers using current
  official sources. Recognize PM2 API embedding/multiple instances and Docker Linux
  Engine/rootless/MCP. State same-UID and secret-delivery limits; no unsupported
  performance, battery, capacity or released-qualification claims.
- POS-4: Make all three pages discoverable from docs home/sidebar and each other.
  Validate site build, local links, source-contract accuracy and relevant existing
  tests/examples. Record exact outcomes and limitations before draft PR handoff.

## Verification and handoff

Evidence is recorded in `.governance/project/positioning-docs-1861.md` and issue #1861.
Source inspection proves names/contracts, not live service or published-package
qualification. Review the cumulative diff and preserve unrelated lanes. Retain the
feature worktree for draft PR review; the clone's resting branch stays `develop`.
