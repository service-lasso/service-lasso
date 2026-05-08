---
title: Workflow Package Catalog
sidebar_label: Workflow Package Catalog
---

# Workflow Package Catalog

Service Lasso workflow packages are Git-managed units of workflow metadata. The
catalog lets UI and workflow layers list, validate, and display official/core and
custom workflow repositories without reading raw secrets.

The first catalog contract lives in `src/platform/workflowCatalog.ts` and uses a
`workflow-package.json` metadata file per package.

## Package sources

### Official/core packages

Official/core packages are maintained by Service Lasso and use the `official.*`
namespace. They can be updated by pulling a new repository ref, but consuming
installations must not edit official package content in place.

Examples:

- package id: `official.core.maintenance`
- workflow id: `official.core.maintenance/backup-check`
- config path: `official/core-maintenance/defaults.yaml`
- tool id: `official.core.maintenance.service-lasso-cli`
- output dir prefix: `outputs/official/`

### Custom workflow repositories

Custom workflow repositories are additive overlays. They use the `custom.*`
namespace and can add local/operator-owned workflows without modifying official
content. In other words, custom repositories provide additive custom packages,
not in-place edits to official packages.

Examples:

- package id: `custom.local.reporting`
- workflow id: `custom.local.reporting/monthly-summary`
- config path: `custom/local-reporting/defaults.yaml`
- tool id: `custom.local.reporting.report-export`
- output dir prefix: `outputs/custom/`

Custom packages must not reuse official workflow ids, config paths, output dirs,
or tool ids. Invalid/colliding workflow packages fail validation with actionable
diagnostics instead of silently overriding official content.

## Metadata shape

Each package has a `workflow-package.json` file with id, version, repo/ref, owner,
engine requirements, tools, configs, secrets, schedules, and validation commands.
In short, the required identity fields are id, version, repo/ref, owner, and
engine requirements:

```json
{
  "id": "official.core.maintenance",
  "version": "2026.5.8",
  "displayName": "Core maintenance workflows",
  "owner": "service-lasso",
  "source": "official",
  "supportLevel": "core-supported",
  "repository": {
    "repo": "service-lasso/workflows-core",
    "ref": "2026.5.8",
    "path": "packages/core-maintenance"
  },
  "engine": {
    "engine": "dagu",
    "versionRange": ">=1.16.0"
  },
  "workflows": ["official.core.maintenance/backup-check"],
  "tools": [
    {
      "id": "official.core.maintenance.service-lasso-cli",
      "command": "service-lasso",
      "description": "Invoke Service Lasso CLI checks."
    }
  ],
  "configs": [
    {
      "path": "official/core-maintenance/defaults.yaml",
      "description": "Safe defaults for core maintenance workflows.",
      "required": true
    }
  ],
  "secrets": [
    {
      "namespace": "workflows/core-maintenance",
      "ref": "maintenance.API_TOKEN",
      "description": "Broker reference only; value is resolved at run time.",
      "required": false
    }
  ],
  "schedules": [
    {
      "id": "daily-backup-check",
      "cron": "0 3 * * *",
      "timezone": "UTC"
    }
  ],
  "validation": [
    {
      "name": "validate package metadata",
      "command": "service-lasso",
      "args": ["workflow", "validate", "official.core.maintenance"]
    }
  ]
}
```

## Secret boundary

Workflow packages can list required secret refs as metadata, but must never carry
raw secrets. The catalog may include:

- broker namespace metadata, such as `workflows/core-maintenance`,
- dotted secret refs, such as `maintenance.API_TOKEN`,
- safe descriptions and required/optional markers.

The catalog must not include raw provider secrets, access tokens, refresh tokens,
passwords, private-key material, client secret strings, or recovery material.
Runtime resolution happens through Secrets Broker or a configured source backend.

## API contract

The first platform endpoints are metadata-only:

```text
GET  /api/platform/workflow-packages
POST /api/platform/workflow-packages/validate
```

`GET` returns safe package metadata that UI and workflow layers can display.
`POST /validate` validates local package metadata before a package is added to
the catalog.

## Validation diagnostics

Catalog loading validates:

- required fields: `id`, `version`, `displayName`, `owner`, `repository`,
  `engine`, and `workflows`,
- official/custom namespace rules for workflow ids, config paths, output dirs,
  and tools,
- additive custom package behavior with no in-place official overrides,
- duplicate package ids,
- colliding workflow ids,
- colliding config paths,
- colliding tool ids,
- malformed broker secret refs, and
- raw secret-like material in metadata.

Diagnostics include:

- `code`, for example `workflow-collision` or `secret-material`,
- `severity`,
- `packageId`,
- `field`,
- human-readable `message`, and
- an actionable `action` string explaining how to fix the package.

Support warnings are allowed for local/custom packages. For example, a package
can declare `supportLevel: "local"` and a warning like `Local custom package
support is operator-owned.` UI layers should display those warnings without
blocking package listing.

## Tests

`tests/workflow-package-catalog.test.js` verifies:

- official/core and custom workflow repositories can be listed from metadata,
- package listing does not expose raw secrets,
- local metadata directories can be loaded,
- official/custom namespace rules are enforced,
- invalid/colliding workflow packages fail validation with actionable
  diagnostics, and
- raw secret-like payloads are rejected while broker refs are allowed.
