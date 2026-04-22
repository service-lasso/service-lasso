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

Status:
- done

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
   current progress:
   - the core forward-looking docs now describe the canonical app-host lineup as `app-web`, `app-node`, `app-electron`, and `app-tauri`
   - packaging-target repos are now described as optional later additions rather than part of the baseline lineup
   - old names remain only in remediation/history context where they still matter for retirement tracking
5. retire deprecated repos explicitly:
   - `service-lasso-packager-node`
   - `service-lasso-bundled`
   current outcome:
   - local `service-lasso-packager-node` is deleted
   - remote `service-lasso-packager-node` is explicitly deprecated, redirected to `service-lasso-app-node`, and archived on GitHub
   current decision:
   - `service-lasso-bundled` is not part of the canonical lineup
   - final retirement or repurposing of that repo belongs with `ISS-045`, because its remaining value is tied to honest bundled-versus-bootstrap artifact behavior

Intent:
- separate app host type from packaging target
- stop using vague repo identities as the canonical model

Canonical app-host repos:
- `service-lasso-app-web`
- `service-lasso-app-node`
- `service-lasso-app-electron`
- `service-lasso-app-tauri`

Optional packaging-target repos:
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

Completion outcome:
- `service-lasso-app-node` exists locally and on GitHub as the canonical plain-Node host repo
- `service-lasso-app-electron` exists locally and on GitHub as the canonical Electron host repo
- `service-lasso-packager-node` is removed locally and archived remotely with an explicit deprecation redirect
- `service-lasso-bundled` is no longer treated as part of the canonical lineup and is deferred to `ISS-045` only as an artifact-mode decision

### 3. `ISS-044` / `TASK-044`

Status:
- done

Title:
- implement manifest-owned release/install metadata and non-start acquire flow

Execution order:
1. lock one bounded first-class `artifact` shape inside `service.json`
   current bounded target:
   - `artifact.kind = "archive"`
   - `artifact.source.type = "github-release"`
   - one bounded source block with repo/channel-or-tag metadata
   - one bounded platform map with release asset and runtime command metadata
2. extend the validator and manifest contract to accept that bounded shape
3. implement `install` as a true non-start acquire action
   bounded behavior:
   - resolve the current platform asset from `service.json`
   - acquire/download the archive from manifest-owned metadata
   - unpack it into a runtime-owned install location
   - persist install/acquire metadata separately from runtime start state
4. let direct execution fall back to the installed artifact command when the manifest relies on installed runtime payload instead of a checked-in executable
5. prove the flow with direct local tests using a fake release source
6. update core docs, spec/backlog evidence, and follow-on starter expectations

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

Completion outcome:
- the core manifest contract now accepts one bounded first-class `artifact` block inside `service.json`
- `install` can resolve current-platform archive metadata from the manifest, acquire/download the archive, unpack it into a runtime-owned install location, and persist install metadata without forcing `start`
- direct execution can fall back to the installed artifact command when the manifest relies on installed runtime payload instead of a checked-in executable
- direct tests now prove manifest parsing plus install-without-start and start-from-installed-artifact behavior using a local fake release source

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
- `ISS-045` / `TASK-045`

Why:
- the manifest-owned release/install baseline is now corrected
- the next highest-value fix is making bundled/preloaded versus bootstrap-download artifact behavior honest across the sibling app repos
