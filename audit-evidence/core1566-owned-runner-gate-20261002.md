# Core #1566 owned-runner gate

- Mode: Development. Requirement: `SPEC-002` `AC-4CH.1`.
- Checkout: `D:\projects\service-lasso\_worktrees\core1566-owned-staged-transfer`; branch `feature/1463-complete-staged-transfer`.
- Pre-change head/tree: `36e867dc332b41248225d0e1eba9a5edb52fbfce` / `039df98d782380d70e84e75cf8789599b53c743f`.
- The isolated checkout is a non-reparse directory. The proposed evidence and state roots did not exist at the gate, so no retained runtime state was selected.
- Parent: Windows `10.0.26200.0`, PowerShell PID `91296`, PPID `6792`, birth `2026-10-02T11:25:29.7837936+10:00`, image `C:\Users\maxbarrass\.cache\codex-runtimes\codex-primary-runtime\dependencies\native\powershell\pwsh.exe`.
- `SERVICE_LASSO_WORKSPACE_ROOT`, `SERVICE_LASSO_INSTANCE_REGISTRY_PATH`, and `SERVICE_LASSO_HOST_PORT_REGISTRY_PATH` were each absent from that parent environment. No runtime child was started during this gate.
- The explicitly addressed Framework compiler exists at `C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe`; its absence from `PATH` is not treated as SDK absence.

## Frozen input observations

| Path | Bytes | SHA-256 |
| --- | ---: | --- |
| `scripts/mcp-product-acceptance-lib.mjs` | 22976 | `a285f0d2b04b2095de6503bfff80978393e39327cca37d007d49fc458f2a0d44` |
| `src/runtime/execution/windows-managed-launcher-native-bootstrap.c` | 10367 | `fdf92155b1e1b04d9f3e75e4276ae92e9bb2b90cfa7d676626ae218217dc2d5e` |
| `src/runtime/execution/windows-managed-launcher-native.cs` | 69946 | `2f79fdb9652d3aa2fb3a8de5169d889cf0943b6baf76bdf4329ceff7925d065b` |
| `src/runtime/execution/windows-managed-launcher-native.exe` | 141824 | `401699f683f56e081236e550ab59c06f888929ec5e30588f4e27cce972d4364c` |
| `src/runtime/execution/windows-managed-launcher-managed.exe` | 39936 | `ff1f7fdf44a4419f681e5cd7fe23bd59b495153ad6342ccd321d2c36de3228fa` |
| `src/runtime/operator/windows-directory-sync-helper.exe` | 4608 | `b2e1fd8fd2ff08d8fb2cbc69ca89d454da0fd3fdcb397d26bb22f2f156a79c91` |

## Outcomes

- `npm ci --ignore-scripts`: passed.
- `npm run build`: passed.
- `scripts/verify-windows-process-inspector.ps1 -DirectorySyncHelper -Behavioral`: blocked before execution because the local execution policy refuses `.ps1` files. No execution-policy bypass was used.
- The focused Node suite was not started after that failed prerequisite. There is no native or release-qualification claim.
