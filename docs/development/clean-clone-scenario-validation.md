---
title: Clean Clone Scenario Validation
---

# Clean Clone Scenario Validation

Use this page to validate the public release scenario from a clean machine or clean folder.

The scenario is:

1. Clone `service-lasso` from GitHub.
2. Install dependencies.
3. Build the runtime.
4. Run the baseline start command.
5. Prove Service Lasso downloads/acquires the configured release-backed service archives.
6. Prove the expected baseline services are installed, configured, running or provider-healthy as intended.
7. Prove the key operator URLs respond.
8. Stop the managed services and runtime process.

## Prerequisites

Run this from Windows PowerShell.

Required tools:

- Git
- Node.js `>=22`
- npm
- network access to GitHub releases

The script uses these local service ports from the checked-in baseline manifests:

- API: `18188`
- `@nginx`: `18080`
- `@serviceadmin`: `17700`
- `echo-service`: `4010`
- `@traefik`: `19080`, `19443`, `19081`, `19082`, `19090`, `19100`, `19110`, `19120`, `19130`, `19140`, `19150`, `19160`, `19170`

If one of those ports is already in use, stop the conflicting process before running the script.

## Copy-Paste Validation Script

Copy this whole block into Windows PowerShell:

```powershell
$ErrorActionPreference = "Stop"

$RepoUrl = "https://github.com/service-lasso/service-lasso.git"
$Branch = "main"
$ApiPort = 18188
$RequiredFreePorts = @(18188, 18080, 17700, 4010, 19080, 19443, 19081, 19082, 19090, 19100, 19110, 19120, 19130, 19140, 19150, 19160, 19170)
$ExpectedServices = @(
  @{ Id = "@localcert"; Repo = "service-lasso/lasso-localcert"; Running = $false; Healthy = $true },
  @{ Id = "@nginx"; Repo = "service-lasso/lasso-nginx"; Running = $true; Healthy = $true },
  @{ Id = "@traefik"; Repo = "service-lasso/lasso-traefik"; Running = $true; Healthy = $true },
  @{ Id = "@node"; Repo = "service-lasso/lasso-node"; Running = $false; Healthy = $true },
  @{ Id = "echo-service"; Repo = "service-lasso/lasso-echoservice"; Running = $true; Healthy = $true },
  @{ Id = "@serviceadmin"; Repo = "service-lasso/lasso-serviceadmin"; Running = $true; Healthy = $true }
)

function Assert-Command {
  param([string]$Name)
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Required command '$Name' was not found on PATH."
  }
}

function Assert-Port-Free {
  param([int]$Port)
  $client = [System.Net.Sockets.TcpClient]::new()
  try {
    $connect = $client.BeginConnect("127.0.0.1", $Port, $null, $null)
    if ($connect.AsyncWaitHandle.WaitOne(250, $false)) {
      $client.EndConnect($connect)
      throw "Port $Port is already in use. Stop the conflicting process and rerun this script."
    }
  } catch [System.Net.Sockets.SocketException] {
    return
  } finally {
    $client.Close()
  }
}

function Wait-RestJson {
  param(
    [string]$Uri,
    [int]$TimeoutSeconds = 180
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  $lastError = $null

  while ((Get-Date) -lt $deadline) {
    try {
      return Invoke-RestMethod -Uri $Uri -TimeoutSec 10
    } catch {
      $lastError = $_.Exception.Message
      Start-Sleep -Seconds 2
    }
  }

  throw "Timed out waiting for $Uri. Last error: $lastError"
}

function Wait-WebStatus {
  param(
    [string]$Uri,
    [int]$TimeoutSeconds = 180
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  $lastError = $null

  while ((Get-Date) -lt $deadline) {
    try {
      $response = Invoke-WebRequest -Uri $Uri -UseBasicParsing -TimeoutSec 10
      if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 400) {
        return $response.StatusCode
      }
      $lastError = "HTTP $($response.StatusCode)"
    } catch {
      $lastError = $_.Exception.Message
      Start-Sleep -Seconds 2
    }
  }

  throw "Timed out waiting for $Uri. Last error: $lastError"
}

Assert-Command git
Assert-Command node
Assert-Command npm

$NodeMajor = [int]((node --version).TrimStart("v").Split(".")[0])
if ($NodeMajor -lt 22) {
  throw "Node.js >=22 is required. Current version: $(node --version)"
}

foreach ($port in $RequiredFreePorts) {
  Assert-Port-Free $port
}

$RunRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("service-lasso-clean-clone-" + (Get-Date -Format "yyyyMMdd-HHmmss"))
$RepoRoot = Join-Path $RunRoot "service-lasso"
$WorkspaceRoot = Join-Path $RunRoot "workspace"
$StdoutLog = Join-Path $RunRoot "service-lasso.stdout.log"
$StderrLog = Join-Path $RunRoot "service-lasso.stderr.log"
$ApiBase = "http://127.0.0.1:$ApiPort"
$serviceLassoProcess = $null

Write-Host "Run root: $RunRoot"
New-Item -ItemType Directory -Path $RunRoot -Force | Out-Null

try {
  git clone --branch $Branch --depth 1 $RepoUrl $RepoRoot
  Set-Location $RepoRoot

  npm ci
  npm run build

  $startArgs = @(
    "dist/cli.js",
    "start",
    "--services-root",
    (Join-Path $RepoRoot "services"),
    "--workspace-root",
    $WorkspaceRoot,
    "--port",
    "$ApiPort",
    "--json"
  )

  $serviceLassoProcess = Start-Process `
    -FilePath "node" `
    -ArgumentList $startArgs `
    -WorkingDirectory $RepoRoot `
    -RedirectStandardOutput $StdoutLog `
    -RedirectStandardError $StderrLog `
    -PassThru

  Write-Host "Started Service Lasso process id: $($serviceLassoProcess.Id)"

  $health = Wait-RestJson "$ApiBase/api/health" 240
  if ($health.status -ne "ok" -or $health.api.status -ne "up") {
    throw "Service Lasso API health check did not report ok/up."
  }

  $servicesResponse = Wait-RestJson "$ApiBase/api/services" 240
  $servicesById = @{}
  foreach ($service in $servicesResponse.services) {
    $servicesById[$service.id] = $service
  }

  foreach ($expected in $ExpectedServices) {
    $id = $expected.Id
    if (-not $servicesById.ContainsKey($id)) {
      throw "Expected service '$id' was not discovered."
    }

    $service = $servicesById[$id]
    $artifact = $service.lifecycle.installArtifacts.artifact

    if (-not $service.lifecycle.installed) {
      throw "Service '$id' was not installed."
    }
    if (-not $service.lifecycle.configured) {
      throw "Service '$id' was not configured."
    }
    if ([bool]$service.lifecycle.running -ne [bool]$expected.Running) {
      throw "Service '$id' running state was '$($service.lifecycle.running)' but expected '$($expected.Running)'."
    }
    if ([bool]$service.health.healthy -ne [bool]$expected.Healthy) {
      throw "Service '$id' health was '$($service.health.healthy)' but expected '$($expected.Healthy)'. Detail: $($service.health.detail)"
    }
    if ($artifact.repo -ne $expected.Repo) {
      throw "Service '$id' artifact repo was '$($artifact.repo)' but expected '$($expected.Repo)'."
    }
    if (-not $artifact.archivePath -or -not (Test-Path $artifact.archivePath)) {
      throw "Service '$id' archive path is missing or does not exist: $($artifact.archivePath)"
    }
    if (-not $artifact.extractedPath -or -not (Test-Path $artifact.extractedPath)) {
      throw "Service '$id' extracted path is missing or does not exist: $($artifact.extractedPath)"
    }
  }

  Wait-WebStatus "$ApiBase/api/services" 60 | Out-Null
  Wait-WebStatus "http://127.0.0.1:17700/" 120 | Out-Null
  Wait-WebStatus "http://127.0.0.1:4010/health" 120 | Out-Null
  Wait-WebStatus "http://127.0.0.1:19081/ping" 120 | Out-Null
  Wait-WebStatus "http://127.0.0.1:19081/dashboard/" 120 | Out-Null

  $summary = $ExpectedServices | ForEach-Object {
    $service = $servicesById[$_.Id]
    [pscustomobject]@{
      id = $_.Id
      installed = $service.lifecycle.installed
      configured = $service.lifecycle.configured
      running = $service.lifecycle.running
      healthy = $service.health.healthy
      artifactRepo = $service.lifecycle.installArtifacts.artifact.repo
      artifactTag = $service.lifecycle.installArtifacts.artifact.tag
      assetName = $service.lifecycle.installArtifacts.artifact.assetName
    }
  }

  $summary | Format-Table -AutoSize
  Write-Host "SCENARIO VALIDATED: clean clone acquired and started the release-backed baseline."
  Write-Host "Service Admin: http://127.0.0.1:17700/"
  Write-Host "Echo Service: http://127.0.0.1:4010/"
  Write-Host "Traefik Dashboard: http://127.0.0.1:19081/dashboard/"
} finally {
  try {
    Invoke-RestMethod -Method Post -Uri "$ApiBase/api/runtime/actions/stopAll" -TimeoutSec 20 | Out-Null
  } catch {
    Write-Warning "stopAll cleanup did not complete: $($_.Exception.Message)"
  }

  if ($serviceLassoProcess -and -not $serviceLassoProcess.HasExited) {
    Stop-Process -Id $serviceLassoProcess.Id -Force
  }

  Write-Host "Logs:"
  Write-Host "  stdout: $StdoutLog"
  Write-Host "  stderr: $StderrLog"
  Write-Host "  run root: $RunRoot"
}
```

