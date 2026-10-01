$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "..\scripts\windows-compiler-process-budget.ps1")

function Assert-Equal($Actual, $Expected, [string]$Label) {
  if ($Actual -ne $Expected) {
    throw "$Label was '$Actual' instead of '$Expected'."
  }
}

function New-RealCompilerAdapterProcess([string]$Command) {
  $process = New-Object Diagnostics.Process
  $process.StartInfo.FileName = $env:ComSpec
  $process.StartInfo.Arguments = "/d /s /c `"$Command`""
  $process.StartInfo.UseShellExecute = $false
  $process.StartInfo.CreateNoWindow = $true
  $process.StartInfo.RedirectStandardOutput = $true
  $process.StartInfo.RedirectStandardError = $true
  return $process
}

function Complete-OwnedTestProcess($Process) {
  if (-not $Process.HasExited) {
    $Process.Kill()
    [void]$Process.WaitForExit(1000)
  }
}

# Use the real Diagnostics.Process adapter, rather than a synthetic process,
# for launch, timeout termination, stream-drain failure, and retained state.
$completed = New-RealCompilerAdapterProcess "exit 0"
try {
  $completedResult = Invoke-BoundedOwnedCompilerProcess $completed 15000 -StartProcess
  Assert-Equal $completedResult.outcome "completed" "completed real adapter outcome"
  Assert-Equal $completedResult.retainTemporaryRoot $false "completed real adapter retention"
} finally {
  Complete-OwnedTestProcess $completed
  $completed.Dispose()
}

$launchFailure = New-Object Diagnostics.Process
try {
  $launchFailure.StartInfo.FileName = Join-Path $env:TEMP ("service-lasso-missing-compiler-" + [Guid]::NewGuid().ToString("N") + ".exe")
  $launchFailure.StartInfo.UseShellExecute = $false
  $launchResult = Invoke-BoundedOwnedCompilerProcess $launchFailure 15000 -StartProcess
  Assert-Equal $launchResult.outcome "compiler_launch_failed" "launch failure outcome"
  Assert-Equal $launchResult.retainTemporaryRoot $true "launch failure retention"
} finally {
  $launchFailure.Dispose()
}

$nonSettling = New-RealCompilerAdapterProcess "ping -n 30 127.0.0.1 > nul"
try {
  $nonSettlingResult = Invoke-BoundedOwnedCompilerProcess $nonSettling 100 -StartProcess
  Assert-Equal $nonSettlingResult.outcome "compiler_timeout_termination_unconfirmed" "non-settling real adapter outcome"
  Assert-Equal $nonSettlingResult.retainTemporaryRoot $true "non-settling real adapter retention"
} finally {
  Complete-OwnedTestProcess $nonSettling
  $nonSettling.Dispose()
}

$drainFailure = New-RealCompilerAdapterProcess "exit 0"
try {
  $drainResult = Invoke-BoundedOwnedCompilerProcess $drainFailure 15000 -StartProcess -WaitForDrains {
    param([Threading.Tasks.Task[]]$Tasks, [int]$TimeoutMilliseconds)
    return $false
  }
  Assert-Equal $drainResult.outcome "compiler_output_drain_unconfirmed" "drain failure real adapter outcome"
  Assert-Equal $drainResult.retainTemporaryRoot $true "drain failure final retention"
} finally {
  Complete-OwnedTestProcess $drainFailure
  $drainFailure.Dispose()
}

Write-Output "windows_compiler_process_budget_real_adapter_cases_passed"
