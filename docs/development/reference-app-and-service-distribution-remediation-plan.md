# Reference App And Service Distribution Remediation Plan

This document records the corrective plan for three linked gaps:

1. reference-app naming and meaning drift
2. `service.json` release/install contract drift
3. bundled versus download/install behavior drift, including the missing non-start install surface

The goal is to stop carrying those decisions only in chat and turn them into one explicit remediation plan.

## Governed execution map

This remediation now runs through four governed execution issues:

1. `ISS-042` / `TASK-042`
   - replace tag-driven release workflows with protected-branch timestamped versions
2. `ISS-043` / `TASK-043`
   - normalize reference-app repo names and retire deprecated starter repos
3. `ISS-044` / `TASK-044`
   - implement manifest-owned release/install metadata and non-start acquire flow
4. `ISS-045` / `TASK-045`
   - split bundled/no-download and bootstrap-download outputs honestly

The execution-order checklist for these items lives in:

- `docs/development/reference-app-service-distribution-task-list.md`

## Why this plan exists

The current repo and sibling starter repos have drifted in two different ways:

- some reference-app names and explanations are vague or overlapping
- some service-distribution behavior is being expressed through transitional scaffolding instead of the canonical service manifest

That creates confusion about:

- what each starter repo is actually for
- where service release/download metadata is supposed to live
- what "bundled" is allowed to mean
- whether Service Lasso can install/download a service without starting it

## The three problems to fix

### 1. Reference app meaning and naming

Current problem:
- some reference-app names describe app type (`web`, `tauri`)
- some names describe runtime/host style (`node`)
- some names describe packaging/distribution method (`packager-*`)
- `bundled` describes a distribution characteristic but not an app type

This makes the current starter repo set harder to reason about than it should be.

### 2. Canonical `service.json` release/install source

Current problem:
- the docs already say service release/download/install metadata should live in the service manifest
- the core runtime contract does not yet implement that shape
- some starter-repo behavior has therefore used transitional scaffolding

Required correction:
- `service.json` remains the only canonical service manifest
- release/download/install metadata must live in `service.json`
- app repos should not need separate sidecar source files to tell Service Lasso where a service archive lives

### 3. Bundled meaning and non-start install/download behavior

Current problem:
- "bundled" has been used too loosely
- the intended difference between prepackaged and bootstrap-download modes is not enforced tightly enough
- core still lacks a true service acquisition/install surface that can fetch/install a service without starting it

Required correction:
- `bundled` must mean the app ships with everything it needs already included
- no first-run service download should be required for the bundled/preloaded mode
- Service Lasso should be able to install/download a service without starting it

## Required end state

When this plan is complete:

- every reference-app name will clearly describe either:
  - an app host type
  - or a packaging target
- `service.json` will be the only canonical manifest for:
  - service identity
  - dependencies
  - runtime behavior
  - release/download/install metadata
- Service Lasso core will support a real install/acquire path that can:
  - resolve a release source from `service.json`
  - choose a release/version
  - download the archive
  - unpack/install it
  - record installed state
  - do all of that without forcing `start`
- bundled outputs will mean:
  - all required runtime/service payloads are already present
  - no first-run download is required

## Correct naming model

Use this split consistently:

### App host type

These names describe what kind of app host the user is running:

- `service-lasso-app-web`
- `service-lasso-app-node`
- `service-lasso-app-electron`
- `service-lasso-app-tauri`

### Packaging target

These names describe how a given app is packaged/distributed:

- `service-lasso-app-packager-pkg`
- `service-lasso-app-packager-sea`
- `service-lasso-app-packager-nexe`

Important rule:
- app host type and packaging target are different concerns
- packaging-target repos should not replace the app-type definition

### What this means for the current starter repos

Current repo handling should be:

- keep `service-lasso-app-web`
- keep `service-lasso-app-node`
- keep `service-lasso-app-electron`
- keep `service-lasso-app-tauri`
- retire `service-lasso-packager-node` after migration to `service-lasso-app-node`
- stop treating `service-lasso-bundled` as the canonical name for an app type or repo lineup entry

`bundled` may still describe an artifact mode, but it should not be the primary app-type identity.

## Correct service-distribution model

The canonical model is:

1. one service = one repo
2. one service repo publishes release artifacts
3. `service.json` points to that release source
4. Service Lasso installs the service from that manifest
5. the installed local `services/` tree is the runtime inventory

This means:

