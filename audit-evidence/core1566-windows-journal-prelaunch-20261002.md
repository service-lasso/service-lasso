# Core #1566 Windows journal durability — immutable prelaunch custody receipt

## Scope and authority

- Execution mode: Development.
- Governing issue / requirement: Core #1566; `SPEC-002` `AC-4CH` and `AC-4CH.2`.
- Scope: make both durable journal publications fail closed on Windows only when the reviewed native directory-flush boundary cannot prove completion.  This receipt does not claim power-loss durability, release qualification, TAR admission, owner-catalog availability, CLI/TUI acceptance, GA, or attribution of the retained EPERM / STOP_FAILED investigations.
- Checkout: `D:\projects\service-lasso\_worktrees\core-1463-complete-staged-transfer`.
- Current working directory: `D:\projects\service-lasso\_worktrees\core-1463-complete-staged-transfer`.
- Branch: `feature/1463-complete-staged-transfer`; status at capture: clean.
- HEAD: `4b6d235e65870aae078bbd7d52b5368fb6238727`; tree: `be47195e9b25e32539f894fce3a007553a051bbb`.
- Local `develop`: `02785268392318f14af3d0596df1ca5414957ce8`; tree: `4bbdff7f2f6485b05d55fabf823983a58c68e6ea`.
- Provider `origin/develop` readback: `4e5ec88a4f79d38b75f95b7fe20e24787b5c6c12`; its tree is intentionally recorded by the post-change qualification receipt.  This checkout's local merge base with `develop` is `02785268392318f14af3d0596df1ca5414957ce8`; it is not silently rebased or reoriented from `main`.
- Capture time: `2026-10-02T07:59:50.4177874+10:00`.

## Frozen source, test, and native-asset inputs

| Path | Bytes | SHA-256 |
| --- | ---: | --- |
| `src/runtime/release/staged-service-transfer.ts` | 44119 | `ccf4a502c0c4dde253dbcbd6d382c7a072d7dff0f56264db621fabd825ad05e7` |
| `src/runtime/operator/remote-service-registration.ts` | 44948 | `a65c97a7fdde5dafd3f93fa353be8df8fe5cd804de8a39ad10a6f8032c70f3df` |
| `src/runtime/operator/windows-directory-sync-helper.cs` | 1761 | `b579e2183c0671866262d6a684e2d41035e4bf1022df6ecfcf590d8273482ade` |
| `src/runtime/operator/windows-directory-sync-helper.exe` | 4608 | `b2e1fd8fd2ff08d8fb2cbc69ca89d454da0fd3fdcb397d26bb22f2f156a79c91` |
| `src/runtime/operator/windows-directory-sync-helper.provenance.json` | 700 | `f32758ae98bc7196a779f8825f82bf0d80dc58f6e10d43871216ba0247eff031` |
| `src/runtime/execution/windows-managed-launcher-native.exe` | 141824 | `401699f683f56e081236e550ab59c06f888929ec5e30588f4e27cce972d4364c` |
| `dist/runtime/operator/windows-directory-sync-helper.exe` | 4608 | `b2e1fd8fd2ff08d8fb2cbc69ca89d454da0fd3fdcb397d26bb22f2f156a79c91` |
| `dist/runtime/operator/windows-directory-sync-helper.provenance.json` | 700 | `f32758ae98bc7196a779f8825f82bf0d80dc58f6e10d43871216ba0247eff031` |
| `dist/runtime/execution/windows-managed-launcher-native.exe` | 141824 | `401699f683f56e081236e550ab59c06f888929ec5e30588f4e27cce972d4364c` |
| `tests/staged-service-transfer.test.js` | 41215 | `373dd6dcf742990b7e9558a406709d422ca28868b5075f9a10b3992d66bd9218` |
| `tests/staged-service-transfer-http.test.js` | 26046 | `84428af57c37c8c19854ab659631df960d956cb80fe71848fd4ecdf62bfbcaba` |
| `tests/mcp-product-artifact.test.js` | 36865 | `8451caf340c93ecebca16c570fadc759716d768b3895a53a095c3254abfded16` |
| `package.json` | 6107 | `36a66603d05c53eec3ba18232273ce64e87dc6ee0a5f099defb6d2944c1b1f90` |
| `package-lock.json` | 815178 | `27c93c4910348729e9bd26b044222bf733afb1dc032f47e38cab080a4e2a6e43` |

The input manifest is these immutable paths plus `package-lock.json`; no shared `node_modules` directory is evidence or input.  The already-emitted `dist` native assets above are pre-change comparison bytes only and will be rehashed after the post-receipt isolated dependency install and build.

## Required execution custody

The next commands are exact and run only after this receipt exists:

1. `npm ci --ignore-scripts`
2. `npm run build`
3. `powershell -NoLogo -NoProfile -NonInteractive -File scripts/verify-windows-process-inspector.ps1 -DirectorySyncHelper -Behavioral`
4. `node --test --test-concurrency=1 tests/staged-service-transfer.test.js tests/staged-service-transfer-http.test.js tests/windows-directory-sync-helper.test.js tests/mcp-product-artifact.test.js`

The launch input manifest contains exactly one literal occurrence each of:

- `SERVICE_LASSO_WORKSPACE_ROOT`
- `SERVICE_LASSO_INSTANCE_REGISTRY_PATH`
- `SERVICE_LASSO_HOST_PORT_REGISTRY_PATH`

The runtime receipt will record their test-owned absolute values, the source locations that consume them, and no values from any user registry.  The test harness must use a new owned temporary root and its own registries; it must never select a temp-root fallback or borrow a shared registry.

Before any command above, the observing parent is PowerShell PID `62100`, parent PID `90424`, birth `2026-10-02T07:59:48.365386+10:00`, on Windows 11 Pro `10.0.26200` build `26200`.  No product child, correlation, close event, exit code, signal, or stream exists at prelaunch.  The runtime receipt must record each actual child OS birth, parent relation, generated correlation, true `close` event (distinct from `exit`), exit code, signal, and raw stdout/stderr stream digests and retained paths.  Missing any one makes that run invalid custody rather than a pass.

## Existing boundary and intended correction

`remote-service-registration.ts` already uses the provenance-attested package-adjacent `windows-directory-sync-helper.exe` through the owned managed launcher for private attachment and live-parent publication. `staged-service-transfer.ts` currently returns before a Windows directory flush after replacing the authoritative combined operations/journal file. The correction will make that second publication call the same fail-closed directory boundary. Any unavailable helper, changed helper/provenance, unsafe identity, launch failure, nonzero helper result, or close/flush failure leaves recovery authority retained and returns the existing unavailable path before acknowledgement.

This is direct native-helper behavior and provenance verification when it executes. A source review, emitted-asset hash, or successful rename alone is only surrogate evidence.
