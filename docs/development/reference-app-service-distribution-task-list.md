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

Status:
- done

Title:
- split bundled/no-download and bootstrap-download outputs honestly

Intent:
- make bundled behavior a property of the artifact, not a vague repo name

Execution order:
1. convert one canonical app-host repo into the first honest bootstrap-download proof
   current target:
   - `service-lasso-app-node`
   current progress:
   - the generated local Echo wrapper has been removed from the app-node starter
   - `services/echo-service/service.json` now owns the bounded archive metadata directly
   - the app-node release flow now stages:
     - `*-source.tar.gz`
     - `*-runtime.tar.gz`
   - the runnable runtime artifact now proves install/download before use through manifest-owned metadata and local verification
2. fan the same bootstrap-download contract through the remaining canonical host repos:
   - `service-lasso-app-web`
   - `service-lasso-app-electron`
   - `service-lasso-app-tauri`
   current decision:
   - not required to close the remediation once one canonical app-host repo proves both artifact modes honestly
   - the remaining host repos can inherit the same artifact-mode contract as follow-on implementation work
3. decide where the no-download preloaded artifact mode should live in the canonical lineup
   completion outcome:
   - `service-lasso-app-node` is now the canonical repo that proves both bootstrap-download and preloaded/no-download artifact modes
   - `service-lasso-bundled` is no longer needed as a primary repo identity
4. prove the no-download preloaded mode honestly
   required proof:
   - service archives are already present inside the release artifact
   - install/start does not trigger a network fetch on first use
5. update the canonical docs and repo matrix so artifact mode and repo identity stay separate
6. retire or archive the old bundled repo identity once the canonical app-host repos cover both modes

Required outcomes:
- bundled/preloaded outputs include all required service payloads
- bootstrap-download outputs rely on manifest-driven acquisition from the same `services/` inventory
- no first-run download occurs in bundled/preloaded mode
- reference-app release artifacts are documented and verified accordingly

Required evidence:
- runnable proof that bundled/preloaded mode starts without downloading service archives
- runnable proof that bootstrap-download mode acquires service payloads from manifest-owned metadata
- release docs for the canonical app repos classify their artifact mode honestly

Current bounded evidence:
- `service-lasso-app-node` now provides the first canonical bootstrap-download proof:
  - tracked `services/` inventory copied directly into the prepared `servicesRoot`
  - no generated Echo wrapper
  - runnable runtime artifact with bundled admin assets and installed runtime deps
  - local verification that `install` downloads the Echo archive from manifest-owned metadata before use
- `service-lasso` core now reuses a preseeded archive already present in service state instead of redownloading it during `install`
- `service-lasso-app-node` now also provides the canonical preloaded/no-download proof:
  - `*-preloaded.tar.gz` ships a matching preseeded Echo archive under runtime-owned service state
  - local verification proves `install` succeeds without any first-run archive download
- the old `service-lasso-bundled` repo identity is retired after its useful release-artifact logic was moved into the canonical app-node repo

## Post-remediation follow-ons

The initial remediation is complete, but the next work should not live only in chat.

These items are now the ready-to-pick-up follow-on queue:

### 5. `ISS-046` / `TASK-046`

Status:
- done

Title:
- fan the honest artifact-mode contract through the remaining canonical app-host repos

Intent:
- keep `service-lasso-app-node` from becoming a one-off special case
- make the canonical app-host repos behave consistently around source/bootstrap/preloaded outputs

Execution order:
1. upgrade `service-lasso-app-web` to stage and verify:
   - `*-source.tar.gz`
   - `*-runtime.tar.gz`
   - `*-preloaded.tar.gz`
2. upgrade `service-lasso-app-electron` to the same artifact contract
3. upgrade `service-lasso-app-tauri` to the same artifact contract
4. verify that all three repos use tracked `services/*/service.json` inventory plus manifest-owned `artifact` metadata instead of transitional scaffolding
5. update release docs and POC docs so the artifact modes are described consistently

Required evidence:
- each repo passes `npm test`
- each repo passes `npm run release:verify`
- each repo has release docs that classify `source`, `runtime`, and `preloaded` modes honestly

Completion outcome:
- `service-lasso-app-web`, `service-lasso-app-electron`, and `service-lasso-app-tauri` now match `service-lasso-app-node` by shipping:
  - `*-source.tar.gz`
  - `*-runtime.tar.gz`
  - `*-preloaded.tar.gz`
- all three repos now use tracked `services/*/service.json` inventory plus manifest-owned `artifact` metadata instead of generated Echo wrapper manifests
- all three repos now verify the artifact contract through:
  - `npm test`
  - `npm run release:verify`
- all three repos now document the artifact modes honestly and use the timestamped `yyyy.m.d-<shortsha>` release pattern on `main`

### 6. `ISS-047` / `TASK-047`

Status:
- done

Title:
- add a first-class CLI/service-install surface for acquire without start

Intent:
- stop making install-without-start available only through the API/runtime internals
- give operators and reference apps a supported command path for explicit acquisition

Execution order:
1. define the bounded CLI contract and docs
2. wire the CLI to the existing manifest-owned acquire/install flow
3. add direct verification for:
   - acquire/install without start
   - repeated install when an archive is already present
