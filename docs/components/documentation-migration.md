---
title: Documentation ownership and migration
---

# Documentation ownership and migration

User, operator, integration, and service-authoring documentation belongs in **service-lasso/docs**. Component repositories own their code and code-governing specifications. They should link readers here instead of maintaining separate editable user guides.

## What remains with the code

- Short repository READMEs with purpose, install/build commands, and links here.
- AGENTS instructions, specifications, security policies, release evidence, and implementation decisions.
- Packaged copies required for an application's offline help. Those copies must identify their Core source and be refreshed from it; deleting them must not break the app.

## Migration status

| Area | Current state | Remaining work |
| --- | --- | --- |
| Core runtime, manifests, and service authoring | Already documented in Core | Keep all new reader guidance here |
| Service Admin Help Center | 21 canonical articles with deterministic export and checksum checking | Adopted in merged [Admin PR #620](https://github.com/service-lasso/lasso-serviceadmin/pull/620) (`abd681ed`); Admin [#617](https://github.com/service-lasso/lasso-serviceadmin/issues/617) and [#618](https://github.com/service-lasso/lasso-serviceadmin/issues/618) are closed |
| Service template | Reader guides imported into Core; six source redirects merged in [template PR #16](https://github.com/service-lasso/service-template/pull/16) | Keep redirects pointed at canonical Core guides |
| Secrets Broker | Core already has setup, recovery, secret-access, and capability references | Broker develop source is accessible at the 27 September 2026 inventory revision; exact-blob content review remains in progress under #1282 |
| Other service and app-template repositories | On 15 September 2026, develop-branch API checks returned 23 source revisions and 19 unavailable/inaccessible results across the 42 inventoried repositories | [Core #1282](https://github.com/service-lasso/service-lasso/issues/1282) records 100 reviewed paths, including eight focused migration candidates, and owns their remaining migrations and source redirects |
| Earlier documentation PRs | Core #1259/#1260 and Admin #616 are merged | Keep their navigation and UI guides under this same ownership rule |

The [source inventory](documentation-inventory.json) records every inspected Markdown document in Service Admin and service-template, its exact commit/blob identity, and its destination or retained status. An imported guide is a preserved starting point, not proof that source authoring has been switched over.

The [repository audit](repository-docs-audit.json) records the available `develop` trees and document paths for the wider product family. The [reader-guide classification ledger](reader-guide-classification.json) records the refreshed accessible-tree identities, classification, Core destination, and bounded next action. A missing tree is not treated as an empty documentation set.

The availability refresh and classification do not establish complete ecosystem migration. The ledger binds each reviewed reader candidate to its `develop` commit and blob; it does not treat unreviewed documents in an accessible repository as non-reader content. A potentially reader-facing source needs a focused migration issue before content moves or redirects; code-governing documents remain with their owner. All 19 formerly gated sources now have accessible, non-truncated develop inventories. The 27 September 2026 refresh records 169 exact revision/path/blob identities. Content review has classified 136 paths, with 33 still pending. Identical Git blobs at the same paths reuse the reviewed content decision while retaining separate repository and revision identities. Reviewed candidates include Files/BPMN integration, starter host and executable-wrapper onboarding, and the harness stub flow; their decisions do not claim completed migration. The older 23-source inventories and 100 reviewed dispositions retain their historical dates and source identities.

## Targeted reader-workflow migrations

Core now carries the template-origin workflow in [Create the Release Repo](../service-authoring/03-create-release-repo.md), the TypeDB operator commands in [One-shot Jobs](../reference/one-shot-jobs.md), and app-owned OpenObserve/SOARCA guidance in [Add OpenObserve or SOARCA to an app](app-owned-service-workflows.md). The reviewed source identities are recorded here so a later reader can distinguish imported guidance from local contracts:

| Source | Authorized `develop` revision | Blob | Core disposition |
| --- | --- | --- | --- |
| `service-lasso-app-docker-node-service/README.md` | `062260eb01a09f0b6cbace2fce3fe5b460ece53a` | `ab22d7c3c41c746cbb815a2876b36144e0805ebe` | Resolved as an optional Compose implementation pattern in [Resource Isolation](../reference/resource-isolation-model.md); its reference-specific wrapper commands, environment, and health contract remain component-owned. |
| `service-lasso-app-docker-node-service/docs/bootstrap-new-service-repo.md` | `062260eb01a09f0b6cbace2fce3fe5b460ece53a` | `fa0d1a0d258945f5d244163595a680b48673a6f9` | Migrated to [Create the Release Repo](../service-authoring/03-create-release-repo.md). |
| `lasso-traefik/README.md` | `76c1aba32565544d069e7f1d3d026ff16264de56` | `a2570ab187df61161e12167d591852bce9469ebb` | Resolved by [Traefik local route generation](../reference/traefik-local-route-generation.md) and [ZITADEL consumer integration](../reference/zitadel-consumer-integration.md); package, release, and protected-route contracts remain component-owned. |
| `lasso-traefik/docs/bootstrap-new-service-repo.md` | `76c1aba32565544d069e7f1d3d026ff16264de56` | `b9a924a70dc4707f56b4a1ac4a116d342b96a0c6` | Migrated to [Create the Release Repo](../service-authoring/03-create-release-repo.md). |
| `lasso-typedb/README.md` | `4f40b663bb3e971e5613da804d4f932dfa50340d` | `11569bfabb20a048dbbd275a273b559addc5cb15` | Migrated to [One-shot Jobs](../reference/one-shot-jobs.md). |
| `lasso-typedb/docs/job-boundary.md` | `4f40b663bb3e971e5613da804d4f932dfa50340d` | `d601d05404a30a4019fdc4187b33c04e7a8591aa` | Migrated to [One-shot Jobs](../reference/one-shot-jobs.md). |
| `lasso-openobserve/README.md` | `f90899445db9bbfdc15d983a8f62320e709e0721` | `d87322d0471f9e2a70abe957edee43b97426b4f1` | Migrated to [Add OpenObserve or SOARCA to an app](app-owned-service-workflows.md). |
| `lasso-soarca/README.md` | `579498fa08e28cc7c5e742b6d9b6a1110ceae7a4` | `9d7726a94467767e4b38ed4a09ceefe21fe37ca2` | Migrated to [Add OpenObserve or SOARCA to an app](app-owned-service-workflows.md). |

These Core pages do not complete the source migrations. The earlier redirect strategy in [Core #1287](https://github.com/service-lasso/service-lasso/issues/1287) was superseded by maintainer-directed legacy-guide removal. That closed item is no longer a redirect publication gate. Current surviving reader content still requires classification; component-owned contracts remain with their source. The 19 source-access gates are resolved; current-content classification and any focused migration follow-ups remain open under #1282.

[Core #1265](https://github.com/service-lasso/service-lasso/issues/1265) owns migration completion. [Core #1270](https://github.com/service-lasso/service-lasso/issues/1270) separately owns newcomer journey acceptance. A merged guide import does not complete either umbrella while its linked migration or runtime evidence remains missing.

## Editing and publishing

1. Edit the canonical guide in Core and validate links and the documentation build.
2. Keep component implementation changes and their specs in the component repository.
3. For packaged help, export the reviewed guide to the component without removing its status metadata or breaking its in-app links.
4. Redirect old repository links only after the central page is merged and accessible.

From a committed Core checkout, run `node scripts/export-admin-help.mjs --target=/path/to/admin`, then repeat with `--check`. Commit the generated files and `docs/help-source.json` together in Admin. Its checksum check rejects independent edits; article content remains bundled for offline reading. Source revision and checksums identify the export rather than implying a live connection to the docs site.

[Component guides](README.md) · [All documentation](../README.md)
