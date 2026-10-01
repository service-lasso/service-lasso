# Pre-repair terminal finalizer sequence

Started: 2026-10-02T01:33:19.7816929+10:00
Branch: fix/1535-same-held-command-query
HEAD: fb7a773341336221b5d69ade385435eda2caa12e
Tree: d8a769b2afbcb1c8c2ec75681fa2988b853a753a
WorkspaceRoot: C:\Users\MAXBAR~1\AppData\Local\Temp\service-lasso-1536-6cad9bb437ed4fc7bb0c74649439e273\workspace
InstanceRegistry: C:\Users\MAXBAR~1\AppData\Local\Temp\service-lasso-1536-6cad9bb437ed4fc7bb0c74649439e273\instances.json
HostPortRegistry: C:\Users\MAXBAR~1\AppData\Local\Temp\service-lasso-1536-6cad9bb437ed4fc7bb0c74649439e273\ports.json

## Build

> service-lasso@0.1.0 build
> tsc -p tsconfig.json && node scripts/copy-runtime-assets.mjs

Build exit: 0
## Sequence test
TAP version 13
# Subtest: Windows managed terminal monitor keeps root-exit finalization in the same native inspection episode
ok 1 - Windows managed terminal monitor keeps root-exit finalization in the same native inspection episode
  ---
  duration_ms: 6072.2779
  type: 'test'
  ...
# Subtest: Windows public HTTP stop starts a fresh native inspection episode after a terminal monitor refresh
ok 2 - Windows public HTTP stop starts a fresh native inspection episode after a terminal monitor refresh
  ---
  duration_ms: 10281.2254
  type: 'test'
  ...
# Subtest: Windows public HTTP stop consumes a terminal root-exit finalizer only after its fresh inspection episode
ok 3 - Windows public HTTP stop consumes a terminal root-exit finalizer only after its fresh inspection episode
  ---
  duration_ms: 7182.6182
  type: 'test'
  ...
1..3
# tests 3
# suites 0
# pass 3
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 24537.1035
Test exit: 0
