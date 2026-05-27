---
title: Service Catalog
description: Canonical Service Lasso service repos and live README previews.
---

import ServiceCatalog from "./src/components/ServiceCatalog";

# Service Catalog

Use this page to find the canonical Service Lasso service repos. Each service
row links to the source repo and can load that repo's live `README.md` into the
viewer without copying the README into this docs repo.

The catalog table is populated from `docs/static/data/service-catalog.json`.
Update that JSON file to add, remove, rename, or regroup catalog rows without
editing the table component.

Runtime API consumers can also read host-specific compatibility data from
`GET /api/services`. Each service summary includes a `compatibility` block
with the current host platform, declared artifact platforms, required runtime
providers, declared ports, requirement status, and operator-safe blockers.
Each service summary also includes a `catalogProvenance` block derived from
the checked-in manifest: source path, release repo/tag, artifact asset names,
checksum presence, and packaged runtime version. The provenance block is
read-only catalog metadata for UI and drift checks.
This is read-only catalog metadata; it does not change install or start
behavior.

<ServiceCatalog />