- app/reference repos own a repo-local `services/` inventory
- each entry is a tracked `services/<serviceId>/service.json`
- the inventory may describe services that are:
  - already prepackaged with the app
  - or resolved/downloaded later

It does not mean:

- app repos should invent extra sidecar source files
- app repos should carry ad hoc release-source metadata outside `service.json`

## Correct bundled/download model

### Bundled / preloaded mode

Bundled means:
- the app ships with the runtime
- ships with Service Admin
- ships with the tracked `services/` inventory
- and ships with the required service archives/payloads already included

Consequence:
- no first-run download

### Bootstrap-download / lightweight mode

Bootstrap-download means:
- the app ships with the runtime
- ships with the tracked `services/` inventory
- but some service payloads are acquired later from the release source described in `service.json`

Consequence:
- install/download may happen before first use
- but that is not the same thing as "bundled"

## Service Lasso core gap to close

The core runtime still needs a real install/acquisition layer.

That layer must support:

- resolving release/download metadata from `service.json`
- selecting version or release tag/channel
- downloading the correct platform archive
- unpacking into installed/runtime-owned paths
- recording installed state separately from the source manifest
- exposing install/config/start as distinct actions
- allowing install/download without starting the service

This should also lead to a CLI surface that can install/acquire services explicitly without requiring the service to be started.

## Planned implementation sequence

### Phase 1. Fix language and naming in docs

Update docs so they describe:

- app-type names separately from packaging-target names
- `bundled` only as a distribution mode meaning "already included"
- `service.json` as the only canonical service manifest

Deliverables:
- corrected reference-app naming docs
- corrected bundle-mode language
- explicit statement that no sidecar release-source files are part of the canonical model

### Phase 2. Normalize the manifest contract

Choose and lock the canonical release/install metadata shape inside `service.json`.

This should include first-class fields for:

- release source type
- repo/source identity
- tag/channel/version selection
- platform-specific artifact mapping
- install strategy such as archive extraction

Deliverables:
- canonical doc update for the final first-pass release/install manifest shape
- core contract + validator alignment plan

### Phase 3. Implement install/acquire in core

Add the missing runtime behavior so Service Lasso can:

- install a service from manifest-declared release metadata
- record installed state
- prepare config
- start later

Deliverables:
- core runtime support for release/install metadata
- non-start install/acquire flow
- test coverage for download/install/unpack behavior

### Phase 4. Reconcile starter repos

Refactor the starter repos so they all use the canonical manifest contract.

Deliverables:
- `services/*/service.json` becomes sufficient for release/install metadata
- remove transitional scaffolding where present
- align host repos to the corrected naming model

### Phase 5. Split bundled and bootstrap-download outputs clearly

Make release artifacts prove the two modes honestly:

- bundled/preloaded = no first-run download
- lightweight/bootstrap-download = first install/download allowed

Deliverables:
- explicit release-artifact behavior proof
- docs and tests that classify each mode correctly

## Reference repo handling plan

Current recommendation:

- `service-lasso-app-web`
  - keep as the browser-facing host
- `service-lasso-app-node`
  - keep as the plain Node host
- `service-lasso-app-electron`
  - keep as the Electron desktop host
- `service-lasso-app-tauri`
  - keep as the Tauri desktop host
- `service-lasso-packager-node`
  - retire after migration to `service-lasso-app-node`
- `service-lasso-bundled`
  - stop treating as the canonical app identity or baseline repo
  - either:
    - retire/archive the name after migration
    - or keep it only as an artifact/distribution label, not the main host identity
- create packaging-target repos only when there is a real implementation reason:
  - `service-lasso-app-packager-pkg`
  - `service-lasso-app-packager-sea`
  - `service-lasso-app-packager-nexe`

## Verification expectations

This remediation should only be considered complete when all of these are true:

- docs consistently use one naming model
- `service.json` is the only canonical service manifest for release/install metadata
- no sidecar release-source files remain in the starter repos
- core supports install/download without start
- bundled/preloaded outputs prove no first-run download
- bootstrap-download outputs prove install/download before use
- reference repos are aligned to the corrected host-type vs packaging-target model

## Immediate next action

The manifest/install gap is now closed for the bounded first slice:

- `service.json` now carries one bounded first-class `artifact` block in the real core contract
- `install` can acquire/download and unpack an archive from manifest-owned metadata without forcing `start`

The highest-value next implementation step is now:

**finish the bundled/preloaded versus bootstrap-download split so the sibling app artifacts prove "already included" versus "download on install" honestly.**
That is now the main remaining distribution-behavior gap behind the confusion.
