[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$RunRoot,
  [Parameter(Mandatory = $true)]
  [string]$RepoRoot
)

$ErrorActionPreference = 'Stop'

function Get-Sha256Hex {
  param([Parameter(Mandatory = $true)][string]$Path)
  $stream = [System.IO.File]::OpenRead($Path)
  $hasher = [System.Security.Cryptography.SHA256]::Create()
  try {
    return ([System.BitConverter]::ToString($hasher.ComputeHash($stream))).Replace('-', '')
  }
  finally {
    $hasher.Dispose()
    $stream.Dispose()
  }
}

$workspaceRoot = Join-Path $RunRoot 'workspace'
$instanceRegistryPath = Join-Path $RunRoot 'registries\instances.json'
$hostPortRegistryPath = Join-Path $RunRoot 'registries\ports.json'
$stdoutPath = Join-Path $RunRoot 'stdout.log'
$stderrPath = Join-Path $RunRoot 'stderr.log'
$initialReceiptPath = Join-Path $RunRoot 'receipt.initial.json'
$finalReceiptPath = Join-Path $RunRoot 'receipt.final.json'

New-Item -ItemType Directory -Force -Path $workspaceRoot, (Split-Path -Parent $instanceRegistryPath), (Split-Path -Parent $hostPortRegistryPath) | Out-Null

# These three values are intentionally distinct and are assigned before the
# first build/test child is created. DEADLINE_TEST_ROOT is deliberately absent.
$env:SERVICE_LASSO_WORKSPACE_ROOT = $workspaceRoot
$env:SERVICE_LASSO_INSTANCE_REGISTRY_PATH = $instanceRegistryPath
$env:SERVICE_LASSO_HOST_PORT_REGISTRY_PATH = $hostPortRegistryPath

$nativePaths = @(
  'src/runtime/process/windows-process-inspector.cs',
  'src/runtime/process/windows-process-inspector.exe',
  'src/runtime/process/windows-process-inspector.provenance.json',
  'src/runtime/execution/windows-managed-launcher-native.cs',
  'tests/fixtures/windows-held-exit-probe.cs'
)
$nativeHashes = @{}
foreach ($relativePath in $nativePaths) {
  $nativeHashes[$relativePath] = Get-Sha256Hex (Join-Path $repoRoot $relativePath)
}

Push-Location $repoRoot
try {
  $head = (& git rev-parse HEAD).Trim()
  $tree = (& git show -s --format=%T $head).Trim()
  $initialReceipt = [ordered]@{
    schema = 'service-lasso.issue-1535.full-native-qualification.v1'
    status = 'running'
    startedAtUtc = (Get-Date).ToUniversalTime().ToString('o')
    candidateHead = $head
    candidateTree = $tree
    command = @('npm.cmd', 'test')
    inputIsolation = [ordered]@{
      SERVICE_LASSO_WORKSPACE_ROOT = $workspaceRoot
      SERVICE_LASSO_INSTANCE_REGISTRY_PATH = $instanceRegistryPath
      SERVICE_LASSO_HOST_PORT_REGISTRY_PATH = $hostPortRegistryPath
    }
    nativeSha256 = $nativeHashes
    stdout = $stdoutPath
    stderr = $stderrPath
  }
  $initialReceipt | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $initialReceiptPath -Encoding utf8

  $child = Start-Process -FilePath 'npm.cmd' -ArgumentList @('test') -WorkingDirectory $repoRoot -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath -PassThru
  $initialReceipt.childProcessId = $child.Id
  $initialReceipt | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $initialReceiptPath -Encoding utf8
  $child.WaitForExit()
  $actualExitCode = $child.ExitCode

  $finalReceipt = [ordered]@{
    schema = $initialReceipt.schema
    status = if ($actualExitCode -eq 0) { 'passed' } else { 'failed' }
    startedAtUtc = $initialReceipt.startedAtUtc
    completedAtUtc = (Get-Date).ToUniversalTime().ToString('o')
    candidateHead = $head
    candidateTree = $tree
    command = $initialReceipt.command
    childProcessId = $child.Id
    actualExitCode = $actualExitCode
    inputIsolation = $initialReceipt.inputIsolation
    nativeSha256 = $nativeHashes
    stdout = $stdoutPath
    stderr = $stderrPath
    stdoutSha256 = Get-Sha256Hex $stdoutPath
    stderrSha256 = Get-Sha256Hex $stderrPath
  }
  $finalReceipt | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $finalReceiptPath -Encoding utf8
  exit $actualExitCode
}
finally {
  Pop-Location
}
