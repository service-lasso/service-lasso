# SPEC-007: Secrets Capability and Release-Readiness Ledger

## Intent

Create one evidence-bound source of truth for Secrets Broker capability across
Core, Secrets Broker, and Service Admin. The ledger prevents prototype UI,
allowlisted routes, source tests, and closed issues from being presented as
validated live product behavior.

## Scope

Included:

- every capability family and release wave named by Core issue `#871`;
- every Secrets/Admin request and product-decision item named by Service Admin
  issue `#97`;
- exact owning repository/issue, endpoint or schema, backend coverage, maturity,
  security/audit boundary, Admin surface, evidence, blocker, and next action;
- a structural CI check for required fields and valid maturity/release values;
- README and live-readiness links back to the canonical ledger.

Explicitly out of scope:

- changing runtime, Broker, or Admin product behavior;
- promoting a capability because its issue is closed or its source tests pass;
- resolving release pins, provider credentials, live-process failures, or
  downstream UI defects from inside this documentation slice;
- deleting deferred or deliberately excluded capability;
- claiming Vault/OpenBao enterprise parity, HSM custody, FIPS compliance, MFA,
  or protection from unknown future vulnerabilities.

## Requirements and Acceptance Criteria

### `AC-7A` — Canonical structured ledger

`docs/reference/secrets-capability-ledger.json` is the canonical structured
record. Every row has a stable id, family, capability/operation, owner and issue,
endpoint/schema, provider/backend coverage, maturity, security/permission/audit
requirements, Admin surface, evidence, release wave, blocker, and next action.

### `AC-7B` — Honest maturity

Maturity is exactly one of `planned`, `read-only`, `dry-run`, `executable`,
`validated`, or `excluded`. A route or UI model alone is not executable.
`validated` requires row-specific real-process evidence. `excluded` requires a
recorded product decision, an unavailable or hidden release surface, and an
explicit non-claim. Cross-repository rows use the maturity of the least-proven
required segment.

### `AC-7C` — Complete programme coverage

The ledger covers Releases 1-4 from `#871`, deferred enterprise capability, and
all items from Service Admin `#97`, including navigation/table decisions,
routes/topology, inventory actions, policy, bootstrap alternatives, events,
lockouts, filtering, MCP, Sync, automated rotation, telemetry, Audit, HSM, FIPS,
and MFA.

### `AC-7D` — Review automation

`npm run docs:check-secrets-ledger` fails on a missing required field, duplicate
id, unsupported maturity/release value, invalid evidence timestamp, missing
evidence URL, or an unrepresented programme capability id. The Docs Site pull
request workflow runs the check before building documentation.

### `AC-7E` — Current evidence and residual truth

The initial observation records exact issue/PR/check URLs and does not hide
active residuals. In particular, Core `#806` remains blocked by preserved local
recovery state; `#887` owner action remains in review; Admin `#459` remains
open; and Admin PR `#569` has a failing Windows real-browser gate after the
rotation flow, so that cross-repository path is not validated.

### `AC-7F` — Release 1.0 scope, repository authority, and explicit exclusions

For the current GA delivery, #1613 records the owner's 2026-10-04 Windows/Linux scope decision in [CURRENT_GA_PLATFORM_SCOPE](../project/CURRENT_GA_PLATFORM_SCOPE.md). macOS qualification is Deferred / Not applicable to this GA, never PASS; historical/default three-platform obligations and macOS support source are retained. This applicability decision leaves every Windows/Linux original product, native, operator, template, publication and same-byte requirement intact. Existing qualification workflow/validator propagation is a blocking follow-up, not a completed gate.

Issue #1613 documentation acceptance requires the release-governance validator to validate the linked current owner/date/issue/platform decision and reject missing or inconsistent applicability, removal of Windows/Linux proof, false macOS PASS, or weakening of exact-candidate/publication/authority/privacy requirements. A historical contract without a current scope decision retains Windows, Linux, and macOS published-package requirements. This documentation validator change does not alter qualification producers, artifact inventories or aggregates. The documentation site's GA record must link to the canonical scope source using a supported external GitHub source URL; do not duplicate the policy or relax broken-link enforcement. Positive and negative regression sources require a different entire-source review and NEW complete-input ROOT admission before local execution.

Release 1.0 is the production-grade local encrypted-store product. Its required
rows cover secure age/recovery bootstrap and custody, generated credentials,
inventory/search/controlled reveal/rotate-without-reveal, versioned local
lifecycle, linked rotation/activation/rollback/retirement/restart persistence,
backup/integrity/restore/master-key rotation/recovery, durable redacted
audit/events/lockouts/filtering, service-secret-provider topology,
Routes/Traefik, and completed Admin navigation/page/table decisions.

PGP bootstrap is explicitly excluded and unavailable; the approved age and
recovery model remains the only Release 1 bootstrap claim. Fleet and Sessions
are hidden or retired for Release 1 and ZITADEL owns session behavior. Policy
Simulation is removed in favor of actual service-manifest secret-access
assignments. Any required capability without released-artifact GA evidence is
disabled, hidden, or labelled preview and cannot be marked `validated`.

External-provider mutation, bulk campaigns, full Secrets Sync apply, scheduled
rotation, Broker mutation MCP, HSM custody, FIPS compliance, and MFA are
excluded from Release 1 and remain explicit later-wave/non-claim rows.

The Core GitHub repository is the 1.0 authority boundary for working-release
publication. `CODEOWNERS` names the required reviewers for every path, including
workflow, governance, security, and owner files. `SECURITY.md` is the public
vulnerability reporting path. GitHub Actions workflows pin third-party actions
to commit SHAs. `npm audit --omit=dev` reports zero production vulnerabilities.
`develop` is protected with required status checks, required reviews, no
force-push, and administrator enforcement. Publishing is restricted to the
protected `release` GitHub Environment. Default Actions permissions are
read-only, and pull requests from forks cannot write repository contents or
secrets. Provider-generated dependency branches are the only exception to the
typed issue-branch prefix: they must target `develop`, be owned by the exact
`dependabot[bot]` actor, use the `dependabot/npm_and_yarn/` or
`dependabot/github_actions/` namespace, and retain current-`develop` ancestry
before review. No other actor may claim that namespace. Sibling Admin owns its
matching repository authority separately.

### `AC-7G` — Zero-known-vulnerability and supply-chain release gate

Release 1.0 requires zero known unremediated vulnerabilities of any severity in
the exact shipped production graphs at release time. Core must pass
`npm audit --omit=dev`; Admin must pass `pnpm audit --prod`; Broker source and
packaged binaries must pass current `govulncheck`. Critical/high build findings
also block release. Alerts may be dismissed only when exact-version evidence
proves they are stale or inapplicable.

Every shipped platform archive requires a release-bound SBOM, verified digest,
checksum-before-extraction behavior, provenance/attestation, signed checksum or
provenance metadata, asset inventory readback, and independent repeatable build
instructions. Publication is explicitly dispatched through an approval-gated
release environment and never occurs from an ordinary integration push.

Qualification diagnostics are release evidence, not publication authority. For
the `#1386` packaged-MCP consumer-acquisition child, any retained diagnostic is
limited to the closed `SPEC-006 AC-6G` stage/code/subcode receipt and its normal
cleanup precedence. It must never contain a command line, registry URL,
package path, raw npm report, stdout, stderr, token, environment value, or a
duration-derived cause claim. A closed receipt can identify an observed failure
class for later investigation; it neither attributes the historical failure nor
authorizes retry, publication, promotion, deployment, or GA.

### `AC-7H` — Release 1 security evidence and owner decision gate

