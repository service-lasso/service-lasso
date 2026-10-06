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
Each private root now retains the entire clean, stage-zero tracked source
topology and physical bytes, including repository-relative artifacts outside
docs. Tracked symlinks/submodules, missing/nonregular files, source ancestry
links and head/index/physical source drift fail closed. Untracked/ignored
files, Git metadata and retained/generated runtime state are never copied.
This standalone job is Linux consumer evidence. Windows execution fails
closed because Node's portable file API does not expose every Windows
reparse attribute; it does not replace or alter any Windows release gate.
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

### #1718 / PR #1722 first actual docs failure and topology correction

Original source90de5322a012e20b11ab9c2d2c11022ac43ced68 / tree ed2e2c51b56ed8229dcde9dba3c7510c707d7e0d remains immutable. Natural run37420183923 attempt1/job112127568885 executes only the ordinary private Docusaurus build, started05:46:57.795Z ended05:48:18.247Z exit1: unchanged host-runner-service-owner-package ../../scripts/host-runner-service/contract-v1.json target is missing from the private docs-only topology. Preserve original fatal log449-483, prior image-size-safe warnings430/438 and full first actual receipt/artifact; pooled SSG, route parity and every browser case are NOT_REACHED. Separate ordinary Docs success is not consumer qualification.

Before correction, whole-source-checkpoint-root-v1 SOURCE_CHECKPOINT90_NOT_FINAL_KNOWN_UNIT ROOTe029db2617b30d35852c7341ac486e01f92596d3258f4d061b0ec425ce19acb3 preserves complete90base/head/physical/rawGit, all original6137/review8/final32/CI494 bindings and884 first failed consumer originals/artifact members. Parent selects a materially new source-topology repair: copy ENTIRE tracked regular physical source tree into private ordinary/pooled roots; preserve repository-relative artifacts, original docs/link policy/loader and all consumer checks. Reject missing paths, symlinks/reparse ancestry, nonregular tracked entries, dirty source or head/source drift; copy no untracked, ignored, retained or generated runtime state. Source-owned tracked templates/assets remain actual source inputs. No public docs edits, link suppression, fixture stubs, lock/dependency change, manual rerun or local target execution. Corrected source remains UNRUN locally until final complete input freeze, DIFFERENT entire review and parent admission. Existing thirteen native/product failures and all original protected policies stay preserved.

### #1718 / PR #1722 bbe original clean-source failure diagnostic

Source bbe18b56955e37f18b0b5fc1dd3712ab4489a165 / tree da376278be2555773a851f459b7ab0d68e8c5f30 is preserved in whole-source-checkpoint-root-v1 SOURCE_CHECKPOINT_BBE_NOT_FINAL_KNOWN_UNIT ROOT1f6ceb59aa5f492fc1115da87acff092c8d2fe27d3b18dfe99c3848c8ef9d71a,19884 members. It includes complete current/base physical/raw source, prior13028 checkpoint, sealed original90CI1370 and original firstbbe job/artifact11392918152. Actual PRmerge checkout a202012291f469d82783763fd2bf3067c0fe6fbc tree equals bbe; natural run37421112764/job112130446203 exits1 in unchanged clean guard, raw status LENGTH24 (24 !==0), commands=[], ordinary/pool/browser NOT_REACHED. Exact dirt path/cause is UNKNOWN because original raw Gitstatus bytes were not captured; do not infer them. Separate current DocsSite pass and exactbbe native failures do not qualify this consumer unit.

Parent selects narrowly additive source diagnostics before the same clean assertion: preserve actual raw status/index/head/tree, raw tracked diff (no external/text conversion driver) and hashes/metadata of changed tracked regular physical files only in private ignored evidence. Never copy arbitrary untracked/private contents, delete/reset dirt, weaken the guard or accept dirty source. This provides materially new original cause evidence on a natural new-head attempt; no manual retry or local target execution. Whole source unit remains active until authentic cause is disposed and coherent input frozen/reviewed/admitted; every old failure/checkpoint is immutable.
