# PR #1577 reconciliation receipt

## Scope and custody

- Captured 2026-10-02 (Australia/Sydney) by the explicitly authorised branch-reconciliation role.
- Corrective branch: `codex/1577-release-reconciliation-develop`, created from `origin/develop` at `a5a5f07ceddbdef890477549381a8752eb023715`.
- Reconciliation input: `origin/main` at `7582076d351cb03a12d89aec771566d5c1eaf5c4`; merge base `c3a454a8c5f00615c4f92aee8e49339f01e94d97`.
- Isolated checkout: `D:/projects/service-lasso/service-lasso-pr1577-reconciliation-develop`.
- The merge is intentionally uncommitted while source reconciliation is reviewed. Neither protected branch has been changed.

## Source and tool receipt

- Main-only inventory: `audit-evidence/1577-main-only-source-inventory.txt`; 259 paths, SHA-256 `BEB514D01CE231C45121D3DFA6F8269F62E0BCF30C858432E71E20B73A0A76E7`.
- Per-path classification: `audit-evidence/1577-main-only-classification.json`; 259 entries, SHA-256 `1730B6A84400050ACADA30FB5CA93274AB44EA72528029C5C39C093BC6F62EA8`.
- C# compiler: `C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe`, SHA-256 `46809206887326D2D24DB1EFF1F3064DE972C3451ABE766B49111450A5E08E00`.
- Node: `C:\\nvm4w\\nodejs\\node.exe`; Git: `C:\\Program Files\\Git\\cmd\\git.exe`.
- `SERVICE_LASSO_WORKSPACE_ROOT`, `SERVICE_LASSO_INSTANCE_REGISTRY_PATH`, and `SERVICE_LASSO_HOST_PORT_REGISTRY_PATH` were absent before qualification; this reconciliation created no runtime, instance, or port registry.

## Conflict decision record

The merge exposed 31 conflicts. Runtime/server, paired tests, lifecycle diagnostics, governance/CI, package metadata and generated documentation retain the current `develop` architecture. The per-path classification identifies the retained behavior/control for each `main`-only path rather than treating the inventory as one blanket decision. The malformed transfer parser at `src/server/index.ts` was repaired directly from the focused `ad781db3` source change: the range parser now closes and duplicate-key validation delegates to the established object-member scanner. The package manifest was reconciled manually to retain each current script and dependency exactly once. Generated inventories remain pending their repository regeneration command after source validation.

This is source reconciliation evidence only. It does not establish a qualified release candidate, CI success, a GA decision, deployment, or promotion.