Before Release 1 GA, the exact immutable Core, Admin, and Broker identities
must have a review-ready security packet covering the threat model, trust
boundaries, cryptography and key lifecycle, IPC and identity enforcement,
abuse cases, dependency/SBOM/provenance state, static/dynamic/fuzz evidence,
released-artifact qualification on the required platforms (Windows and Linux for the current #1613 GA scope; macOS Deferred / Not applicable), recovery and incident handling,
explicit non-claims, and repeatable reproduction instructions.

Agents independently assess the governed technical gates and may report
`Technically Ready for GA` for the exact candidate. The project owner/release
owner alone accepts residual risk, declares GA, and authorizes promotion,
publication, or deployment. The decision names the release tag, full commit
SHA, npm package version, qualification evidence and dispositions of open
investigations. An independent reviewer is optional unless the release owner
explicitly makes that review mandatory and names the reviewer for the exact
candidate. Deferred independent review is a follow-up, never a GA blocker.
Neither owner risk acceptance nor reviewer evidence converts a missing or
failed technical gate into green evidence. The decision model and linked
procedures are canonical in `.governance/rules/gov-09-release-authority.mdc`
and `.governance/project/RELEASE_TRACEABILITY.md`.

## Tests and Evidence

- `npm run docs:check-secrets-ledger`.
- `npm run docs:build`.
- `git diff --check`.
- `node --test --test-concurrency=1 tests/release-authority.test.js`.
- `npm run audit:production`.
- `node scripts/verify-core-release-authority.mjs` against the live GitHub API.
- Live issue, PR, Project, branch, and worktree evidence observed on
  `2026-08-25` and linked from the ledger.
- Repository security settings, open-alert counts, exact production audits,
  release environments, workflow pinning, and branch protection read back on
  `2026-08-31` under issue `#1164`.
- Exact published-package qualification run `33509489660` completed on
  `2026-09-01` at Core `1f4ec40f13fe3867b24ca901c42fe31c69e01e8d`:
  Windows, Linux, macOS, and aggregate jobs passed; the artifact API returned
  exactly three nonempty, unexpired 90-day metadata records; every Release 1
  product scenario passed without mutation retry.
- Exact Admin release `f015b4445b0526546a309301270186a697588166` passed
  three-platform real-browser run `33437554122`; focused release-surface proof
  passed 57/57 assertions and 7/7 browser cases. Exact Broker release
  `f340883056ec3cf74b535fb46490b39382e8c823` passed release run
  `33376912641`, native source and shipped-binary vulnerability gates, and a
  30-second `FuzzSecurityContractParsers` campaign with 785,686 executions and
  no failure.
- Core local candidate proof on `2026-09-01`: production audit found zero
  vulnerabilities; the critical/high tooling gate passed; the full tooling
  audit initially retained 18 moderate dev-only Docusaurus-chain findings; a
  narrow `sockjs` override to patched `uuid` 11.1.1 then cleared the complete
  audit while retaining its reviewed CommonJS surface. The 25-capability
  ledger, typecheck, and diff integrity passed. The latest serial aggregate
  passed every product row except one
  runner-invalid Windows `npm.cmd` crash (`0xC0000409`, no output), whose exact
  staged-package consumer row then passed 10/10 in fresh processes. Hosted
  exact-head and retained-artifact qualification remains blocking evidence.
- Rebased Core proof on `2026-09-01`: the 1,002-test serial aggregate reported
  996 pass, four expected platform skips, and two start actions returning 409
  under sustained host load; both exact rows passed together 2/2 in fresh
  processes. Rebase-interaction fixes passed 13/13 plus dependency diagnostics,
  the oversized-v1 generation migration/current-state rejection proof passed,
  production audit remained at zero, and hosted exact-head evidence remains the
  merge authority.

## Documentation Impact

- Add `docs/reference/secrets-capability-ledger.json`.
- Add `docs/reference/secrets-capability-ledger.md`.
- Link the ledger from root README, docs README, and the live-readiness record.

## Verification

Review the structured ledger and documentation links against the live issues
and pull requests. The check proves structure and programme coverage; it does
not upgrade maturity. Reviewers must reject a `validated` row unless its
evidence is a row-specific real-process result.

## Change Notes

- 2026-08-25: Issue `#872` was deliberately promoted from Backlog when the
  Secrets release-governance tranche was explicitly selected. No competing
  assignee, branch, worktree, or pull request existed at intake.
- 2026-08-31: Core `#1164` adds `AC-7F` for 1.0 repository and release
  authority: CODEOWNERS, SECURITY.md, SHA-pinned Actions, production audit,
  protected `develop`, and the protected `release` publication environment.
- 2026-08-27: Core `#1152` is the `SPEC-002` `AC-4BZ.1` published-package
  evidence gate for the working-release claim linked to `#1151` and `#871`.
  Its workflow and retained metadata cannot upgrade any ledger maturity row:
  that requires a dispatched exact-publication run with terminal Windows,
  Ubuntu, and macOS results plus artifact API readback and row-specific live
  product evidence.
- 2026-08-31: `AC-7F` and `AC-7G` freeze the Release 1 local-store scope,
  explicit exclusions/non-claims, zero-known-production-vulnerability rule,
  protected publication authority, and exact shipped-artifact supply-chain
  evidence required by release-security issue `#1164`.
- 2026-09-01: The post-merge dependency integration for `#1164` binds the
  provider-generated Dependabot branch exception to the exact bot actor and
  current `develop` ancestry, keeps all other work on typed issue branches,
  aligns every CodeQL phase to one immutable v4 release, and requires the
  merged TypeScript 7 graph to typecheck without weakening strictness.
- 2026-09-01: Issue `#1208` adds `AC-7H`, refreshes all fourteen Release 1
  rows to thirteen `validated` and one explicitly `excluded`, and binds the GA
  decision to a review-ready packet plus independent security sign-off at the
  exact immutable release identities.
- 2026-09-03: Issue `#1219` restores the fail-closed Core `develop` graph after
  new `fast-uri` and `qs` advisories. Dependabot `#1220` already shipped
  `fast-uri` 3.1.7. This slice overrides production `qs` to patched 6.16.0
  through `@modelcontextprotocol/sdk` -> Express/body-parser so
  `npm audit --omit=dev` is zero and full `npm audit` has no critical/high
  finding. A source lockfile fix is not remediation of published npm
  `2026.9.1-1f4ec40`; republish and checksum-bound replacement remain `#1151`.
- 2026-09-04: Core `#1209` adds `SPEC-002` `AC-4BZ.2` reliability classification
  for published-package acquisition, startup, readiness sampling, and owned
  cleanup. Historical failed dispatches remain unwaived. Mutation retry stays
  forbidden. This is not a substitute for `AC-7H` independent review.


### Issue #1439: audit-request qualification evidence

Under AC-7E, qualification audits retain bounded bulk/quick endpoint, HTTP status and elapsed-time observations without request bodies, credentials or arbitrary URLs. Production audit retains omit-dev/low and tooling audit retains high severity. Original npm findings and failure status remain authoritative; no automatic retry, waiver or lock mutation is introduced. A local successful bulk request is distinct from a hosted failure and does not establish its upstream cause.

### Issue #1494: tooling dependency hygiene

Under AC-7E, Core retains the secret-free failed Docs Site observation from
`36663989108` / job `109724626749` at develop
`d724258656b582d2e11b12473d5a8499547823b4`: the high
`brace-expansion <=1.1.20` advisory reached `minimatch@3.1.5` through its
declared `^1.1.7` range. Core selects the compatible patched `1.1.21`
resolution through a root override and records the exact candidate audit
result. The separate moderate `fast-uri` advisory is tracked by #1493 and is
not remediated by this issue. This work does not waive, retry, or alter the
failed run, and it does not make a release or GA claim.

### Issues #1493 and #1494: exact-head audit integration

The independently reviewed source deltas start from develop
`d724258656b582d2e11b12473d5a8499547823b4`; the integration candidate rebases
them onto current develop and composes only the reviewed `fast-uri` `3.1.8`
lockfile delta from PR #1497 head
`668879645c2c3c73688459cbf625623e547c8e9b` and the compatible
`brace-expansion` `1.1.21` root override and lockfile delta from PR #1498 head
`88efa5dd9c18daa744cb1db9d0be2c0a77328918`. It must pass clean installation,
zero production and tooling audits, ledger/build validation, and focused build
checks at its own exact head. These local checks are surrogate evidence pending
hosted exact-head CI; the historical Docs Site and Windows #1326 failures remain
separate and unwaived. This integration does not release, deploy, publish, or
make a GA claim.

## Issue #1600 fixture/input acceptance clarification

Preserve existing acceptance criteria and production checks. The complete source-only
fixture scope, original failures, dependency owners and subsequent evidence gates
are bound in [issue 1600 contract map](../project/QUALIFICATION_FIXTURE_INPUTS_1600.md).
This clarification authorizes faithful input/assertion reconciliation, no protected
skip, deadline or permission widening, native-custody substitute, or release claim.

## Issue #1602: complete immutable operator-tool contract

AC-7F/AC-7G and SPEC-002 AC-4CG require public upstream tool metadata to bind a full source commit and exact tag to draft:false, prerelease:true, immutable:true. A private publisher draft receipt is a separate phase and is never Core admission. TUI uses the producer's closed schema2 final-state manifest. CLI uses the closed development-candidate manifest (eight declared assets, nine checksum entries, ten published files): portable archive/record plus three native archives and three provenance sidecars, development-candidate.json and SHA256SUMS.txt. Core retains and verifies every native archive, provenance, embedded context and no-Node acceptance tuple against the same identity and bytes without extracting, launching, registering or supervising external tools. Complete finite inventory, canonical URLs, digest checks and credential isolation remain mandatory.

Existing mutable TUI/CLI pins are historical distribution records, never eligible protected candidates. This source repair changes no pin or future digest. A separately reviewed pins-only followup requires actual qualified immutable publication and public same-byte readback. Current CLI producer native archives remain TAR on all three targets; the former CLI inner-ZIP assertion is explicitly retired by #1628; Core staged-service and outer Windows ZIP obligations remain. Direct full native/operator/three-OS qualification, complete programme acceptance and publication are distinct gates. Regression source is UNEXECUTED pending separate ENTIRE source GO and NEW ROOT complete-input admission; no source fixture establishes publication or qualification.

### Issue #1602 historical migration boundary

Normal distribution preserves only the two original source-owned exact historical tuples (repository, tag, full commit, platform/version and all pinned digests). Their public metadata must still be explicit immutable:false, draft:false and prerelease:true; every retained byte is reverified. No caller flag, changed tuple or generic mutable admission exists. The operator-tools v2 manifest records historical-mutable separately from protected-immutable. Historical bytes cannot satisfy protected operator-tool qualification: requireProtected verification rejects historical receipts. This avoids a Core/CLI bootstrap dependency cycle while real three-OS qualification and protected publication remain pending. The strict new path requires actual immutable public metadata, TUIv2 and the complete CLI10/9 contract. Native verification binds the reviewed current producer tool versions/SEA shape as well as provenance, executable/helper bytes, dispatch context and no-Node acceptance identity. Future producer changes require another reviewed contract change.

## Issue #1602 entire-review F1/F2 repair contract

AC-4CG.2 / AC-7F / AC-7G distinguish observational producer-shaped byte consistency from protected eligibility. The actual requireProtected/assertProtectedOperatorTools gate must match independently source-owned approved exact tuple/inventory identities for BOTH tools, in addition to receipt kind and all retained-byte checks. The approved protected catalog is EMPTY until real qualified immutable publication and identical public-byte readback are supplied in a separately reviewed pins-only source change. No caller, environment, configuration, retained bundle, test fixture or generated future tuple can admit itself. Preserve the two exact historical catalogs for normal distribution only; historical or wholly coherent invented nonhistorical bundles must fail actual protected qualification. A separately named retained-byte validation entrypoint supports observational fixture contracts and confers no approved publication authority. Regression source includes full coherent substituted payload/provenance/context/acceptance/manifests/checksums/pins, normal byte consistency, actual gate denial, arbitrary valid nonhistorical identity, and historical/empty-authority denial.

Core independently reads the exact fixed-repository git/ref/tags/<tag> and resolves only typed full-SHA commit/tag objects. Annotated tags require returned-object SHA equality, cycle detection and at most sixteen tag dereferences before the exact expected full source commit. Missing/malformed/wrong ref, invalid type/SHA, wrong annotated-object identity, cycles, excessive depth and wrong resolved commit fail closed even with correct release target_commitish. Lightweight and bounded annotated producer positives remain supported. Credentials apply only to fixed GitHub metadata reads with redirects denied; public release assets and all permitted redirects stay headerless. Existing immutable/draft/prerelease/full source/inventory/digest/TUIv2/CLI10-9-8/native/privacy/path/budget checks and all incoming #1603 observations are preserved. All source fixtures remain UNEXECUTED until a DIFFERENT fresh ENTIRE source GO and NEW complete-input ROOT admission. No publication/native/GA or programme completion follows.

### AC-7F/AC-7G/AC-7H — durable scoped evidence migration (#1619)
The active [SPEC-008 R1-R7](SPEC-008-two-os-release-evidence.md) and [ADR-001](../decisions/ADR-001-two-os-release-evidence.md) govern the prospective Windows/Linux producer-to-published-qualification route. Exact source-owned policy, closed schema migrations, all-and-only native jobs, inventories, immutable publisher/public readback, empty-catalog denial, same-byte Core/npm and legacy dispatch remain one coherent contract. Issue #1628 selects CLI protected2/portable2 native TAR and explicitly retires the misplaced CLI inner-ZIP blocker; Core staged-service/outer Windows ZIP proof remains required. This source-only durable decision is awaiting distinct entire review; original executable gates, native/input/custody blockers, deadlines and failed evidence remain unchanged until reviewed implementation and admitted direct proof.

### Issue #1636: bounded fixed Windows npm argv authority

AC-7G.windows-npm-argv: Release/publish and Windows newcomer npm calls execute process.execPath with the fixed installation-relative node_modules/npm/bin/npm-cli.js and unchanged argument elements. No ComSpec, npm_execpath, PATH, alternate layout or shell fallback selects Windows command authority. Non-Windows behavior remains compatible. runCommand enforces shell:false and windowsVerbatimArguments:false after options while preserving ordinary options, original error identity, output through close/EOF, lifecycle observations and stage-lock release precedence. Generated installed consumers emit the shared fixed descriptor as JSON data, bind their runtime to the generating process.execPath on Windows, and pass archives as data argv. npm intentional lifecycle/configuration scripts retain npm semantics; no shell-free descendant guarantee.

Consolidate the complete 13-path PR #1624 resource observation contract at afc841cf0d6520a076e55ed501dceccc9fd0a003 onto current develop via this distinct issue branch. Retained #1624 ownership and all original assertions/failures remain preserved; parent reconciles its lifecycle after reviewed landing. Core #1626 owns a separate release-artifact writer; integration occurs through develop PRs.

Prepare exact receiving-child argv witnesses (spaces, &, parentheses, %, !, caret, quote, Unicode, trailing slash/backslash) and actual npm pack/install/view plus generated-consumer installed archive identity in Windows-legal roots. Preserve deadlines, expected bytes/version/inventory, cleanup and privacy. No local import/parser/compiler/build/Node/npm/test/native execution until a different ENTIRE cumulative source GO and NEW complete-input admission of Node plus complete fixed npm installed subtree provenance/metadata/owners/reparse ancestry/digests. Natural push CI may be read only; no rerun/dispatch/cancel/control weakening.

Explicit deferred follow-up #1636: scripts/verify-mcp-packaged.mjs retains environment-selected npm authority; scripts/prepare-published-package-qualification.mjs retains its duplicate cmd wrapper. Separate reviewed scope/admission must preserve MCP timeoutMs300000. These surfaces are not fixed by this bundle; no repository-wide repair claim. Existing mcp-product-acceptance runner semantics change only by the preserved PR #1624 observation contract, not by npm routing.

### PR #1637 R1: protected staging fixture import closure

Development source-only correction under issue #1636 / AC-7G.windows-npm-argv, continuing the retained clean c675b741 PR head with sole author custody. The actual importFixtureStagers caller must retain the exact shared scripts/npm-command-lib.mjs dependency for BOTH relocated release-artifact-lib.mjs and publish-package-lib.mjs, using the existing canonical file-URL rewiring pattern. Preserve all three actual stagers, fixed metadata identities, restricted token consumption, headerless asset assertions, original deadlines and all cumulative resource/options/Error identity contracts. The shared helper remains real source; no stub, duplicate implementation, skip or bypass.

This repairs the independent ENTIRE review R1 source finding only. No imports/parser/Node/npm/compiler/build/test/native/manual product invocation is authorized. Freeze and immediately push the coherent correction; a different fresh ENTIRE cumulative source review and NEW exact-source complete-input ROOT admission precede execution. Original failed reviews, source/raw/physical input bundles and deferred npm wrapper proposals remain preserved. No deferred wrapper edit, provider controls, rerun, merge, publication or main access.
### Issue #1650: reviewed deferred Windows npm routes

Development source preparation for SPEC-007 AC-7G.windows-npm-argv and SPEC-006 AC-6G, linked #1636/#1562 after PR #1637 landed at fdaf1b12687cdce8878cca85d398029fd6535557. The approved whole two-surface blueprint closes only the earlier verifier/preparer deferrals in source: Windows verifier selects getNpmCommand's fixed process.execPath sibling npm-cli.js before any ambient SERVICE_LASSO_NPM_ENTRYPOINT/npm_execpath evaluation; non-Windows configured/layout routing remains exact. Keep the explicit outer AsyncFunction npmEntrypoint diagnostic fixture seam.

Published preparation routes getNpmCommand through its original local Promise runner, with shell:false/windowsVerbatimArguments:false after options. Preserve original synchronous/asynchronous Error identity, output through close, nonzero message, cwd/env/stdio/windowsHide/signal/timeout/killSignal, exact integrity-bound tarball and first failure/one pre-mutation retry. Source harness imports never replace or rebuild published Core bytes. MCP300000ms, original native15s/product/published gates, eight cleanup attempts/delays/privacy and all protected assertions remain unchanged.

Prepare receiving argv, Windows-legal root/hostile child-only environment, real exact npm fixture install through both original launch seams, options/errors/close/nonzero, non-Windows routing and first-failure/no-third-attempt regressions. SOURCE UNEXECUTED: different fresh ENTIRE cumulative source review and NEW complete-input ROOT admission precede imports/parser/compiler/build/tests/npm/native. No provider dispatch/settings/merge or release authority. Backlog status: in_progress source authoring; review/qualification remains open. Existing primary retained state and other worktree ownership remain preserved.
### `AC-7G.scoped-tar-parser` — #1562 scoped original archive compatibility

The public npm original-tool byte verifier and Core outer TAR preflight must use
`Parser`, the public parser class exported by the declared and locked tar 7.5.22
ESM package. Both readers must admit complete finite archives while retaining
strict parser errors, entry draining/end settlement, original-buffer comparison,
member/path/link/inventory limits, compressed/expanded budgets and publication
readback. No extraction, tool import, lifecycle or native execution is permitted
by npm byte verification. Dependency pins and existing protected evidence remain
unchanged. Additive source regressions exercise both actual readers with valid
finite archives and invalid/truncated/traversal/substitution input. Source tests
are UNEXECUTED until distinct whole-source review and new input admission;
source compatibility does not establish publication or native acceptance.

`AC-7G.scoped-tar-parser.R1/R2`: both actual readers reject every `ignoredEntry`
(including unsupported types and metadata exceeding tar's 1 MiB limit), retaining
the first error and draining entries. Before reader acceptance, the same held
expanded original buffer must pass shared finite framing: complete 512-byte
headers and rounded-up effective payload blocks, at most 100,000 physical
headers, safe nonnegative effective sizes within existing 256 MiB member and
512 MiB total expanded budgets, and two consecutive entirely zero 512-byte EOF
blocks. After the first EOF block only complete zero blocks are permitted;
missing EOF, a single zero block, partial headers/padding, or any nonzero byte
after EOF denies. This deliberately requires finite producer completeness rather
than permissive TAR-tool recovery; normal npm/Core producers terminate with zero
blocks. Payload padding remains opaque. GNU long-name/long-link and local/global
PAX metadata remain supported under the existing 1 MiB bound; framing uses tar's
public Header/Pax interpretation of effective sizes, applying pending metadata
only to ordinary members and consuming local metadata once. Pending local
metadata at EOF denies. Ordinary reader path/root/link/duplicate/inventory checks
still govern effective names, and strict parser errors remain mandatory. Additive
actual-reader positives include GNU/PAX names, local/global size overrides and
zero-block trailing padding; negatives include unknown types, oversized GNU
metadata, complete-payload missing EOF/partial header/single EOF/nonzero trailing
data and a member after EOF. Existing active-body truncation tests stay intact.
All new source remains UNEXECUTED until new distinct entire-source GO and exact
fresh complete execution-input ROOT admission; original native extraction and
publication authority are unchanged.

`AC-7G.scoped-tar-parser.R3/R4`: enforce the 1 MiB metadata bound against
each intermediary header's physical size before decoding or invoking either
actual reader. Pending local/global PAX size cannot reduce that physical bound.
The framing pass retains ordinary effective Header sizes, applying global then
local overrides and directory zero-size semantics. Both actual readers bind
each ordinary entry to that validated size and use it for member/expanded quotas
and observed body-length equality; mutable ReadEntry.size is not size authority.
Npm still compares the complete opaque original bytes. Retain all R1/R2 controls.
Additive actual-reader regressions cover pending local and global size before
oversized GNU/PAX metadata, conflicting local-over-global ordinary sizes, and
effective member-budget violations. They remain UNEXECUTED pending a different
fresh entire-source review and new complete execution-input admission.

`AC-7G.scoped-tar-parser.R4.fields`: retain ordinary authoritative type/path/
linkpath with size in the framing pass. Header controls type and effective size;
local GNU/PAX path and linkpath override the raw header. Global path/linkpath
are excluded from authority, matching locked Header's scoped interpretation;
global size remains applicable unless locally overridden. Both actual readers
bind emitted type/path to the ordered framing inventory. Core resolves only the
authoritative local-or-raw linkpath and requires zero authoritative link size,
then applies all existing path/root/traversal/alias/cycle/target checks. Pending
local fields are consumed once, globals persist, and later GNU/PAX local fields
replace earlier local fields. Add local-over-global legitimate links and unsafe
local/raw traversal/alias/size-interaction regressions. This is the conservative
scoped source contract; native metadata equivalence still requires qualified
execution and is not established by source review or these UNEXECUTED fixtures.

`AC-7G.scoped-tar-parser.R5/R6`: supersedes the Parser-dispatch requirement
and R4.fields acceptance of emitted target disagreement. Shared validated physical
framing drives the locked public Header/Pax/ReadEntry decoder directly, so pending
ordinary fields cannot control intermediary metadata consumption. Preserve every
strict Header validation predicate, unknown/ignored-entry denial, physical 1 MiB
metadata cap, effective size/body quotas, local-once/global-persistent semantics,
complete EOF and original opaque bodies. Neither translated extraction bytes nor
private Parser symbols are permitted. Core compares actual ReadEntry linkpath to
the validated local/raw linkpath and fails closed on every disagreement, including
unsafe or safe-but-different global aliases/cycles/dangling targets. Original
compressed extraction input remains unchanged; source agreement is not native
qualification. Add actual-reader positives for pending global zero and 1 MiB+1
before bounded local/GNU/PAX, pending local zero before bounded GNU/PAX and a
following size override. All additions remain SOURCE_UNRUN pending DIFFERENT
ENTIRE review and NEW complete execution-input ROOT admission.


Issue #1718 / SPEC-007 AC-7F, AC-7G: resolve the official proxy-addr 2.0.8 patch for GHSA-jqcg-44mw-7w3h without weakening audits, overrides, consumer ranges or protected qualification. Source-only until fresh whole review and parent execution admission; thirteen native/product gates remain unqualified.

### Issue #1718 / PR #1719 whole dependency audit correction

Development SOURCE ONLY, SPEC-007 AC-7F / AC-7G. Sole successor retains the existing clean 8b777581d81e4999e46a5a2ee0ad74f834515a40 issue branch fix/1718-proxy-addr-audit under a bounded GOV-10 recovery exception; base develop73b02a01904800713d1f3f34a3384ca872ab1518. Entire original review is NO_GO; preserve its immutable source and F1/F2/F3 report.

Acceptance unit now includes production proxy-addr2.0.8 plus all actual tooling findings from exact8b production PASS0/tooling FAIL36 before TAP: compression, joi, katex, postcss-selector-parser (all16 nested paths), source-map-js and both tinypool advisories. Read actual official advisories, complete registry metadata and patch sources; retain workspace replacements, compatible caller ranges/interfaces, SDK1.31.0, existing overrides and production low/tooling high audit policies. Never force audit downgrades, suppress findings, invent compatible versions or fabricate a resolved graph. If a coherent lock graph needs resolver execution, finish source-feasible corrections and record exact complete input/admission prerequisites before that execution.

F1 uses accepted ::/1 single/multiple native-IPv6 positives and IPv4/mapped negatives; retain explicit IPv4 and full-marker mapped positives. F2 binds SDK1.31.0 and original individual audit elapsed108ms/119ms. F3 distinguishes manifest/dist/exports npm packing and root-lock SBOM from the lock-bearing release archive npm-install graph. Published/current npm consumers require independent actual installed-byte qualification.

No Node/import/parser/npm/install/lock regeneration/audit/test/build/compiler/helper/native/ENV/ACL execution before DIFFERENT fresh ENTIRE cumulative review and NEW complete actual-input ROOT parent admission. Freeze the complete whole unit with original1132 members, prior NO_GO report, raw natural failures, all official metadata, whole base/current physical source and literal ROOTMF/REPORT readback. All thirteen native/product gates and unrelated owners remain unqualified and preserved. No merge/release/promotion/publication/deployment/cleanup authority.
#1718 AC-7F/AC-7G implementation selection before metadata editing: use official compression1.8.2, joi17.13.8, source-map-js1.2.2; globally resolve all16 selector copies to official7.1.6 with an explicit selector override; scope official KaTeX0.18.2 under mermaid and official Tinypool2.1.2 under @docusaurus/core. The last three are intentional caller-range crossings, supported by direct published caller/API inspection, not claimed upstream semver compatibility. No Docusaurus/Mermaid/ELK version change or local package relabeling. Existing dependency sets remain unchanged except compression's official added destroy1.2.0, already in the root graph; apply actual official dist metadata and Tinypool Node engine. Manually edited metadata is a SOURCE PROPOSAL, not an npm-generated/install-validated graph. Different entire review and NEW full ROOT admission must precede npm resolver/clean install, actual caller/adversary fixtures, complete docs/build/tests and consumer qualification; any normalization changes require a new freeze/review/admission.
Entire #1718 selected graph/caller evidence, F1-F3 corrections and exact remaining input/acceptance boundaries: [.governance/project/CORE1718_DEPENDENCY_AUDIT_REPAIR.md](../project/CORE1718_DEPENDENCY_AUDIT_REPAIR.md). Manual source proposal only; all execution/qualification remains UNRUN.

### #1718 actual documentation consumer qualification (2026-10-06)

Development SOURCE_ONLY additive follow-up from current named develop cae79b5e92d7ded41dda1f1c600ee9b53b7aaebc after PR #1719 landed. SPEC-007 AC-7F/AC-7G.docs-consumers binds the remaining direct docs boundaries: ordinary full current Docusaurus build; full current docs pooled SSG with only future.faster.ssgWorkerThreads and its required removeLegacyPostBuildHeadAttribute flag enabled in a private qualification copy; actual default theme Mermaid native MathML, forced legacy HTML/CSS math and registered ELK rendered in Chromium from built output. Inputs and build roots stay outside public docs source/publication. Preserve Node22, Docusaurus3.10.2, Mermaid11.17.2, ELK0.1.9, current manually authored lock and workspaces.

Acceptance requires actual worker task logs and full ordinary/pooled HTML route inventory parity, browser diagram/MathML/legacy computed CSS and loaded font semantics, and compiler module-to-emitted-asset plus browser-response digest binding to selected official installed KaTeX/Mermaid/ELK sources. Invalid Mermaid must produce the default error boundary rather than a false success. Mere imports/version checks, Tinypool-shaped surrogates and source push are insufficient. A separate naturally triggered docs-consumer CI job may produce isolated evidence; it does not substitute for unchanged full release/native gates or the retained thirteen failures. No local target execution before complete input freeze, DIFFERENT entire SOURCE_GO and parent admission. Preserve original whole source, reviews and terminal CI evidence. Sole author owns the new fix/1718-docs-consumer-qualification checkout; old owner checkouts and primary inherited state remain retained. Review and evidence are pending.

### #1718 / PR #1722 first actual docs failure and topology correction

Original source90de5322a012e20b11ab9c2d2c11022ac43ced68 / tree ed2e2c51b56ed8229dcde9dba3c7510c707d7e0d remains immutable. Natural run37420183923 attempt1/job112127568885 executes only the ordinary private Docusaurus build, started05:46:57.795Z ended05:48:18.247Z exit1: unchanged host-runner-service-owner-package ../../scripts/host-runner-service/contract-v1.json target is missing from the private docs-only topology. Preserve original fatal log449-483, prior image-size-safe warnings430/438 and full first actual receipt/artifact; pooled SSG, route parity and every browser case are NOT_REACHED. Separate ordinary Docs success is not consumer qualification.

Before correction, whole-source-checkpoint-root-v1 SOURCE_CHECKPOINT90_NOT_FINAL_KNOWN_UNIT ROOTe029db2617b30d35852c7341ac486e01f92596d3258f4d061b0ec425ce19acb3 preserves complete90base/head/physical/rawGit, all original6137/review8/final32/CI494 bindings and884 first failed consumer originals/artifact members. Parent selects a materially new source-topology repair: copy ENTIRE tracked regular physical source tree into private ordinary/pooled roots; preserve repository-relative artifacts, original docs/link policy/loader and all consumer checks. Reject missing paths, symlinks/reparse ancestry, nonregular tracked entries, dirty source or head/source drift; copy no untracked, ignored, retained or generated runtime state. Source-owned tracked templates/assets remain actual source inputs. No public docs edits, link suppression, fixture stubs, lock/dependency change, manual rerun or local target execution. Corrected source remains UNRUN locally until final complete input freeze, DIFFERENT entire review and parent admission. Existing thirteen native/product failures and all original protected policies stay preserved.

### #1718 / PR #1722 bbe original clean-source failure diagnostic

Source bbe18b56955e37f18b0b5fc1dd3712ab4489a165 / tree da376278be2555773a851f459b7ab0d68e8c5f30 is preserved in whole-source-checkpoint-root-v1 SOURCE_CHECKPOINT_BBE_NOT_FINAL_KNOWN_UNIT ROOT1f6ceb59aa5f492fc1115da87acff092c8d2fe27d3b18dfe99c3848c8ef9d71a,19884 members. It includes complete current/base physical/raw source, prior13028 checkpoint, sealed original90CI1370 and original firstbbe job/artifact11392918152. Actual PRmerge checkout a202012291f469d82783763fd2bf3067c0fe6fbc tree equals bbe; natural run37421112764/job112130446203 exits1 in unchanged clean guard, raw status LENGTH24 (24 !==0), commands=[], ordinary/pool/browser NOT_REACHED. Exact dirt path/cause is UNKNOWN because original raw Gitstatus bytes were not captured; do not infer them. Separate current DocsSite pass and exactbbe native failures do not qualify this consumer unit.

Parent selects narrowly additive source diagnostics before the same clean assertion: preserve actual raw status/index/head/tree, raw tracked diff (no external/text conversion driver) and hashes/metadata of changed tracked regular physical files only in private ignored evidence. Never copy arbitrary untracked/private contents, delete/reset dirt, weaken the guard or accept dirty source. This provides materially new original cause evidence on a natural new-head attempt; no manual retry or local target execution. Whole source unit remains active until authentic cause is disposed and coherent input frozen/reviewed/admitted; every old failure/checkpoint is immutable.


### #1718 / PR #1722 original efe diagnostic and executable CLI source mode

Natural run37421698878 attempt1/artifact11393625534 at PRmerge34546d3dc0a6b674b2a516b34bd7325c8c29c6b6/tree4c309174f18d163f7cbe5ba0edbc869e988090fa records raw status exactly ` M packages/core/cli.js\0` (24 bytes) and ONLY mode100644 to100755 in the raw tracked diff. Receipt commands=[]; ordinary/pooled/browser NOT_REACHED. Original bbe cause remains UNKNOWN; this new observation does not rewrite history. Literal original packet is D:/projects/service-lasso/service-lasso/_audit/natural1722-efe98-terminal-oct06-01. Immutable EFE source checkpoint ROOT3f7b17233e19ac722f8903b28b190c338f4699733bd191f7fc462ba822ebed7d binds25749 physical members with MF e171433e7eb6d3f1ebe00b3c48d210ffe6147e723dd04ea8c89fee33af043d0c and FULL db4bef2e89a234fd3dd0ec222d5cbec6921123e760107cf97ff24230f3193254.

Parent selects committing packages/core/cli.js executable100755, matching existing npm bin and shebang, with identical206-byte content/Git blobdc92912ba747f80f7fe13c80c24c69731e05c2ed. Intentional Git index mode only; no physical ACL/runtime execution, reset, ignored chmod or clean guard relaxation. Preserve complete old failed roots as FAILED_ROOT_BINDING and distinct verified raw-binding addendum ROOT28cd2738382f454b242a2e563a0af91756ef4b61ceb9faa053bfa51c54df1105; never normalize or overwrite originals. Whole cumulative source review and natural CI are distinct, all existing protected failures/policies unchanged.

### #1718 / PR #1722 ENTIRE browser outcome and custody repair (2026-10-06)

Development SOURCE ONLY, sole successor author on retained fix/1718-docs-consumer-qualification at clean4777b0c6dd69cf17f6042cbb51d916a17a0f77bf/treeb8cd0278dc6bff170cf33e40fe773350d351e146, named developbasecae79b5e92d7ded41dda1f1c600ee9b53b7aaebc. Bounded GOV-10 recovery preserves the same issue1718/PR1722 and open owner checkout. SPEC-007 AC-7F/AC-7G.docs-consumers binds all F1/F2/F3 as one coherent source unit before implementation.

F1: terminal valid-page result requires final actual observation drainage and page-error/request-failure/status/compiler-digest checks after DOM/screenshot capture and context settlement; invalid-Mermaid deliberate parse errors must be separately and precisely classified. F2: preserve the original primary assertion/operation failure, record every capture/cleanup error independently, and independently attempt context/browser/server settlement even when another close rejects. Scenario PASS is provisional until whole cleanup succeeds; capture or cleanup error fails the unit.

F3: authentic natural4777 run37422382726/artifact11393293439 failed browser digest after ordinary0/pooled0, actual workers1+2 and routes185/188. Native math x2+1 and ELK geometry were observed before failure; legacy/invalid are NOT_REACHED. Same JS URL assets/js/5e95c892.e0dfbb7d.js has two200 responses: expected7505cc6e60c36f7104e6f16cf7dc01f086c99a4edaccb36b77ff72cedd7641ea and empty e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855. Existing evidence lacks method/cache/transport cause: UNKNOWN. Add faithful private request/method/resource/header/original identity/body-length/cache transport observations and independent server request identity/read-byte hash/error observations before the unchanged digest failure. No empty-response exclusion, manufactured GET body, status200 authority, inferred cache cause or server-only browser identity. Protocol-specific acceptance requires actual new evidence and parent scope selection.

Preserve entire31581-member original source ROOT965a6577f26dfb6b7fa7327ebcbde7b29107c839d7544f846a617c93a56db823, ENTIRE SOURCE_NO_GO review ROOT5c14343cd1a2d057d9b4a91496c7c08e8101eafd44421ff859fdf2feca7c2bc0 and all original90/bbe/efe/4777 failures, malformed failed original roots and distinct raw-byte addendum9. CLI wrapper remains100755/same blob. Public docs/config/package/lock/release/private policies/deadlines/retries/concurrency/permissions remain unchanged. No local target import/parser/helper/browser/build/test/compiler/native/ENV/ACL execution before NEW complete-input ROOT, DIFFERENT entire SOURCE_GO and parent admission. Natural push CI is separate allowed evidence; no rerun/dispatch/cancel/settings/main/cleanup/merge/release. Author unit stays ACTIVE pending authentic cause disposition and fresh whole review; no acceptance claim.
### #1718 / PR #1722 faithful static response length after authentic05b8 diagnostics

Development SOURCE ONLY, same retained author unit at05b8d38303300ab3e21eb1472ab4bb3671d1ce86/tree1eed3857b30e40a2b6065f0aa41e5d1981d17469. DIFFERENT ENTIRE checkpoint review SOURCE_GO ROOT348d2379b55e542043dcccf8b64e8474908a79f875b74e68406be290e25f3cde binds instrumentation source only; no target admission or runtime qualification.

Authentic natural run37423603262/job112138198700/artifact11394280438 fails unchanged digest for assets/js/5e95c892.e25c9fe0.js: script GETrequest5 gives actual359/expected5bb760cc646b52218516d66f939a4d59eb0a2a306192517bb9c75b6c7c12fbf8; distinct OTHER GETrequest14 Sec-Purpose:prefetch gives observed0/emptye3b0 while responseBodySize371. Both original serverrequests5/14 saved359 correct, finished and writableFinished/status200/no errors; both original response headers are Transfer-Encoding:chunked and omit Content-Length. CDP disk/serviceworker/prefetch-cache flags are false. Underlying browser backend empty-body mechanism remains UNKNOWN. Native math/ELK are partial observations; legacy/invalid NOT_REACHED and whole consumer remains FAILED.

Parent selects exact Content-Length:bytes.length for the private200 static response's actual immutable readBuffer, preserving Content-Type/request-ID and all diagnostics; retain and assert declared/written length and read/saved/written digest agreement. Official Playwright1.63.0 Chromium createResponseBodyCallback source589..630 returns backend body immediately when expectedLength is absent. When expectedLength is positive and backend body empty, the stock method checks safeGET/static-or-Sec-Purpose-prefetch before its original Network.loadNetworkResource disableCache:false reader. Accurate server wire metadata permits that stock handling; this is source reasoning, not a claim that a new natural run will pass. No custom refetch, manufactured body, response filtering/skips, empty-hash exemption, cache/serviceworker/browser-policy change or server-only browser authority. All response/compiler hashes remain unchanged.

Preserve immutable36249 checkpoint, complete4777 terminal ROOT3f50e836ab8faa16639874f68ff69984bcd672f808b491572adbc324a6bdabbc/MF4544, full different05b8 review5 and actual05b8 receipt/browser/server/CDP/saved-body originals in the next cumulative actual-byte packet. Existing F1/F2 outcomes, original31581/review5/90/bbe/efe failed roots/addendum9, wrapper100755/sameblob and protected policies remain required. Commit/push immediately samePR1722; new natural CI and DIFFERENT entire final source review remain separate. No local target execution or changed deadlines/permissions. Author unit ACTIVE pending actual result and parent disposition.
### #1718 / PR #1722 actual extracted CSS compiler graph correction

Development SOURCE ONLY same ACTIVE author atfe1d62fe7138161c65e95ba91e55db114b10b209/tree7d927c8d379b76899f4cdf2db6e18fb533b6072b. Parent adopts entire SOURCE_NO_GO review ROOT27d4c8b2a753a91b7ee44c72aba6860ef3337a92a3bbb70b831b1c5b6849e453: actual selected katex.css normal modules have files[], so protected legacy selected-CSS assertion genuinely fails. Preserve authentic fe1d math/computed red2px/KaTeX_Math and actual compiler/browser stylesheet SHA agreement as supporting observations, never selected-source provenance or whole qualification. Invalid Mermaid NOT_REACHED.

SPEC-007 AC-7F/AC-7G.docs-consumers selects faithful compiler observation: retain normal physical source hashes and record original selected resource -> actual mini-css-extract-plugin CssDependency -> real CssModule -> actual chunk -> original rendered stylesheet asset/hash. Official mini-css-extract-plugin2.10.2 published archive integrity matches unchanged lock; bind its exact installed package/files and actual exported getCssDependency/getCssModule class identities for the compiler webpack instance. CssModule.nameForCondition supplies the original resource; moduleGraph.getModule(dependency), chunkGraph source-type membership and actual mini plugin renderManifest entries supply edges. Resolve the actual entry filename/pathOptions with webpack5.109.2 getPathWithInfo, the same compiler API used at actual emission, and require original chunk.files membership plus existing emitted asset bytes. No guessed output name, assigning all CSS, empty-files fallback or style-only proof. Original CSS source hashes, selected CSS/browser/font/hash assertions remain unchanged; extraction observations add truthful graph provenance only.

All prior F1/F2/wire repairs, original36249/49179 frozen packets, original fe1d NO_GO and natural failures, entire05b8/4777 terminal evidence, malformed original roots/raw addendum9 and thirteen native/product failures remain retained. Package/lock/publicdocs/browserpolicy/cache/refetch/deadlines/retries/concurrency/permissions unchanged. Every intentional commit immediately pushed SAME PR1722. No local target execution before NEW complete-input ROOT/DIFFERENT whole SOURCE_GO/parent admission; fresh whole review and natural new-head actual result remain required separately. Author ACTIVE; no acceptance/merge/release/publication/promotion/deployment claim.
The same CSS graph observer must retain actual original compilation.chunkAsset emission and final asset identity across stock webpack RealContentHashPlugin optimization. Official webpack5.109.2 renameAsset updates the actual chunk.files and final asset contenthash metadata without updating the original mini render-manifest template inputs. Bind original render entry -> actual chunkAsset emission -> final same-chunk asset whose real final contenthash resolves that original template through getPathWithInfo/TemplatedPathPlugin, retaining both original/final names and hashes. No compiler method wrapping, output rename/mutation, synthetic chunk or guessed/all-CSS association is permitted.
Before completing the CSS compiler-source proposal, bind ENTIRE genuine official webpack5.109.2 published archive inventory (including Compilation/ModuleGraph/ChunkGraph/RealContentHashPlugin/TemplatedPathPlugin and package/main/helper sources) to unchanged lock integrity/URL/version and actual installed file hashes before either build. This closes version-only compiler provenance; saved tag-source API reads are separately retained and do not replace npm installed-byte equality. No lock/package/resolver/library changes or local target execution.
## #1681 review28 coherent F15-F19 and reviewed #1726 receiving integration (2026-10-08)

SPEC-002 AC-4DI.4 / R3 / C3 and native C1-C3 / R1-R4; Development SOURCE ONLY / in_progress. Sole author29 accepts the clean pushed040b9e6853bacd8858219e24f6320adb1bfe2262/tree334fe7bb532550bd77d0115fd0c49710f57bd2f2 retained PR1681 recovery owner checkout; develop/basece56f59245821eefd2232cdec05e2cb42bd044e4. Parent adopted ENTIRE review28 SOURCE_NO_GO ROOT3f9e9083ec08d63c07698276cc17b2bb9e32dc846361d2c1995ba14ace65a152. Prior authors/reviewer stopped. This requirement amendment precedes product edits.

F15 rejects concrete setter-only AUTOMATIC properties before backing/value/initializer metadata. Correct only the invalid S positive to get/set; preserve every ownership/initializer assertion and earlier regression. Keep valid explicit-body and abstract/extern/interface bodyless setter-only forms. F16 implicit constructors have DECLARED public accessibility except abstract protected; enclosing effective accessibility remains separate. F17 reject namespace type members, generic enums and using directives after members in the actual compilation/namespace owner, preserving legitimate nested types/nongeneric enums in generic owners/initial using. F18 C# CR/LF/NEL/LS/PS terminate comments and forbid raw ordinary quoted-literal newlines; retain JS dialect rules and exact original ranges. Existing C# dollar rejection is not a new defect.

F19 preserves original failed effect/result and exception separately from unresolved child issuance/closure and retirement/release failures. Known original FALSE CreateProcess means no issued child; an interop throw or TRUE with missing/invalid child evidence retains SAME invocation. Genuinely observed WAIT_OBJECT0 plus failed exit query may return SAME original failure only after all required safe original releases succeed. Unknown/failed wait, pending I/O, failed/unknown retirement/release retains SAME owner without retry or success laundering. Original observations/errors and every independently safe cleanup survive. Production selected managed .cs, actual owning guard and native prospective cases are in scope; revised original14 source associations must record intentional deltas. All32 binary/provenance pins unchanged; no compilation/repin.

SPEC-007 AC-7G also maps receiving integration of exact independently reviewed PR1727/issue1726 head0b258e16bd86b2ae4f0fd13885e6565d6460af7d, entire review03 ROOTffeda489a5b4a7ea8cc1a999752d8530dea28bfbb6fc3f639d5692ae56cfdb7a. Merge only this named source contribution normally, retain BOTH append-only governance contributions and the entire1602 lock graph except the sole official shell-quote1.11 version/resolved/integrity tuple. package.json/observer/policy/thresholds unchanged. Full qualification13fails/87skip/Windows EBUSY8 remains failed; source GO is not compatibility/native acceptance.

ALL new regressions UNRUN. Complete cumulative source/native/foundation/dependency/base/caller/gate freeze, DIFFERENT ENTIRE review and NEW complete actual-input ROOT plus parent admission precede target effects. No Node/npm/import/parser/helper/compiler/test/build/native/XML/MSI/ENV/ACL/crypto/extractor effects, CI dispatch/rerun/cancel, provider settings, force/rebase/reset/cleanup or release/publication/deployment. Push every intentional commit immediately. Parent alone owns provider tracking/review/admission/landing. Original143/all14/183roles/35families/9callers/18providers/6catalogues/R1-R7/R6K2/W1-W4B4/K-BIND/CALL/SUBSTITUTE/OWNER/readableHCD/sixW4 adapters and historical failures remain required. Full profiles/symbolic CLR48/conditional modern closure/typedIRCFGproofDAG/SCC/caller migrations remain unfinished; Mac Deferred/N/A never PASS. SourceGO/execution/native/GA false.
### Issue #1726: patched shell-quote tooling resolution (AC-7G)

Required tooling audit must reject critical/high findings without threshold changes. Resolve every shell-quote copy outside GHSA-pqg4-j6r4-53mv's affected >=1.8.4,<1.11.0 interval using genuine official patched 1.11.0 metadata/archive identity, preserving the existing launch-editor ^1.8.4 parent range and unrelated packages. Review registry/lock/archive version, integrity, MIT license, node >= 0.4 engine and absent production dependencies. Acceptance requires exact-head natural production and tooling audit passes plus different ENTIRE cumulative source review; local Node/npm/install/import/test execution needs NEW exact-input admission. Retain original Release Qualification37608178814/job112748691970 failure. No product-runtime vulnerability exposure, full native acceptance, publication or GA claim follows from this lock repair.

## #1681 review32 complete F23-F25 repair (2026-10-08)

SPEC-002 AC-4DI.4 / R3 / C3 / G1, native C1-C3 / R1-R4 and SPEC-007 AC-7G; Development SOURCE ONLY / in_progress. Sole fresh author33 accepts clean pushed7b2b08083d38605e3ea13a30a31dd5a52435943a/treeee7129e5eb048f3a487c089a8bf64533246d0b35, develop/basece56f59245821eefd2232cdec05e2cb42bd044e4 at the retained PR1681 recovery branch/worktree. ENTIRE adopted review32 ROOTdf11017e64d643567d007e97e8afc4c728746b165cfd5f3d5b567ff125c1e6aa / REPORT5bec25fd6ced43824c02ff18a03ef4c15c6d538997790b7a8d205655aed83a2e is SOURCE_NO_GO. Prior author/reviewer STOPPED; parent owns tracking/admission/landing.

F23 denies void recursively in every storage/formal/array-element/nullable-underlying/generic-argument category, reached or unused, with original source span; only legitimate bare method/accessor/constructor returns survive. F24 validates the entire fixed-parameter list and single final one-dimensional CLR48 params array: no direction/default on params, no ref/out default, no required fixed parameter after an optional fixed parameter. Selected C# in-default behavior remains admitted; modern collection-params needs a separate complete selected profile. Preserve lexical declaration/formal order, spans and legal arrays/value-nullables/generic arguments.

F25 covers ALL original managed/acquisition/MSI/trust/PowerShell owners and reached recording/publication/allocation/observer/catch/finally helpers. Set primitive unresolved/failure state BEFORE fallible recording; ordinary diagnostic allocation/Add/observer failure never replaces original primary or exits SAME nonreturning live invocation. Reserve and publish MSI handle slots BEFORE native acquisition, bind authentic returned handles immediately and retain pending original call without finally releasing dependents. Prepare retention state BEFORE unresolved ownership; retention interruptions and callbacks remain guarded once-only, no retry or observer-derived proof. Gate MSI held/database closure on actual pending state. Managed ledger allocation failure retains its unissued resource while allowing every later independently safe once-only release; original wait status/pending/result, known-false CreateProcess failure and directory WAIT_OBJECT0/failed-query SAME123 with safe closure remain. PowerShell globally rooted references AND SAME active invocation remain mandatory; errors retain original Exception objects even diagnostic formatting fails. Native pre-HeapAlloc pending result/kind/site/ordinal and nonreturning allocation-failure barrier remain unchanged. No synthetic native observer or production fault injector.

Guard changes are explicitly requirement-bound protected evidence strengthening for the actual new transitive helper shapes; retain every original assertion/test body and add mutation/positive/native-prospective obligations, all locally UNRUN. Transparent intentional selected14 deltas (managed/acquisition/MSI/trust/compiler/guard) require fresh current raw-byte/source-version associations; never claim old identities remain current. Preserve32native pins/39936 declaration, full1602lockgraph/exact shell-quote1.11 tuple/receiving both-parent and five conflict contributions, all original failures and archives. Exact7b2b source/conformance/full2072suite FAIL and Windows CANCELLED retain UNPROVEN native closure/UNATTRIBUTED cause.

Full143/all14/183roles/35families/9callers/18providers/6catalogues/R1-R7/R6K2/W1-W4B4/K-BIND/CALL/SUBSTITUTE/OWNER/HCD/sixW4 remain required; this repair is not full profiles/symbolic CLR48/typedIRCFGproofDAG/sourceDeclOcc/SCC/caller migration/native/operator/publication/identical-byte delivery. Mac Deferred/N A never PASS; B0/B2UNKNOWN, SupportSafetyUNPROVED, G1LOCAL_MINIMUM/runtimeUNQUALIFIED. NEW complete actual-input ROOT + DIFFERENT ENTIRE SOURCEGO + parent admission precede ANY target Node/npm/import/parser/helper/compiler/build/test/native/XML/MSI/ENV/ACL/crypto/extractor effect. Generic own IO/JSON/ZIP/TAR/hashes/Git/provider reads only; natural push CI only, no dispatch/rerun/cancel/settings/main/force/rebase/reset/cleanup/signing bypass/deploy/GA. Push EVERY intentional commit immediately. Freeze complete cumulative packet then STOP for different reviewer34.
### Author33 complete F23-F25 authored disposition (2026-10-08; SOURCE_UNRUN)

The coherent source bundle implements recursive bare-void-only return categories, nonnullable value-type nullable underlyings and static-class constituent exclusion; exact nested generic closing spans and mixed nullable/array suffixes; whole CLR48 fixed/final-one-dimensional-params lists with legal in-default behavior. Modern collection params still require their separately selected complete profile. Original declarations and all inherited test bodies remain required.

Managed recording stores primitive failure state before allocation, retains original primary wait/result, and shields each independently safe once-only release and environment retirement from ledger allocation failure. MSI allocates and roots output slots before actual native acquisition, binds genuine original handle/result before collection publication, retains the SAME invocation on publication or unknown-call recording failure, and gates actual finally closure on original pending ownership. Extended-error field-list allocation is inside its original acquired-resource finally. Trust/MSI prepare retention state before native ownership; shared interruption recording cannot unwind retention. PowerShell shields catch, custody, copy observation and final result observers while preserving first primary exception, original registry roots and the nonreturning original invocation. No new production fault injector, API shim, global control authority or synthetic handle is supplied.

H-current now checks these actual managed and acquisition/MSI/trust owning statement trees, pre-effect slots, callback once/completed semantics, finally enclosure and original observers. A continue statement is retained as an explicit leaf for the original MSI summary owner's finite flow; unchanged exact managed role checks still reject any unassigned ownership flow. Supplementary PowerShell assertions are textual source witnesses, not a full PowerShell frontend or native acceptance. All additive source mutations, legal positives and separately observed original native recording/publication obligations are UNRUN. Genuine external original allocation/throw fixture remains absent.

Intentional selected14 deltas are L-managed/L-acquisition/L-msi/L-trust/H-current. Other nine selected inputs are unchanged; CE-compiler remains the original verify-windows-process-inspector.ps1. The actual verify-windows-managed-launcher-bootstrap.ps1 owner is a separate inherited additional input with an intentional F25 delta. This corrects author33's earlier six/eight association count without changing the original selected14 roster. The protected native pins/39936 declaration, original foundation75 bodies, three F21/F22 guard bodies, both F19 settlement bodies and MCP protected acceptance remain preserved. Frozen raw cumulative/current/base/inherited/physical/index/associations/dependency/history custody and a DIFFERENT ENTIRE review plus NEW complete-input ROOT and parent admission remain prerequisites. This author does not grant SOURCE_GO, execution, native closure, publication, promotion or GA; the complete original delivery programme remains unfinished.

## #1681 ENTIRE review35 successor contract (2026-10-08; author36)

SPEC-002 AC-4DI.4/R3/C3/G1, native C1-C3/R1-R4 and SPEC-007 AC-7G remain one cumulative source unit. ENTIRE review35 SOURCE_NO_GO ROOT7746835dda55968f9f8ea767f750bf3e1b8c6dd5f1d257ae8c473d5de48f3812, REPORT8c104b3ff0d7cff4cb2a73ca09d17a6d219c5131eb717b9edc0d0535d7bd224d is preserved. Author36 explicitly recovers the same retained PR1681 branch from clean pushedfc25f2bcb40bea58ccdbae3bcd81adbb96368105; author33 is STOPPED. No main input or branch rename is permitted. The generic historical clean-clone main reference in SPEC-002 Tests and Evidence is release-consumer documentation only; development follows the explicit develop-only AGENTS/GIT_WORKFLOW boundary.

F26 requires primitive known-FALSE/no-child/error/mapped-result settlement BEFORE fallible diagnostic construction at every managed creation path and directory sync122; an actually failed exit query settles123 BEFORE diagnostic construction and a later exception cannot overwrite it with121. Genuine interop throws, TRUE-invalid child and unknown issuance retain SAME original owners. F27 keeps Before prerequisites authoritative: their failure denies the original call. After actual successful MsiViewClose or MsiCloseHandle, settle success before diagnostics and protect subsequent independently safe original view/database releases from diagnostic allocation/Add/observer failures. Preserve primary failures, failclosed retention for genuinely failed/unknown close, strong owners and once-only no retry.

Actual owning source checks must reject the old order and preserve legal structural variants. Add original-native prospective known-result/secondary-failure positive and negative obligations; no synthetic native provider, production fault injector, or observed OOM claim. All target execution remains UNRUN and prohibited until NEW complete actual-input ROOT, DIFFERENT ENTIRE SOURCE_GO and parent admission. Natural push CI is separate evidence; push every intentional commit immediately.

Full143/all14/183roles/35families/9callers/18providers/6catalogues/R1-R7/R6K2/W1-W4B4/K-BIND/CALL/SUBSTITUTE/OWNER/HCD/sixW4/fullCLR48/typedIR/CFG/proofDAG/SCC/source occurrences/caller migrations remain required unfinished source delivery. Symbolic authoring inside the adopted architecture is allowed despite native provider gaps. F26/F27 repairs and lexical guards do not implement that programme. Preserve native C pending-before-HeapAlloc SAME-owner retention, all32 pins/39936 declaration, all75 original foundation bodies/raw68778 prefix/six protected files, full1602 lock except admitted shell-quote tuple, five receiving contributions and every original source91/product2081-14fail87skip/cancelled-Windows/bounded-Linux-MCP failure. Mac Deferred/N/A never PASS; Node B0/B2UNKNOWN/Q32 qualification-only; full CLI/TUI/template/native publication identical-byte integration remains unfinished. Parent owns tracking/review/admission/landing. Author freezes complete cumulative packet and STOPs for a fresh DIFFERENT entire reviewer37; no GA/promotion/publication/deployment/settings/cleanup/force/rebase/reset/rerun/dispatch/cancel/signing bypass authority.

## #1681 full compiler, proof and caller source programme (2026-10-08; author38)

Active Development source implementation maps to SPEC-002 AC-4DI.4/R3/C3/G1 and SPEC-007 AC-7G. Recover clean retained PR1681 HEAD3abf583d4cf1688df0b90f07f984ade9bd225fb5/tree926a55be4ff5f0c2311c32a45c795d0dbbbf2cb6 against developce56f59245821eefd2232cdec05e2cb42bd044e4. ENTIRE reviewer37 SOURCE_NO_GO ROOT8db05809d7e2bc0be0e011673234bd0b126d03719658cd119444a5d2dc202258 remains operative. This active unit must implement the full missing symbolic source programme: selected typed expression/statement lowering and exact overload/evaluation order; ref/out/location/alias/owner/frame and initializer/import/capture/enumeration/finally effects; complete CFG and independently checked proof DAG/SCC prefix/source occurrence origins/K2; complete selected symbolic profiles/catalogues; all nine original caller migrations. Foundation null IR/CFG/proofDAG and false completeness flags cannot be relabelled as delivery, and missing native actors do not block symbolic authoring.

Acceptance requires all143 original scope, all14 inputs/183roles/35families/9callers/18providers/6catalogues, managed65/acquisition55/projection2/OPCVSIX32/nativecompiler29, R1-R7/R6K2/W1-W4B4/K-BIND/CALL/SUBSTITUTE/OWNER, readable H/CD and six W4 adapters. Exact selected declaration metadata and conditional modern VSIX remain required. Protected production catalogues stay failclosed pending genuine approved producer identity; symbolic contracts never assert native authenticity. Connected release runCommand uses one absolute deadline, bounded output and original owned closure; staged verifier kills and awaits definitive closure before workspace removal. Supervisor unknown containment retains original launch/resource state until positive safe closure; lossy registry empty fallback is never proof of ownership absence. Every caller consumes the same actual compiler/proof contract.

Preserve F26 known primitive native outcomes before diagnostics, F27 once-close diagnostic shielding, C2/F25 native pending original before HeapAlloc with SAME permanent retention, OVERLAPPED/capture/CLR/BCrypt/primary/owner safety; all75 original foundation bodies/raw68778 prefix/six protected files, native32 pins/39936 declaration, full1602 lock except admitted shell-quote tuple, five receiving contributions/both ancestry parents and every original failure. Managed provenance remains FAILED: declared2f79fdb9652d3aa2fb3a8de5169d889cf0943b6baf76bdf4329ceff7925d065b versus current4a6a2fc2aa67de995d0ccc7379349d1837ee0e10b53fbf8aae631b8c407eb252; no metadata repin or local rebuild. Natural3abf run37663198005 FAILED: source91/89pass1fail1skip; product2084/1983pass14fail87skip; Windows112935669408 cancelled by confirmed45-minute provider cap, underlying ConPTY stall UNPROVEN; consumer/upload/readback skipped; aggregate112956173089 FAILED. Linux bounded MCP alone never qualifies the programme.

No target Node/npm/Go/Python/import/parser/gofmt/compiler/build/test/helper/native/XML/MSI/ENV/ACL/productcrypto/extractor execution before NEW complete actual-input ROOT, DIFFERENT ENTIRE SOURCE_GO and parent admission. Generic raw IO/JSON/ZIP/hash/Git/provider read-only permitted; immediately push every intentional source commit on retained branch, natural CI only. No main/branch rename/reset/rebase/force/cleanup/provider controls/rerun/dispatch/cancel/settings/signing bypass/GA/publication/promotion/deployment. Parent alone tracks/adopts/admits/lands. G1 LOCAL_MINIMUM, SupportSafety UNPROVED, runtime UNQUALIFIED, Node B0/B2 UNKNOWN/Q32 qualification-only and Mac human Deferred/N/A remain truthful. CLI/TUI/template/native/protected publication separate owners remain pending. After genuinely complete source unit freeze complete cumulative/base/inherited/current/physical/index/REUC/receiving/source/dependency/native/protected/failed evidence with REPORT/COVERAGE/ROOT/MANIFEST/actual readback; STOP for fresh independent ENTIRE reviewer39. No old GO transfers.
