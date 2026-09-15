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
| Service Admin Help Center | 21 canonical articles with deterministic export and checksum checking | Adoption is implemented in [Admin PR #620](https://github.com/service-lasso/lasso-serviceadmin/pull/620), still pending qualification and merge; [Admin #617](https://github.com/service-lasso/lasso-serviceadmin/issues/617) owns offline-help acceptance |
| Service template | Reader guides imported into Core; six source redirects merged in [template PR #16](https://github.com/service-lasso/service-template/pull/16) | Keep redirects pointed at canonical Core guides |
| Secrets Broker | Core already has setup, recovery, secret-access, and capability references | Broker has no `develop` branch; its source-guide audit requires an explicitly authorized branch workflow before proceeding |
| Other service and app-template repositories | On 15 September 2026, develop-branch API checks returned 23 source revisions and 19 unavailable/inaccessible results across the 42 inventoried repositories | [Core #1282](https://github.com/service-lasso/service-lasso/issues/1282) records the affected repositories and owns guide classification, remaining migrations and source redirects |
| Earlier documentation PRs | Core #1259/#1260 and Admin #616 are merged | Keep their navigation and UI guides under this same ownership rule |

The [source inventory](documentation-inventory.json) records every inspected Markdown document in Service Admin and service-template, its exact commit/blob identity, and its destination or retained status. An imported guide is a preserved starting point, not proof that source authoring has been switched over.

The [repository audit](repository-docs-audit.json) records the available `develop` trees and document paths for the wider product family. A missing tree is not treated as an empty documentation set.

The availability refresh checks access only. It does not refresh the historical document inventory or establish that the 23 accessible sources have completed migration. Their classification can proceed while the other 19 source audits await an authorized development workflow.

[Core #1265](https://github.com/service-lasso/service-lasso/issues/1265) owns migration completion. [Core #1270](https://github.com/service-lasso/service-lasso/issues/1270) separately owns newcomer journey acceptance. A merged guide import does not complete either umbrella while its linked migration or runtime evidence remains missing.

## Editing and publishing

1. Edit the canonical guide in Core and validate links and the documentation build.
2. Keep component implementation changes and their specs in the component repository.
3. For packaged help, export the reviewed guide to the component without removing its status metadata or breaking its in-app links.
4. Redirect old repository links only after the central page is merged and accessible.

From a committed Core checkout, run `node scripts/export-admin-help.mjs --target=/path/to/admin`, then repeat with `--check`. Commit the generated files and `docs/help-source.json` together in Admin. Its checksum check rejects independent edits; article content remains bundled for offline reading. Source revision and checksums identify the export rather than implying a live connection to the docs site.

[Component guides](README.md) · [All documentation](../README.md)
