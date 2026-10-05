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
