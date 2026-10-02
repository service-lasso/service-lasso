# Bootstrap Feedback

## Upstream feedback

The live canonical sources disagree about the active rule count. `agent.txt` and `bootstrap.json` (version `1.1`) enumerate `GOV-01` through `GOV-09`; `docs/bootstrap` requires `GOV-01` through `GOV-13`; and canonical `gov-01-instructions.mdc` indexes `GOV-14`. This repository installed the full indexed rule set. Upstream should align the machine-readable sources, Bootstrap page, and rule index so automated bootstrap clients cannot silently stop at GOV-09 or leave GOV-14 dangling.

## Repository feedback

The prior bootstrap reports were flat pointers plus separate timestamped files. The current `bootstrap/` and `bootstrap/history/<timestamp>/` layout now supplies a clear current state and a complete historical bundle without deleting existing evidence.

The repository's release-authority rule is valid project-specific strengthening. It must remain a distinct overlay because canonical GOV-09 now owns continuity behavior.

## Safe follow-up

Project #1 should receive a deliberate administrator review of its default table view and of its extra Project Priority `P5` option. Do not use a destructive bootstrap script that replaces field options or resets assignments.
