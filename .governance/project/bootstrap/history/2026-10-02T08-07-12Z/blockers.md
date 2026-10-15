# Bootstrap repair blockers and provider follow-up

All blocking provider gaps are retained in [#1588](https://github.com/service-lasso/service-lasso/issues/1588). No provider settings changed. Read times/digests are in [readback index](readback/INDEX.json); source values are retained independently of current reports.

## Priority and default view: blocked-with-tracked-issue

Priority SINGLE_SELECT options are empty; administrator must configure Urgent, High, Medium, Low and retain before/after readback. Default View 1 is TABLE_LAYOUT with Title, Status, Labels, Repository, Project Priority, Priority, Order. Administrator must set Title, Assignees, Status, Project Priority, Order, Priority, Repository in that order and retain final view-field readback. Preserve existing items/assignments. These gaps block full bootstrap.

## Develop protection: blocked-with-tracked-issue

[Classic protection](readback/develop-protection.json), [effective rules](readback/develop-effective-rules.json) and [active ruleset](readback/develop-ruleset.json) jointly show:

| Expectation | Actual readback | Disposition |
| --- | --- | --- |
| Require PR before merge | classic PR review object; active pull_request rule | enabled |
| At least one approving review | required_approving_review_count 0 in both | gap: #1588 |
| Dismiss stale approvals | dismiss_stale_reviews false; ruleset dismiss_stale_reviews_on_push false | gap: #1588 |
| Required status checks where CI exists | classic required_status_checks absent (null/unconfigured); no required_status_checks effective rule | gap: #1588 |
| CODEOWNERS review | require_code_owner_reviews/require_code_owner_review false | project authority gap: #1588 |
| Last-push approval | require_last_push_approval false in both | project policy follow-up gap: #1588 |
| Conversation resolution | classic required_conversation_resolution enabled true; ruleset review-thread resolution false | classic control enabled; do not relabel disabled |
| Restrict force push/deletion | classic allow_force_pushes false, allow_deletions false; effective non_fast_forward/deletion rules | enabled |
| Administrator enforcement | classic enforce_admins enabled true; active ruleset bypass_actors empty | enabled |
| Linear history | classic required_linear_history enabled true; effective required_linear_history rule | enabled |
| Direct push restrictions | no classic restrictions object and no effective update rule; PR control exists | dedicated actor restriction not independently established; administrator must decide and record effective selected policy in #1588 |
| Direction/history/exception/process-custody checklist items | local workflow/checklist artifacts retained; no hosted exact-head result claimed | parent must refresh exact-head branch-policy and required CI before merge |
| Promotion branch requirements | not inspected under development boundary | no proof/claim; authorized promotion role owns any follow-up |

Other exact classic values retained: signatures disabled, block_creations false, lock_branch false, allow_fork_syncing false. Ruleset 21891323 is active for refs/heads/develop with no bypass actors; its rules have no extra approval for unattributed changes. Administrator must reconcile the complete checklist and project authority against these receipts and capture before/after API evidence, or document the explicit selected policy/hosting limitation. No fake protection proof or green-gate claim is made.

## P5: nonblocking local-extension decision

All required Project Priority P0-P4 values exist. GOV-02 requires inclusion, not an exclusive set; existing P5 is not a proven missing requirement and does not independently block full bootstrap. Preserve it and assignments. #1588 tracks whether the administrator documents P5 as a local extension or retires it through an approved migration that accounts for affected items.
