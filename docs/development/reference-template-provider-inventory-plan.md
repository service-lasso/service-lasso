---
unlisted: true
---

# Reference And Template Provider Inventory Propagation Plan

Date: 2026-05-01

Linked issue: `#172`

Spec binding: `SPEC-002`, `AC-4W`, `AC-4Y`, `AC-4Z`

## Purpose

Core `service-lasso` now carries verified release-backed provider manifests for `@node`, `@python`, and `@java`.

The remaining `#172` work is not core runtime implementation. It is the sibling-repo propagation step: make the reference apps and `service-template` inherit the same provider inventory model from core without accidentally turning non-baseline providers into implied defaults.

## Current State

Core currently ships these provider/runtime manifests:

- `services/@node/service.json`
- `services/@python/service.json`
- `services/@java/service.json`
- `services/@localcert/service.json`
- `services/@nginx/service.json`
- `services/@traefik/service.json`

Current sibling inventories do **not** mirror that full provider set.

Observed checked-in inventory shape across:

- `service-template`
- `service-lasso-app-node`
- `service-lasso-app-web`
- `service-lasso-app-electron`
- `service-lasso-app-tauri`
- `service-lasso-app-packager-pkg`

Current inventory contents are only:

- `echo-service`
- `@serviceadmin`
- `@node`
- `@localcert`
- `@nginx`
- `@traefik`

So the unresolved gap is precise:

- `@node` propagation is already done
- `@python` and `@java` are present in core but absent from sibling template/reference inventories
- current docs/backlog wording still sounds broader than the actual remaining work

## Planning Decision

Do **not** silently add `@python` or `@java` to the default baseline inventory.

Instead, propagate them as **optional checked-in provider examples** with these rules:

1. Baseline startup remains unchanged.
2. `@python` and `@java` stay `enabled: false` unless a host app explicitly opts in.
3. Sibling repos should demonstrate the canonical release-backed provider manifest shape from core.
4. Docs must clearly separate:
   - baseline services required for the default quick start
   - optional providers available for app/service authors to opt into

This keeps fresh-clone behavior stable while still making the provider inventory consistent across repos.

## Execution Phases

### Phase 1 - Inventory propagation

For each sibling repo:

- copy/adapt core `services/@python/service.json`
- copy/adapt core `services/@java/service.json`
- keep release pins aligned with core verified releases
- keep both manifests disabled by default
- preserve platform-support honesty, especially Windows-only Python

Target repos:

- `service-template`
- `service-lasso-app-node`
- `service-lasso-app-web`
- `service-lasso-app-electron`
- `service-lasso-app-tauri`
- `service-lasso-app-packager-pkg`

### Phase 2 - Inventory documentation alignment

Update sibling repo docs so they distinguish:

- baseline inventory: `echo-service`, `@serviceadmin`, `@node`, `@localcert`, `@nginx`, `@traefik`
- optional provider inventory: `@python`, `@java`

Minimum surfaces to check per repo:

- root `README.md`
- any `services/README.md`
- release-artifact or quick-start docs that enumerate checked-in services

### Phase 3 - Validation

After propagation, prove:

1. checked-in inventories still parse cleanly
2. baseline/fresh-clone flows are unchanged
3. optional disabled providers do not break source/bootstrap/bundled packaging flows
4. at least one reference validation pass confirms the new optional manifests are tolerated in a normal host repo

## Verification Expectations

Minimum proof for closing `#172`:

- each target sibling repo contains checked-in `services/@python/service.json`
- each target sibling repo contains checked-in `services/@java/service.json`
- docs in those repos call them optional/non-baseline providers
- existing baseline verification still passes where applicable
- no repo claims cross-platform Python support that does not exist

## Risks

- adding `@python` and `@java` carelessly could make readers think they are baseline-required
- sibling docs could accidentally overclaim Python Linux/macOS support
- packaging/bundled flows may need small exclusions or clarifications if disabled optional providers are still copied into artifacts

## Done Definition

`#172` can close when:

- core and sibling repos express the same provider inventory model
- baseline versus optional-provider distinction is explicit in docs
- reference/template inventories include release-backed `@python` and `@java` manifests in a disabled, honest form
- validation confirms the propagation did not regress the documented quick-start/baseline behavior
