# Service Lasso Release 1 — Independent Windows PC Test Plan

- Version: 1.0
- Target platform: Clean Windows 11 x64 PC
- Estimated duration: 90–150 minutes
- Run as: A normal, non-administrator Windows user
- Tracking issue: [service-lasso/service-lasso#1208](https://github.com/service-lasso/service-lasso/issues/1208)
- Acceptance authority: `SPEC-007` `AC-7F` through `AC-7H`

## 1. Test objective

Independently verify:

- public artifact identity and checksums;
- npm identity and clean installation;
- Windows acquisition using the exact released Core, Admin, and Broker;
- first-run setup and local-operator custody;
- runtime, Admin, Broker, routing, and sample-service health;
- local secret creation, controlled reveal, edit, reset, rotation, decommission, and restore;
- encrypted backup, verification, restore, and Windows master-key rotation;
- audit, redaction, restart persistence, and safe cleanup;
- whether the Windows bundled/no-download archive is correctly platform-specific.

This plan does not test or approve external-provider GA parity, bulk campaigns,
Secrets Sync apply, scheduled rotation, Broker mutation MCP, HSM, FIPS, MFA, or
PGP bootstrap.

## 2. Exact test identities

| Component | Version | Exact revision |
| --- | --- | --- |
| Core | `2026.9.1-1f4ec40` | `1f4ec40f13fe3867b24ca901c42fe31c69e01e8d` |
| Admin | `2026.8.31-f015b44` | `f015b4445b0526546a309301270186a697588166` |
| Broker | `2026.8.31-f340883` | `f340883056ec3cf74b535fb46490b39382e8c823` |
| npm | `@service-lasso/service-lasso@2026.9.1-1f4ec40` | Same Core revision |

Expected Windows SHA-256 values:

| Artifact | SHA-256 |
| --- | --- |
| Core lean ZIP | `f7f2754e16da8329ca7692163c18ceb67d685aa275e5865cea28cec71fba1a20` |
| Core bundled ZIP | `a6d187931776f2abcc306a62f2ec23a4f3e220d317c0c0e7ccb049690e2463e0` |
| Admin ZIP | `fe5e5fe01d1202f3874097e6223652d634c94677c765c5f82d20e6d274c0161c` |
| Broker ZIP | `e64ee6a85c053c6dd68e2713477dae0620a458496bbd41077b55cc4c2df3f966` |

## 3. Evidence and safety rules

Record only:

- test-case ID;
- pass, fail, or blocked;
- UTC timestamp;
- product version;
- HTTP status;
- safe error code;
- metadata-only audit outcome;
- screenshot of non-sensitive pages where useful.

Never record:

- local-admin token;
- local-operator password;
- secret values;
- master keys or recovery material;
- cookies or authorization headers;
- reveal dialogs;
- raw request/response bodies containing credentials;
- environment dumps or full process command lines.

Use only generated test secrets. Never enter a real credential.

Any checksum mismatch, unexpected remote bind, secret leakage, unexplained
process ownership, or failure to clean up is an immediate stop.

## 4. PC prerequisites

Install:

- Windows 11 x64 with current security updates;
- Node.js 22 or newer;
- npm;
- PowerShell 7 recommended;
- Edge or Chrome;
- GitHub CLI for attestation verification.

Record:

```powershell
Get-ComputerInfo |
  Select-Object WindowsProductName, WindowsVersion, OsBuildNumber, OsArchitecture

node --version
npm --version
gh --version
```

Confirm the test ports are unused:

```powershell
$TestPorts = 17700, 17883, 17890, 18080, 19081, 4010, 4020

$BusyPorts = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
  Where-Object { $TestPorts -contains $_.LocalPort } |
  Select-Object LocalAddress, LocalPort, OwningProcess

$BusyPorts
```

Expected: no output.

If any port is occupied, identify the owner and stop. Do not terminate an
unknown process just to continue testing.

## 5. ART-01 — Download public artifacts

Create a clean test location:

```powershell
$TestRoot = 'C:\ServiceLasso-R1-Test'
$DownloadRoot = Join-Path $TestRoot 'downloads'

New-Item -ItemType Directory -Path $DownloadRoot -Force | Out-Null
Set-Location $DownloadRoot
```

Download the four Windows artifacts:

```powershell
Invoke-WebRequest `
  -Uri 'https://github.com/service-lasso/service-lasso/releases/download/2026.9.1-1f4ec40/service-lasso-2026.9.1-1f4ec40-win32.zip' `
  -OutFile 'service-lasso-2026.9.1-1f4ec40-win32.zip'

Invoke-WebRequest `
  -Uri 'https://github.com/service-lasso/service-lasso/releases/download/2026.9.1-1f4ec40/service-lasso-bundled-2026.9.1-1f4ec40-win32.zip' `
  -OutFile 'service-lasso-bundled-2026.9.1-1f4ec40-win32.zip'

Invoke-WebRequest `
  -Uri 'https://github.com/service-lasso/lasso-serviceadmin/releases/download/2026.8.31-f015b44/%40serviceadmin-win32.zip' `
  -OutFile '@serviceadmin-win32.zip'

Invoke-WebRequest `
  -Uri 'https://github.com/service-lasso/lasso-secretsbroker/releases/download/2026.8.31-f340883/secretsbroker-win32.zip' `
  -OutFile 'secretsbroker-win32.zip'
```

Verify checksums:

```powershell
$ExpectedHashes = [ordered]@{
  'service-lasso-2026.9.1-1f4ec40-win32.zip' =
    'f7f2754e16da8329ca7692163c18ceb67d685aa275e5865cea28cec71fba1a20'
  'service-lasso-bundled-2026.9.1-1f4ec40-win32.zip' =
    'a6d187931776f2abcc306a62f2ec23a4f3e220d317c0c0e7ccb049690e2463e0'
  '@serviceadmin-win32.zip' =
    'fe5e5fe01d1202f3874097e6223652d634c94677c765c5f82d20e6d274c0161c'
  'secretsbroker-win32.zip' =
    'e64ee6a85c053c6dd68e2713477dae0620a458496bbd41077b55cc4c2df3f966'
}

foreach ($Entry in $ExpectedHashes.GetEnumerator()) {
  $ActualHash = (Get-FileHash -LiteralPath $Entry.Key -Algorithm SHA256).Hash.ToLowerInvariant()
  [pscustomobject]@{
    Artifact = $Entry.Key
    Expected = $Entry.Value
    Actual = $ActualHash
    Passed = $ActualHash -eq $Entry.Value
  }
}
```

Expected: all four rows show `Passed = True`.

Do not extract or run an artifact whose hash fails.

## 6. ART-02 — Verify public attestations

```powershell
gh attestation verify `
  '.\service-lasso-2026.9.1-1f4ec40-win32.zip' `
  --repo service-lasso/service-lasso

gh attestation verify `
  '.\service-lasso-bundled-2026.9.1-1f4ec40-win32.zip' `
  --repo service-lasso/service-lasso

gh attestation verify `
  '.\@serviceadmin-win32.zip' `
  --repo service-lasso/lasso-serviceadmin

gh attestation verify `
  '.\secretsbroker-win32.zip' `
  --repo service-lasso/lasso-secretsbroker
```

Expected: each file verifies against its named GitHub repository.

Record a failure if the attestation is absent, invalid, or belongs to a
different repository.

## 7. NPM-01 — Clean npm consumer

```powershell
$NpmRoot = Join-Path $TestRoot 'npm-consumer'
New-Item -ItemType Directory -Path $NpmRoot -Force | Out-Null
Set-Location $NpmRoot

npm init -y
npm install --ignore-scripts '@service-lasso/service-lasso@2026.9.1-1f4ec40'
npx --no-install service-lasso --version
npm audit --omit=dev
npm view '@service-lasso/service-lasso' dist-tags version gitHead --json
```

Expected:

- CLI version: `2026.9.1-1f4ec40`;
- npm `latest`: `2026.9.1-1f4ec40`;
- `gitHead`: `1f4ec40f13fe3867b24ca901c42fe31c69e01e8d`;
- production audit: zero vulnerabilities.

## 8. BND-01 — Windows bundled/no-download inspection

Extract the bundle for inspection only:

```powershell
$BundleExtractRoot = Join-Path $TestRoot 'bundle-inspection'

Expand-Archive `
  -LiteralPath (Join-Path $DownloadRoot 'service-lasso-bundled-2026.9.1-1f4ec40-win32.zip') `
  -DestinationPath $BundleExtractRoot

$BundleRoot = Join-Path $BundleExtractRoot 'service-lasso-bundled-2026.9.1-1f4ec40'

Get-ChildItem `
  -LiteralPath (Join-Path $BundleRoot 'services') `
  -Recurse -Force -File |
  Where-Object { $_.FullName -match '\\.state\\artifacts\\' } |
  Select-Object -ExpandProperty Name |
  Sort-Object -Unique
```

Windows acceptance expectation:

- cached service archives must be Windows-compatible;
- startup must not need replacement downloads for the bundled baseline;
- no Linux-only cached archive may be accepted as Windows no-download evidence.

Known current observation: this exact Windows bundle contains Linux caches such
as:

- `secretsbroker-linux.tar.gz`;
- `@serviceadmin-linux.tar.gz`;
- `lasso-nginx-1.30.0-linux.tar.gz`;
- `lasso-traefik-linux.tar.gz`.

Record `BND-01 = FAIL` if reproduced.

Do not count subsequent lean-runtime testing as clearing this bundled/no-download
failure.

## 9. Prepare the released Windows runtime

Extract the lean Core:

```powershell
$CoreExtractRoot = Join-Path $TestRoot 'core-extract'

Expand-Archive `
  -LiteralPath (Join-Path $DownloadRoot 'service-lasso-2026.9.1-1f4ec40-win32.zip') `
  -DestinationPath $CoreExtractRoot

$CoreRoot = Join-Path $CoreExtractRoot 'service-lasso-2026.9.1-1f4ec40'
$ServicesRoot = Join-Path $TestRoot 'services'
$WorkspaceRoot = Join-Path $TestRoot 'workspace'
```

Copy only the released service manifests and runtime fixtures from the bundle.
Deliberately exclude all seeded `.state` caches so Core must acquire correct
Windows artifacts:

```powershell
robocopy `
  (Join-Path $BundleRoot 'services') `
  $ServicesRoot `
  /E /XD .state

if ($LASTEXITCODE -ge 8) {
  throw "Service manifest copy failed with robocopy exit code $LASTEXITCODE"
}

New-Item -ItemType Directory -Path $WorkspaceRoot -Force | Out-Null
```

Verify the released Core CLI:

```powershell
Set-Location $CoreRoot
node .\packages\core\cli.js --version
```

Expected: `2026.9.1-1f4ec40`.

## 10. RUN-01 — Start from released artifacts

In PowerShell terminal A:

```powershell
Set-Location $CoreRoot

node .\packages\core\cli.js start `
  --services-root $ServicesRoot `
  --workspace-root $WorkspaceRoot `
  --port 17883 `
  --port-policy fixed `
  --json
```

Keep terminal A open.

Expected:

- checksums are verified before extraction or launch;
- Windows Admin and Broker artifacts are downloaded;
- Service Admin becomes reachable on port `17700`;
- Core becomes reachable on port `17883`;
- no service binds to a non-loopback address without an explicit operator choice.

Do not continue if the runtime substitutes a source checkout or a different
release version.

## 11. RUN-02 — Health and version probes

In PowerShell terminal B:

```powershell
$CoreHealth = Invoke-RestMethod 'http://127.0.0.1:17883/api/health'
$CoreHealth | ConvertTo-Json -Depth 5

(Invoke-WebRequest 'http://127.0.0.1:17700/').StatusCode
(Invoke-WebRequest 'http://127.0.0.1:17890/health').StatusCode
(Invoke-WebRequest 'http://127.0.0.1:18080/health').StatusCode
(Invoke-WebRequest 'http://127.0.0.1:19081/ping').StatusCode
(Invoke-WebRequest 'http://127.0.0.1:4010/health').StatusCode
(Invoke-WebRequest 'http://127.0.0.1:4020/health').StatusCode
```

Expected:

- Core status is `ok`;
- Core API version is `2026.9.1-1f4ec40`;
- every HTTP probe returns `200`.

Also check the Admin same-origin API:

```powershell
Invoke-RestMethod 'http://127.0.0.1:17700/api/dashboard' | Out-Null
Invoke-RestMethod 'http://127.0.0.1:17700/api/services' | Out-Null
```

Expected: both return JSON, not the HTML application shell.

## 12. UI-01 — First-run setup

Open:

```text
http://127.0.0.1:17700/services/%40secretsbroker
```

Expected before setup:

- “Service Lasso first-run setup” is visible;
- status says “Setup required” and “Not initialized”;
- the main product shell remains locked;
- no vault path, master key, Broker token, signing key, or generated secret is
  displayed.

Perform setup:

1. Select **Initialize Secrets Broker**.
2. Wait up to three minutes.
3. Save the one-time local-admin token and local-operator password in an
   approved password manager.
4. Do not screenshot, paste into notes, or include the values in evidence.
5. Confirm that the credentials were saved.
6. Select **Continue after saving**.
7. Continue as local-root when prompted.

Expected after setup:

- setup mode is off;
- Broker reports ready;
- “Trusted identity verified” is shown;
- the generated `sample.GENERATED_TOKEN` reference exists as metadata;
- no generated value appears in the service details or general inventory.

## 13. UI-02 — Navigation and product-boundary check

Walk through:

- Dashboard;
- Runtime;
- Services;
- Secrets Broker;
- Secrets;
- Providers;
- Topology;
- Security → Secret access;
- Operations → Audit.

Expected:

- no blank or crashed page;
- live data is clearly distinguished from unavailable or preview data;
- Fleet is absent;
- Sessions is absent;
- Policy Simulation is absent;
- Support Bundle is absent;
- Secret access displays actual manifest-backed assignments;
- PGP bootstrap is not offered;
- external-provider mutation is not presented as validated Release 1
  functionality.

## 14. SEC-01 — Local secret lifecycle

Use namespace:

```text
services/node-sample-service
```

Use test reference:

```text
validation.CREATED_TOKEN
```

Use audit reason:

```text
Independent Windows PC Release 1 validation
```

Generate synthetic values. Never reuse a personal or production credential.

Run this sequence:

1. Select **Create secret**.
2. Enter the namespace, reference, synthetic value, and audit reason.
3. Preview the operation.
4. Confirm only after a signed/ready plan is displayed.
5. Apply it.
6. Search for the new reference.
7. Exercise provider and outcome filters.
8. Change page size and use next/previous paging.
9. Edit the secret through preview and confirmation.
10. Reveal it using a separate audit reason.
11. Verify an expiry is shown.
12. Select **Clear reveal** immediately.
13. Confirm the value is no longer present.
14. Reset the secret through preview and confirmation.
15. Open **Policy**.
16. Confirm policy is planning-only if apply is not supported.
17. Confirm an unavailable policy operation is disabled rather than reported as
    successful.

Expected:

- mutations require preview, reason, and confirmation;
- create/edit/reset report that audit was recorded;
- inventory remains metadata-only;
- the replacement-value field is cleared after mutation;
- reveal is bounded and explicitly cleared;
- policy preview does not pretend that an unsupported apply occurred.

## 15. SEC-02 — Linked rotation

Locate:

```text
services/node-sample-service / sample.GENERATED_TOKEN
```

Before rotation, confirm `node-sample-service` is running and healthy.

1. Select **Rotate**.
2. Supply a synthetic replacement and audit reason.
3. Select **Preview rotation**.
4. Confirm the preview identifies:
   - `node-sample-service`;
   - Core orchestration;
   - restart as the consumer action.
5. Confirm and apply **Rotate and converge consumers**.

Expected:

- “Core rotation committed” is shown;
- one consumer action completes;
- `node-sample-service` returns to running and healthy;
- the candidate value disappears from browser state;
- the operation is represented in Audit;
- a reload does not re-display the submitted value.

## 16. SEC-03 — Decommission and restore

For `validation.CREATED_TOKEN`:

1. Select **Decommission**.
2. Select **Check dependencies**.
3. Require a ready signed plan.
4. Enter the audit reason.
5. Confirm and decommission.
6. Verify the UI reports a recoverable encrypted tombstone.
7. Reload the page.
8. Locate the tombstoned reference and select **Restore**.
9. Confirm the exact restore.

Expected:

- decommission is not represented as irreversible deletion;
- the tombstone survives reload;
- restore reports applied and audit recorded;
- the restored reference returns without revealing its value.

## 17. REC-01 — Backup, restore, and key rotation

Open the Local encrypted store’s **Backup and keys** section.

1. Enter an audit reason.
2. Select **Create encrypted backup**.
3. Require “created and verified”.
4. Select **Verify** for that backup.
5. Require “passed integrity verification”.
6. Select **Restore** for the exact verified backup.
7. Require `Plan: ready`.
8. Confirm **Apply exact restore**.
9. Require a message that restart verification is needed.
10. Restart the Broker through its service lifecycle controls.
11. Confirm inventory and audit continuity.

On Windows only:

12. Select **Rotate master key**.
13. Confirm **Rotate and rewrap**.
14. Require a new metadata-only key ID and recorded audit result.
15. Immediately create and verify a new encrypted backup.

Expected:

- no key or recovery material is displayed;
- only a safe key identifier is shown;
- backup verification precedes restore;
- the restored store survives Broker restart;
- post-rotation backup is required and succeeds.

## 18. OPS-01 — Audit and no-leak check

Open Operations → Audit.

Verify metadata for:

- bootstrap;
- create;
- edit/reset;
- reveal;
- rotation;
- decommission and restore;
- backup and verification;
- restore;
- master-key rotation;
- Broker restart.

Expected:

- actor, action, target, time, outcome, reason, and safe correlation metadata are
  present where applicable;
- chain/tamper state is verified;
- no secret value, token, password, key, request body, or provider response
  appears.

After all reveal dialogs are closed, inspect normal page content and browser
Local/Session Storage for the synthetic test values.

Do not inspect or capture a reveal response in the browser Network panel.

Any synthetic value remaining in normal UI state or browser storage after
clear/reload is a release-blocking failure.

## 19. PERSIST-01 — Full runtime restart

In terminal A, stop the runtime with `Ctrl+C`.

Wait for shutdown, then verify ports are released:

```powershell
$TestPorts = 17700, 17883, 17890, 18080, 19081, 4010, 4020

Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
  Where-Object { $TestPorts -contains $_.LocalPort } |
  Select-Object LocalAddress, LocalPort, OwningProcess
```

Expected: no retained Service Lasso listeners.

Start the exact same command again with the same services and workspace roots.

Expected after restart:

- first-run setup is not repeated;
- Broker is ready;
- trusted identity is restored appropriately;
- the rotated generated secret reference remains;
- the restored test secret remains;
- audit and backup metadata remain;
- services return to healthy state;
- no duplicate runtime generation or competing listener appears.

A full PC reboot followed by the same startup and checks is recommended for
stronger persistence evidence.

## 20. FAIL-01 — Broker unavailable and recovery

From Admin:

1. Stop Secrets Broker through its normal service controls.
2. Return to the Secrets tab.
3. Confirm the UI reports that management is unavailable.
4. Confirm **Retry inventory** is visible.
5. Restart Secrets Broker through Core.
6. Select **Retry inventory**.

Expected:

- the unavailable state is explicit;
- no stale inventory is styled as current success;
- no secret value is shown;
- the inventory recovers without restarting Core;
- the Broker returns to ready.

## 21. Final cleanup

Decommission the temporary validation secret if it remains.

Stop the runtime with `Ctrl+C`.

Confirm all test ports are released. Do not delete the test directory until
results and metadata-only evidence have been reviewed.

When cleanup is approved, remove only:

```text
C:\ServiceLasso-R1-Test
```

Do not remove any directory outside that exact test root.

## 22. Result rules

The lean released-runtime path passes only if every mandatory `ART`, `NPM`,
`RUN`, `UI`, `SEC`, `REC`, `OPS`, `PERSIST`, and `FAIL` test passes.

The Windows bundled/no-download claim passes only if `BND-01` proves that the
published bundle contains correct Windows service archives and needs no
replacement downloads.

Current expected overall classification:

- Lean Windows Release 1 functional path: testable.
- Windows bundled/no-download artifact: expected fail pending correction.
- Independent security approval: not satisfied merely by completing this
  functional walkthrough.

## 23. Test record

Tester:

Organization:

Independence statement:

PC and Windows build:

Node/npm/browser versions:

Test start/end UTC:

| Test | Result | Safe evidence/reference | Finding ID |
| --- | --- | --- | --- |
| ART-01 |  |  |  |
| ART-02 |  |  |  |
| NPM-01 |  |  |  |
| BND-01 |  |  |  |
| RUN-01 |  |  |  |
| RUN-02 |  |  |  |
| UI-01 |  |  |  |
| UI-02 |  |  |  |
| SEC-01 |  |  |  |
| SEC-02 |  |  |  |
| SEC-03 |  |  |  |
| REC-01 |  |  |  |
| OPS-01 |  |  |  |
| PERSIST-01 |  |  |  |
| FAIL-01 |  |  |  |

Findings and severity:

Residual risks:

Decision:

- Approve
- Approve with accepted residuals
- Reject

Reviewer signature or signed-report link:

The decision must explicitly state whether the Windows bundled/no-download
failure is blocking, remediated in a replacement release, or formally removed
from the claimed release scope.
