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
| Service Admin Help Center | Reader guides imported into this repository with exact source revisions | Replace independent authoring with a controlled export to Admin; retain working packaged help |
| Service template | Reader guides imported into Core | Replace source guides with links after the Core PR merges |
| Secrets Broker | Core already has setup, recovery, secret-access, and capability references | Broker has no `develop` branch; its source-guide audit requires an explicitly authorized branch workflow before proceeding |
| Other service and app-template repositories | Develop-branch availability and Markdown inventories audited across 42 repositories | 19 repositories have no accessible develop tree; remaining component guides and source redirects are tracked work, not claimed complete |
| Open documentation PRs | Core #1259/#1260 and Admin #616 remain independently owned | Incorporate their guides under this same Core ownership rule after review; do not publish competing authoritative copies |

The [source inventory](documentation-inventory.json) records every inspected Markdown document in Service Admin and service-template, its exact commit/blob identity, and its destination or retained status. An imported guide is a preserved starting point, not proof that source authoring has been switched over.

The [repository audit](repository-docs-audit.json) records the available `develop` trees and document paths for the wider product family. A missing tree is not treated as an empty documentation set.

## Editing and publishing

1. Edit the canonical guide in Core and validate links and the documentation build.
2. Keep component implementation changes and their specs in the component repository.
3. For packaged help, export the reviewed guide to the component without removing its status metadata or breaking its in-app links.
4. Redirect old repository links only after the central page is merged and accessible.

[Component guides](README.md) · [All documentation](../README.md)
