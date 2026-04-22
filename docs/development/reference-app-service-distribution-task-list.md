# Reference App And Service Distribution Task List

This document turns the remediation plan into an executable governed sequence.

It covers four linked workstreams:

1. protected-branch release/version pipeline normalization
2. reference-app naming and repo-lineup normalization
3. canonical `service.json` release/install metadata in core
4. honest bundled/preloaded versus bootstrap-download outputs

It is based on:
- `.governance/specs/SPEC-002-core-standalone-runtime.md`
- `.governance/project/BACKLOG.md`
- `docs/development/reference-app-and-service-distribution-remediation-plan.md`

## Completion rule

This remediation is only complete when:
- docs consistently use one naming model
- releases and packages are created from protected-branch pushes using `yyyy.m.d-<shortsha>`
- `service.json` is the only canonical service manifest for release/install metadata
- core can acquire/install a service without forcing `start`
- bundled/preloaded outputs prove no first-run download
- bootstrap-download outputs prove manifest-driven install/download
- deprecated starter repos are retired and the canonical repo lineup is the only one referenced

## Workstream order

### 1. `ISS-042` / `TASK-042`

Status:
- done

Title:
- replace tag-driven release workflows with protected-branch timestamped versions

Intent:
- stop treating manual tags as the source of release identity
- make the release version pattern explicit and consistent with the service-style repos

Required outcomes:
- core release/package workflows compute `yyyy.m.d-<shortsha>`
- release creation happens from protected-branch pushes instead of tag-only triggers
- docs stop describing `v<semver>` tags as the normal release path
- verification scripts and staged artifact naming align with the release version policy

Required evidence:
- local release/package verification still passes
- workflows show the computed timestamped version
- release docs/README reflect the protected-branch version pattern honestly

### 2. `ISS-043` / `TASK-043`

Title:
- normalize reference-app repo names and retire deprecated starter repos

Execution order:
1. promote `service-lasso-packager-node` into the canonical `service-lasso-app-node` repo
   current progress:
   - `service-lasso-app-node` now exists locally and on GitHub
   - it is template-enabled
   - it reuses the proven plain-Node host implementation and passes local `npm test` plus `npm run release:verify`
   - `service-lasso-packager-node` can now be retired because the canonical replacement exists
2. create the canonical `service-lasso-app-electron` starter repo
   planned approach:
   - seed it from the current desktop-host shape in `service-lasso-app-tauri`
   - keep the bounded Node-host + embedded admin pattern
   - replace Tauri-specific next-step scaffolding with Electron-specific scaffolding
   current progress:
   - `service-lasso-app-electron` now exists locally and on GitHub
   - it is template-enabled
   - it reuses the proven desktop-host implementation pattern and passes local `npm test` plus `npm run release:verify`
3. create packaging-target starter repos only if they are still needed after the host-type repos exist:
   - `service-lasso-app-packager-pkg`
   - `service-lasso-app-packager-sea`
   - `service-lasso-app-packager-nexe`
   current decision:
   - defer until there is a real implementation reason beyond naming; the host-type repos now exist and remain the primary canonical lineup
4. update core docs and starter docs to point only at the normalized lineup
5. retire deprecated repos explicitly:
   - `service-lasso-packager-node`
   - `service-lasso-bundled`
   current blocker:
   - local `service-lasso-packager-node` is deleted
   - remote GitHub repo deletion is blocked until the acting token has `delete_repo`

Intent:
- separate app host type from packaging target
- stop using vague repo identities as the canonical model

Canonical app-host repos:
- `service-lasso-app-web`
- `service-lasso-app-node`
- `service-lasso-app-electron`
- `service-lasso-app-tauri`

Canonical packaging-target repos:
- `service-lasso-app-packager-pkg`
- `service-lasso-app-packager-sea`
- `service-lasso-app-packager-nexe`

Migration expectations:
- replace `service-lasso-packager-node` with `service-lasso-app-node`
- retire `service-lasso-bundled` as a primary repo identity
- create missing canonical repos where needed
- update docs/reference matrices/readmes to point only at the normalized repo set
- delete or archive deprecated local/GitHub starter repos once replacements are established

Required evidence:
- canonical repos exist locally and on GitHub
- deprecated repos are archived/deleted explicitly
- all core docs/reference docs point only at the normalized lineup

### 3. `ISS-044` / `TASK-044`

Title:
- implement manifest-owned release/install metadata and non-start acquire flow

Intent:
- make `service.json` the only canonical source for service release/download/install metadata

Required outcomes:
- core contract and validator accept first-class release/install metadata in `service.json`
- runtime can resolve manifest-owned release metadata
- runtime can acquire/download/install without forcing `start`
- installed-state recording is explicit and reviewable
- sidecar source metadata files are no longer needed

Required evidence:
- direct tests for manifest validation of the new fields
- direct tests for acquire/install without start
- documentation updates in core docs and `service-template`

### 4. `ISS-045` / `TASK-045`

Title:
- split bundled/no-download and bootstrap-download outputs honestly

Intent:
- make bundled behavior a property of the artifact, not a vague repo name

Required outcomes:
- bundled/preloaded outputs include all required service payloads
- bootstrap-download outputs rely on manifest-driven acquisition from the same `services/` inventory
- no first-run download occurs in bundled/preloaded mode
- reference-app release artifacts are documented and verified accordingly

Required evidence:
- runnable proof that bundled/preloaded mode starts without downloading service archives
- runnable proof that bootstrap-download mode acquires service payloads from manifest-owned metadata
- release docs for the canonical app repos classify their artifact mode honestly

## Immediate next item

Next:
- `ISS-043` / `TASK-043`

Why:
- the release/version baseline is now corrected
- the next highest-value fix is removing migration-era repo identities before deeper manifest/install work spreads them further
