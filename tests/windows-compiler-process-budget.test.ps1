$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "..\scripts\windows-compiler-process-budget.ps1")

function Assert-Equal($Actual, $Expected, [string]$Label) {
  if ($Actual -ne $Expected) {
    throw "$Label was '$Actual' instead of '$Expected'."
  }
}

function Assert-Sequence([int[]]$Actual, [int[]]$Expected, [string]$Label) {
  if ($Actual.Count -ne $Expected.Count) {
    throw "$Label had an unexpected number of waits."
  }
  for ($index = 0; $index -lt $Expected.Count; $index += 1) {
    Assert-Equal $Actual[$index] $Expected[$index] "$Label wait $index"
  }
}

function New-FakeCompilerProcess([bool[]]$ExitResults) {
  $outputCompletion = [Threading.Tasks.TaskCompletionSource[string]]::new()
  $errorCompletion = [Threading.Tasks.TaskCompletionSource[string]]::new()
  $outputCompletion.SetResult("")
  $errorCompletion.SetResult("")
  $process = [pscustomobject]@{
    waitArguments = [Collections.Generic.List[int]]::new()
    exitResults = [Collections.Generic.Queue[bool]]::new()
    killCount = 0
    StandardOutput = [pscustomobject]@{ task = $outputCompletion.Task }
    StandardError = [pscustomobject]@{ task = $errorCompletion.Task }
  }
  foreach ($result in $ExitResults) { $process.exitResults.Enqueue($result) }
  $process.StandardOutput | Add-Member -MemberType ScriptMethod -Name ReadToEndAsync -Value { return $this.task }
  $process.StandardError | Add-Member -MemberType ScriptMethod -Name ReadToEndAsync -Value { return $this.task }
  $process | Add-Member -MemberType ScriptMethod -Name WaitForExit -Value {
    param([int]$Milliseconds)
    $this.waitArguments.Add($Milliseconds)
    return $this.exitResults.Dequeue()
  }
  $process | Add-Member -MemberType ScriptMethod -Name Kill -Value { $this.killCount += 1 }
  return $process
}

# The first wait has consumed the entire 15 s budget. Kill is requested, then
# only a zero-time state receipt is allowed; a non-settling owned process keeps
# its workspace for recovery and fails closed.
$nonSettling = New-FakeCompilerProcess @($false, $false)
$nonSettlingClock = [Collections.Generic.Queue[int64]]::new()
@(0, 0, 15000) | ForEach-Object { $nonSettlingClock.Enqueue($_) }
$nonSettlingResult = Invoke-BoundedOwnedCompilerProcess $nonSettling 15000 { $nonSettlingClock.Dequeue() }
Assert-Equal $nonSettlingResult.outcome "compiler_timeout_termination_unconfirmed" "non-settling timeout outcome"
Assert-Equal $nonSettlingResult.retainTemporaryRoot $true "non-settling timeout retention"
Assert-Equal $nonSettling.killCount 1 "non-settling timeout kill count"
Assert-Sequence $nonSettling.waitArguments.ToArray() @(15000, 0) "non-settling timeout"

# When the first wait returns before budget expiry, termination and stderr/stdout
# settlement receive only the remainder of that same 15 s budget.
$settling = New-FakeCompilerProcess @($false, $true)
$settlingClock = [Collections.Generic.Queue[int64]]::new()
@(0, 0, 5000, 6000) | ForEach-Object { $settlingClock.Enqueue($_) }
$settlingDrainBudget = -1
$settlingResult = Invoke-BoundedOwnedCompilerProcess $settling 15000 { $settlingClock.Dequeue() } {
  param([Threading.Tasks.Task[]]$Tasks, [int]$TimeoutMilliseconds)
  $script:settlingDrainBudget = $TimeoutMilliseconds
  return $true
}
Assert-Equal $settlingResult.outcome "compiler_timeout_terminated" "settled timeout outcome"
Assert-Equal $settlingResult.retainTemporaryRoot $false "settled timeout retention"
Assert-Equal $settling.killCount 1 "settled timeout kill count"
Assert-Sequence $settling.waitArguments.ToArray() @(15000, 10000) "settled timeout"
Assert-Equal $settlingDrainBudget 9000 "settled timeout drain budget"

# A completed compiler is still rejected when its captured stderr/stdout cannot
# drain before the remaining compiler budget. It is not re-killed because exit
# was already observed.
$drainFailure = New-FakeCompilerProcess @($true)
$drainClock = [Collections.Generic.Queue[int64]]::new()
@(0, 0, 12000) | ForEach-Object { $drainClock.Enqueue($_) }
$drainBudget = -1
$drainResult = Invoke-BoundedOwnedCompilerProcess $drainFailure 15000 { $drainClock.Dequeue() } {
  param([Threading.Tasks.Task[]]$Tasks, [int]$TimeoutMilliseconds)
  $script:drainBudget = $TimeoutMilliseconds
  return $false
}
Assert-Equal $drainResult.outcome "compiler_output_drain_unconfirmed" "stderr drain outcome"
Assert-Equal $drainResult.retainTemporaryRoot $true "stderr drain retention"
Assert-Equal $drainFailure.killCount 0 "stderr drain kill count"
Assert-Sequence $drainFailure.waitArguments.ToArray() @(15000) "stderr drain"
Assert-Equal $drainBudget 3000 "stderr drain remaining budget"

Write-Output "windows_compiler_process_budget_cases_passed"
