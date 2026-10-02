---
sidebar_position: 3
---

# Bootstrap Update

`bootstrap update` is **bootstrap run in `update` mode**.

Shorthand ref:
- `BU` = bootstrap update

It does **not** use a weaker or different contract.
Use the canonical bootstrap contract at [Bootstrap](/docs/bootstrap).

When update work hits GitHub preflight/board questions or missing prerequisite capture, use these support docs directly:
- [GitHub Project Bootstrap](/docs/github-project-bootstrap)
- [INIT-TODO.md](/docs/init-todo)

## Update behavior

- preserve valid existing artifacts
- repair stale, missing, contradictory, or weak artifacts
- repair missing **operational** bootstrap artifacts too, not just scaffold gaps
- keep the same pass gate as `init`
- create/update `INIT-TODO.md` early and record any missing prerequisite with exact remediation
- if the repo still fails the contract, report exact blockers/gaps instead of claiming partial completion
- do not leave the repo in ambiguous drift: classify the end state as committed/pushed, pending-review, or blocked
- emit explicit current-reporting and historical-run artifacts instead of relying only on chat output
- when update cannot complete all gaps, emit explicit blocker artifacts too
- if a private-repo hosted-feature limit prevents live branch-protection verification but the rest of bootstrap normalization succeeds, report it as degraded verification/warning with exact evidence and next action rather than treating the whole run as a hard blocker
- do not leave valid bootstrap reporting outputs in an ambiguous flat layout when the structured reporting layout can be normalized during the run

## Update prompt

```text
Run VibeGov bootstrap in mode: update.

Before doing anything else, fresh-read the latest live canonical bootstrap sources:
- https://vibegov.io/agent.txt
- https://vibegov.io/bootstrap.json
- https://vibegov.io/docs/bootstrap/

Treat those live sources as authoritative for this run.
Do not rely on previously cached bootstrap text, earlier chat summaries, or older copied instructions if they differ.

Use the canonical bootstrap contract.
Do not restart from scratch when valid artifacts already exist.
Repair or normalize the repo until the same bootstrap contract is satisfied, including missing operational bootstrap artifacts, or report exact blockers.
Do not stop in an ambiguous local end state; classify the result as committed/pushed, pending-review, or blocked.
Write explicit current-reporting artifacts under `.governance/project/bootstrap/` and a historical run bundle under `.governance/project/bootstrap/history/<timestamp>/` for the run.
If update cannot complete all gaps, write explicit blocker artifacts describing what remains and the exact next actions.
If a known private-repo hosted-feature limit blocks branch-protection verification, record that as a warning/degraded verification note with exact evidence and next action.
```

## Reporting settlement

BU should make bootstrap reporting easier to read, not harder to interpret.

Preferred shape:
- `.governance/project/bootstrap/` = current settled reporting surface
- `.governance/project/bootstrap/history/<timestamp>/` = the historical run bundle for this pass

When migrating a repo that still uses the older flat bootstrap layout, BU should normalize reporting into the structured layout instead of extending the old pattern.

## Related docs

- [Bootstrap](/docs/bootstrap)
- [Bootstrap Review](/docs/bootstrap-review)
- [GitHub Project Bootstrap](/docs/github-project-bootstrap)
- [INIT-TODO.md](/docs/init-todo)
- [Quick Start](/docs/quickstart)