4. document how reference apps can use the CLI during packaging/preload steps

Required evidence:
- direct tests for the CLI install/acquire path
- docs showing the supported command
- local verification against the bounded archive flow

Completion outcome:
- the core package/runtime now exposes a bounded supported CLI surface:
  - `service-lasso install <serviceId> --services-root <path> --workspace-root <path>`
- the CLI reuses the same manifest-owned `artifact` install flow as the bounded runtime/API path instead of inventing a parallel acquisition implementation
- repeated CLI installs reuse the already downloaded archive when it is present in runtime-owned service state
- direct CLI tests now prove:
  - acquire/install without `start`
  - repeated install without redownloading the archive

### 7. `ISS-048` / `TASK-048`

Status:
- done

Title:
- complete retirement of the deprecated bundled repo identity

Intent:
- finish the cleanup after the canonical artifact-mode proof moved to `service-lasso-app-node`

Execution order:
1. delete the remote `service-lasso-bundled` repo
2. remove any remaining canonical references that still imply it is part of the active lineup
3. verify the normalized lineup remains the only one presented in docs and repo matrices

Required evidence:
- the remote repo no longer exists
- doc/reference scans show only the normalized canonical lineup in forward-looking guidance

Completion outcome:
- the deprecated `service-lasso/service-lasso-bundled` remote repo has been deleted
- `gh repo view service-lasso/service-lasso-bundled` now returns not found/no access
- remaining `service-lasso-bundled` references are historical/remediation traceability, not active canonical-lineup guidance
- the normalized canonical app-host lineup remains:
  - `service-lasso-app-web`
  - `service-lasso-app-node`
  - `service-lasso-app-electron`
  - `service-lasso-app-tauri`

### 8. `ISS-049` / `TASK-049`

Status:
- done

Title:
- make an explicit go/no-go decision on packaging-target repos

Intent:
- stop leaving `pkg` / `sea` / `nexe` packaging targets as implied future work

Execution order:
1. record the real decision criteria for creating packaging-target repos
   outcome:
   - packaging repos should only exist when they express a delivery technology that the canonical app-host repos do not already cover clearly
2. choose one of:
   - create the justified repos with a bounded contract
   - defer them explicitly with recorded reasons
   outcome:
   - `service-lasso-app-packager-pkg` is justified as the first bounded packaging-target repo because it proves a real `pkg` launcher around the canonical Node host
   - `service-lasso-app-packager-sea` and `service-lasso-app-packager-nexe` stay deferred until there is a proven delivery need beyond the canonical Node host plus `pkg` path
3. update the docs so packaging-target repos are either real tracked work or explicitly deferred
   outcome:
   - the core docs now describe `app-packager-pkg` as the current bounded packaging-target repo
   - `SEA` and `nexe` are documented as deferred, not implied

Required evidence:
- the backlog/docs show an explicit decision rather than vague placeholders
- any created packaging-target repos have a bounded documented contract

Completion outcome:
- `service-lasso-app-packager-pkg` now exists locally and on GitHub as a template-enabled packaging-target repo created from `service-lasso-app-node`
- it adds a bounded `pkg` wrapper with honest `source`, `runtime`, and `preloaded` artifacts plus protected-branch `yyyy.m.d-<shortsha>` release versioning
- `service-lasso-app-packager-sea` and `service-lasso-app-packager-nexe` remain explicitly deferred until a real implementation need exists

### 9. `ISS-050` / `TASK-050`

Status:
- done

Title:
- add a host-owned service listing widget to each canonical app-host sample UI

Intent:
- show direct runtime API usage in the sample app shells instead of leaving the host-owned UI as static framing only
- keep the host shell and Service Admin roles clearly separate

Execution order:
1. define one bounded widget contract shared across:
   - `service-lasso-app-web`
   - `service-lasso-app-electron`
   - `service-lasso-app-tauri`
2. fetch runtime service data from the existing Service Lasso API instead of hard-coding service content
3. render a small host-owned widget that shows enough proof of API use, such as:
   - service id/name
   - lifecycle state
   - health summary
4. keep the existing embedded Service Admin surface intact and visually separate from the widget
5. update repo docs/release-artifact docs to mention the widget as part of the sample-host proof

Required evidence:
- direct tests cover the widget/API path in each canonical app-host repo
- smoke proof shows the widget rendering against a running runtime in each repo
- docs describe the widget as a host-owned runtime API example rather than a second admin surface

Completion outcome:
- `service-lasso-app-web`, `service-lasso-app-electron`, and `service-lasso-app-tauri` now each render a bounded host-owned service listing widget in the sample shell
- each host exposes a same-origin `/api/runtime-services` route that proxies the Service Lasso runtime `/api/services` response instead of hard-coding service content
- each widget renders service identity, lifecycle state, and health summary while keeping the embedded Service Admin surface visually and conceptually separate
- each repo documents the widget in its README, minimal POC, release artifact notes, and task list
- each repo merged its issue branch to `main`, archived the active branch under `archived/ISS-050-*`, and has green post-merge CI plus release workflow evidence
