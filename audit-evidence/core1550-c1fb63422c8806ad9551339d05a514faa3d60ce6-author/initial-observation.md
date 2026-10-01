# Core #1550 author initial observation

- Captured UTC: `2026-10-01T23:01:55.1910618Z` (before any dependency, build, test, or product import command in this author checkout).
- Branch / HEAD / tree: `fix/1549-port-allocation-qualification` / `c1fb63422c8806ad9551339d05a514faa3d60ce6` / `58a48643db4157e574c09bd33e97d186b754cc73`.
- Required baseline tree: `58a48643db4157e574c09bd33e97d186b754cc73`; the checkout was clean.
- Isolated literal runtime paths for all future execution:
  - `SERVICE_LASSO_WORKSPACE_ROOT=D:\projects\service-lasso\_worktrees\core1550-authorclone-c1fb6342-20261001T223700Z\audit-evidence\core1550-c1fb63422c8806ad9551339d05a514faa3d60ce6-author\workspace-root`
  - `INSTANCE_REGISTRY_PATH=D:\projects\service-lasso\_worktrees\core1550-authorclone-c1fb6342-20261001T223700Z\audit-evidence\core1550-c1fb63422c8806ad9551339d05a514faa3d60ce6-author\instance-registry.json`
  - `HOST_PORT_REGISTRY_PATH=D:\projects\service-lasso\_worktrees\core1550-authorclone-c1fb6342-20261001T223700Z\audit-evidence\core1550-c1fb63422c8806ad9551339d05a514faa3d60ce6-author\host-port-registry.json`
- Fixed ports `18242` and `18243` had no listening TCP record at observation.
- Recorded original-run PIDs `78240`, `73084`, `84276`, `67592`, `70672`, and `91252` had no current OS process record. This is an observation only: the preserved original evidence has no terminal receipt, so it remains `UNKNOWN_EXIT / MISSING_TERMINAL`.
- Raw source / retained dist fingerprints:
  - `src/runtime/execution/supervisor.ts`: 104,705 bytes; SHA-256 `6AFA322972322157E9B657C926306238DF8010C9E67F2D2A47FBB47440757BC5`.
  - `tests/process-ownership.test.js`: 205,136 bytes; SHA-256 `57C12284BEE519B2A64367E1987424C5A6218AE98C779DC1B2327FE2F3006295`.
  - `dist/runtime/execution/supervisor.js`: 98,205 bytes; SHA-256 `BBD7D1ADFABEA0D00DCEC6C4823C67464F4F43C1CFEE11858DCDF76EF1676A07`.

This record does not claim a qualification result and does not retire, alter, or interpret the preserved original run.