## Pass Criteria

The scenario passes when the script prints:

```text
SCENARIO VALIDATED: clean clone acquired and started the release-backed baseline.
```

The summary table must show:

| Service | Expected running state | Expected health |
| --- | --- | --- |
| `@localcert` | `False` | `True` |
| `@nginx` | `True` | `True` |
| `@traefik` | `True` | `True` |
| `@node` | `False` | `True` |
| `echo-service` | `True` | `True` |
| `@serviceadmin` | `True` | `True` |

`@localcert` and `@node` are intentionally not long-running daemons. Their pass condition is installed/configured/provider-healthy, not `running=true`.

## What This Proves

This validates the core clean-clone scenario:

- `service.json` is the only service manifest source needed in the core repo.
- Release artifact download metadata lives in `service.json`.
- The runtime acquires archives from GitHub releases.
- Archives are extracted into runtime-managed state.
- Baseline services are installed and configured.
- Managed services start and expose their operator surfaces.
- Provider/core utility services report the expected provider-healthy state.
- The runtime API can stop the managed services after validation.

## If It Fails

Use the printed `run root`, `stdout`, and `stderr` paths first.

Common causes:

- Node.js is older than `22`.
- One of the required local ports is already in use.
- GitHub release downloads are blocked by network, proxy, antivirus, or rate limits.
- A previous run left a managed service process alive.

After fixing the cause, run the same script again. It creates a new temporary folder each time.
