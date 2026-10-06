# #1718 actual documentation consumers

SPEC-007 AC-7F/AC-7G.docs-consumers; parent #1562. Source proposal from named
develop `cae79b5e92d7ded41dda1f1c600ee9b53b7aaebc`, following merged PR #1719.
All runner/build/browser checks below are **UNRUN** by this source author.
The original dependency repair, its entire reviews, natural terminal failures,
and thirteen unqualified native/product assertions remain separate evidence.

## Actual consumer route

`scripts/qualify-docs-consumers.mjs` uses the current installed Docusaurus CLI
and complete copies of the current docs, config, theme, loader and sidebars.
It never replaces Docusaurus's executor, renderer, worker or Mermaid loader.
The ordinary build uses the unchanged config. The pooled config enables only
`future.faster.ssgWorkerThreads` and its required
`future.v4.removeLegacyPostBuildHeadAttribute` flag. Child-only published
diagnostic inputs select two workers, task size ten, and performance logs.
Real worker task logs must identify at least two workers rendering routes;
all ordinary HTML routes and H1 titles must survive the pooled build.
Fast tasks omitted by the upstream logger's five-millisecond threshold can
cause a fail-closed lack-of-evidence result; an absent witness is never a pass.

The only extra plugin observes Webpack's `processAssets` report stage. It
records original resource and compiler-source SHA-256 values, actual module
chunk files (including concatenated children), and emitted asset hashes. It
does not change loaders, aliases, module source, renderer results or assets.

Private MDX code fences use the stock Docusaurus `@theme/Mermaid` consumer:

- Native math exercises Mermaid's default `mermaid` package entry,
  `mermaid.core.mjs`, dynamically imported selected KaTeX, native MathML, and
  the theme's normal optional ELK registration. The ELK diamond must have four
  nodes, four edges and distinct node transforms, and load its emitted ELK
  renderer chunk.
- Forced legacy math uses Mermaid's existing diagram configuration, the same
  default package/theme, and the selected KaTeX stylesheet imported from MDX.
  The browser must see MathML plus HTML math, computed KaTeX math font, an
  actually downloaded official KaTeX font, and real built CSS color/calculation
  semantics. This is qualification input only, not a new production CSS policy.
- Invalid Mermaid syntax must reach the stock error boundary and produce no
  accepted Mermaid SVG. No replacement renderer or manufactured success state
  handles invalid input.

Chromium comes from existing `@playwright/test` 1.63.0. A local static server
serves the actual build tree. Browser asset responses must match compiler
asset hashes; foreign requests, asset failures, valid-page crashes, missing
math, CSS, geometry, selected modules or fonts fail the unit. The selected
KaTeX compiler source must hash identically to its official installed file.
The complete published file inventories of KaTeX, Mermaid, ELK, Tinypool,
Docusaurus core/theme/logger are checked before builds, and actual Docusaurus
Tinypool resolution must name the patched root entry. These source checks are
supporting custody evidence; real build/browser observations provide consumer
evidence. The Mermaid standalone builds remain in the complete inventory;
they are not selected, patched, substituted or relabelled by this unit.

## Evidence and execution boundary

All copies, fixtures, builds, logs, inventories, screenshots, DOM snapshots,
browser response/error observations and terminal receipts stay under ignored
`.docs-consumer-qualification/run-*`, outside `docs/` publication input.
The output path is printed and retained on failure. No Pages artifact or
deployment job is introduced. The standalone natural CI job preserves current
production/tooling audit scripts and uses the unchanged lock and Node 22.
It does not make the failed full release suite continue, skip or pass.

No package, lock, workspace, current docs config/content, release workflow,
native protected test, threshold, deadline, retry, permission or concurrency
policy is changed. No local target runtime is permitted before the new full
input ROOT, DIFFERENT entire SOURCE_GO, and parent admission. Naturally
triggered hosted CI after push produces separate evidence, never acceptance
from source push. New source failures require a new source freeze/review;
installed lock normalization or changed dependencies also require a new full
review/admission before subsequent execution.

The unit cannot qualify release archives, published/fresh npm consumers,
native product gates, GA, publication, promotion or deployment. Those remain
the existing separately admitted original-boundary work.

## Published API sources inspected

- [Docusaurus 3.10.2 config and SSG flags](https://docusaurus.io/docs/api/docusaurus-config#future)
- [Docusaurus Mermaid/ELK integration](https://docusaurus.io/docs/markdown-features/diagrams)
- [Mermaid math rendering modes](https://mermaid.js.org/config/math.html)
- [Webpack compilation/asset hooks](https://webpack.js.org/api/compilation-object/)
- [Playwright network response APIs](https://playwright.dev/docs/network)

Full published package archives and source files, current docs, actual SSG
executor/worker/environment/logger, default theme loader/component and their
metadata are retained in the complete external source packet. Public pages
are supporting documentation; exact published source bytes govern the runner.
