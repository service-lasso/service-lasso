# #1861 positioning documentation evidence and handoff

Mode: Development. State: implemented and locally verified; awaiting draft PR
review/landing into `develop`. User explicitly excludes merge, deployment and
release/security-setting actions. Spec: [SPEC-014](../specs/SPEC-014-product-positioning-docs.md)
POS-1 through POS-4. Issue: https://github.com/service-lasso/service-lasso/issues/1861.

## Baseline and ownership

- Fresh single-branch, no-tags clone of `develop` at
  `57b72008680aa4c48489523d33eaa3ecab37afa0`; clone remains on `develop`.
- Clean isolated worktree `feature/1861-product-positioning-docs`, retained for
  review. Existing `D:/projects/service-lasso/service-lasso` release-reconciliation
  lane and all other owner work are untouched. No release branch is an input.
- Read AGENTS and its governance rule set. Current develop has no `.agents/skills`
  directory or nested AGENTS under the edited docs. No denied session paths or
  secret material were read.

## Requirement and source review

| Requirement | Change and evidence |
| --- | --- |
| POS-1 | `docs/why-service-lasso.md`: app-owned manifests/workspace, native supporting processes, app integration and packaging links, independent agent testing. |
| POS-2 | `docs/one-worktree-one-runtime.md`: prepare/start/identity/endpoints/test/MCP/cleanup. Checked `src/cli.ts`, `scripts/demo-worktree-proof.mjs`, `scripts/demo-instance-lib.mjs`, `src/server/index.ts`, `src/runtime/operator/mcp.ts` and `mcp-auth.ts`, and canonical registry/allocation/MCP/security docs. |
| POS-3 | `docs/service-lasso-containers-process-managers.md`: natural-fit comparison, not a yes/no capability matrix. Official PM2 API and multiple-instance docs; Docker Engine/Linux install, rootless, MCP and Compose project-name docs read on 2026-10-24, linked inline. Security and exact-candidate qualification limits explicit. |
| POS-4 | Trio cross-links; docs home, Start here sidebar, integration, component explanation, demo entry and documentation map updated. Build/link/test results below. |

## Executed validation

Node `22.23.2`, npm `10.9.8`; locked dependencies installed with
`npm ci --ignore-scripts --no-audit --no-fund`. No lockfile changes.

- `npm run build`: PASS.
- `npm run docs:build`: PASS after a permissions retry. First sandbox build failed
  with Windows `EPERM` creating `docs/build/img/newcomer`; the same command with
  required filesystem permissions completed. Existing image-size-safe parser
  warnings for `echo-detail.png` remain; no security mitigation changed.
- `node --test tests/docs-appearance.test.js tests/docs-site-workflow.test.js`:
  4 passed, 0 failed, 0 skipped. No workflow dispatch or publication performed.
- `node --test --test-name-pattern='worktree proof|worktree cleanup|canonical demo verifier (discovers only|unwraps v2|rejects a healthy)' tests/demo-instance.test.js`:
  8 selected existing tests passed, 0 failed, 0 skipped. Covers command handoff,
  copied-manifest patching, forwarded options, invalid Admin root, shutdown-state
  waiting, active-generation selection and wrong-generation rejection. These are
  fixture-level checks, not native/live multi-runtime qualification.
- `node scripts/demo-worktree-proof.mjs --id=docs-1861 --json`: PASS; generated
  isolated roots, branch/commit ownership and proposed URLs `127.0.0.1:18100`
  and `127.0.0.1:18101`. Runtime was not started.
- `node scripts/demo-worktree-proof.mjs --cleanup --summary=.demo-logs/worktree-proof/docs-1861/worktree-proof-summary.json`:
  PASS; `already_stopped`, `not_running`, settled shutdown, zero blockers and a
  cleanup record. This proves prepared/non-running cleanup, not live shutdown.
- Local Markdown target check: 115 links resolve across all 8 changed/new Markdown
  pages. Generated HTML for all three new pages contains the trio's routes and
  sidebar. Docusaurus build completed with broken route links configured to throw.
- `git diff --check`: PASS. Targeted cumulative self-review: scope matches POS-1..4;
  no runtime code, test assertions, dependencies, release or security settings changed.

## Accounting and limits

All intended changes are reader docs/navigation plus this evidence record and the
bounded spec. Generated `node_modules/`, `dist/`, `docs/build/`, `docs/.docusaurus/`,
`workspace/` and `.demo-logs/` follow existing ignore rules. Raw build/test logs,
link-check utility and example JSON are retained in the enclosing task workspace,
outside the repository; they are validation artifacts, not product changes.

Full runtime/MCP/native suites and live released-service startup were not run for
this documentation-only change. No released qualification, performance, battery,
capacity, hostile-code sandbox or complete secret nonpersistence claim is made.
The feature branch/worktree is intentionally retained for review under #1861;
the user's requested draft PR boundary takes precedence over governance's default
merge-before-closure path. Owner review/landing is the remaining follow-up.
