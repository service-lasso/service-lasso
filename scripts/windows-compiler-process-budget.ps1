Set-StrictMode -Version Latest

function Get-CompilerBudgetRemainingMilliseconds(
  [int64]$StartedAtMilliseconds,
  [int]$BudgetMilliseconds,
  [scriptblock]$NowMilliseconds
) {
  [int64]$elapsedMilliseconds = [Math]::Max(0, ([int64](& $NowMilliseconds) - $StartedAtMilliseconds))
  return [Math]::Max(0, $BudgetMilliseconds - $elapsedMilliseconds)
}

function Invoke-BoundedOwnedCompilerProcess(
  $Process,
  [int]$BudgetMilliseconds = 15000,
  [scriptblock]$NowMilliseconds = { [Environment]::TickCount64 },
  [scriptblock]$WaitForDrains = {
    param([Threading.Tasks.Task[]]$Tasks, [int]$TimeoutMilliseconds)
    return [Threading.Tasks.Task]::WaitAll($Tasks, $TimeoutMilliseconds)
  }
) {
  [int64]$startedAtMilliseconds = & $NowMilliseconds
  [Threading.Tasks.Task]$stdoutDrain = $Process.StandardOutput.ReadToEndAsync()
  [Threading.Tasks.Task]$stderrDrain = $Process.StandardError.ReadToEndAsync()
  $timedOut = $false

  $remainingMilliseconds = Get-CompilerBudgetRemainingMilliseconds $startedAtMilliseconds $BudgetMilliseconds $NowMilliseconds
  if (-not $Process.WaitForExit($remainingMilliseconds)) {
    $timedOut = $true
    try {
      $Process.Kill()
    } catch {
      return [pscustomobject]@{
        outcome = "compiler_timeout_termination_request_failed"
        retainTemporaryRoot = $true
      }
    }

    # A kill request is not a terminal receipt. Re-check only with time left in
    # the original compiler budget; at zero this is a non-blocking state check.
    $remainingMilliseconds = Get-CompilerBudgetRemainingMilliseconds $startedAtMilliseconds $BudgetMilliseconds $NowMilliseconds
    if (-not $Process.WaitForExit($remainingMilliseconds)) {
      return [pscustomobject]@{
        outcome = "compiler_timeout_termination_unconfirmed"
        retainTemporaryRoot = $true
      }
    }
  }

  $remainingMilliseconds = Get-CompilerBudgetRemainingMilliseconds $startedAtMilliseconds $BudgetMilliseconds $NowMilliseconds
  if (-not (& $WaitForDrains ([Threading.Tasks.Task[]]@($stdoutDrain, $stderrDrain)) $remainingMilliseconds)) {
    return [pscustomobject]@{
      outcome = $(if ($timedOut) { "compiler_timeout_output_drain_unconfirmed" } else { "compiler_output_drain_unconfirmed" })
      retainTemporaryRoot = $false
    }
  }

  return [pscustomobject]@{
    outcome = $(if ($timedOut) { "compiler_timeout_terminated" } else { "completed" })
    retainTemporaryRoot = $false
  }
}
