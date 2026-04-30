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

<ServiceCatalog />
