# Spec Template

Use this file to document a feature or change spec for the application.

## Intent
Define the bootstrap/setup contract for this repository while product intent is still too vague for a trustworthy feature-first spec. This matters because Service Lasso should not begin product implementation from guessed scope inferred from the repository name alone.

## Scope
Included in this spec:
- normalize governance artifacts to the live VibeGov bootstrap contract
- establish strict Git workflow bootstrap artifacts required before implementation
- record GitHub preflight outcomes and canonical board state
- create durable local bootstrap run artifacts that reconcile starting and final state

Explicitly out of scope for this spec:
- product code
- feature behavior or domain-model commitments
- external system integrations
- implementation planning beyond bootstrap/adoption workflow

## Acceptance Criteria
- `AC-1`: Project intent is explicit about being provisional and does not invent unvalidated product scope.
- `AC-2`: Strict Git workflow artifacts exist: `AGENTS.md`, `INIT-TODO.md`, `.github/pull_request_template.md`, `.github/branch-protection-checklist.md`, and a documented default issue-pickup flow.
- `AC-3`: For this GitHub-hosted repo, preflight outcomes are reported using explicit outcome states and one canonical project board target is adopted, created, or normalized with required fields and repo-link status.
- `AC-4`: Current bootstrap status, analysis, feedback, and blocker artifacts are written under `.governance/project/bootstrap/`, with a grouped timestamped historical run bundle under `.governance/project/bootstrap/history/`; blockers state exact remediation if the contract cannot be fully satisfied.
- `AC-5`: The backlog maps directly to this spec's scope and acceptance criteria, preserving traceability into future adoption or feature work.
- `AC-6`: The active indexed published rule set is reconciled through `GOV-14`, with Service Lasso's release-authority overlay retained and ordered after the canonical rules.
- `AC-7`: Continuity layers, checkpoint triggers, session-diary guidance, promotion flow, and the default issue-pickup flow are discoverable in repository artifacts.

## Tests and Evidence
Bootstrap evidence required for this spec:
- VibeGov rules `GOV-01` through `GOV-14` are present in `.governance/rules/`; the Service Lasso release-authority overlay is retained separately.
- `PROJECT_INTENT.md` reflects provisional intent rather than guessed product scope.
- required Git workflow artifacts exist in the repo
- GitHub preflight and board state are captured in current and timestamped historical artifacts
- backlog items reference this spec and its acceptance criteria

Implementation evidence required later:
- a follow-on feature spec that replaces bootstrap-only scope with validated product intent
- traceable issue/task updates when bootstrap work transitions into implementation planning

## Documentation Impact
- `AGENTS.md`
- `INIT-TODO.md`
- `.github/pull_request_template.md`
- `.github/branch-protection-checklist.md`
- `.governance/project/PROJECT_INTENT.md`
- `.governance/project/BACKLOG.md`
- `.governance/project/CONTINUITY.md`
- `.governance/project/bootstrap/*`

## Verification
Verify this spec by reconciling local artifacts with the final live git/GitHub state at the end of the run: the full rule set and overlay are present, workflow and continuity artifacts are present, starting repo state and commit policy are recorded, GitHub preflight outcomes are classified, canonical board state is reported without fabricating unsupported configuration, and current plus timestamped historical report bundles are written locally.

## Change Notes
- This `SPEC-001` intentionally covers bootstrap/setup instead of product behavior because the repo currently lacks a validated product brief.
- A prior bootstrap pass inferred product direction from the repository name; update mode replaces that assumption with a provisional governance/setup spec.
- The next non-bootstrap governed change should create a feature spec only after stakeholder intent is explicit enough to trust.
