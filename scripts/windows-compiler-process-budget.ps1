function Get-CompilerMonotonicMilliseconds() {
  Set-StrictMode -Version Latest
  # Windows PowerShell 5 runs on .NET Framework, whose Environment does not
  # expose TickCount64. Stopwatch is monotonic on both supported shells and
  # keeps the compiler's original absolute budget independent of wall-clock
  # changes.
  return [int64](([Diagnostics.Stopwatch]::GetTimestamp() * 1000) / [Diagnostics.Stopwatch]::Frequency)
}

function Get-CompilerBudgetRemainingMilliseconds(
  [int64]$StartedAtMilliseconds,
  [int]$BudgetMilliseconds,
  [scriptblock]$NowMilliseconds
) {
  Set-StrictMode -Version Latest
  [int64]$elapsedMilliseconds = [Math]::Max(0, ([int64](& $NowMilliseconds) - $StartedAtMilliseconds))
  return [Math]::Max(0, $BudgetMilliseconds - $elapsedMilliseconds)
}

function Invoke-BoundedOwnedCompilerProcess(
  $Process,
  [int]$BudgetMilliseconds = 15000,
  [scriptblock]$NowMilliseconds = { Get-CompilerMonotonicMilliseconds },
  [scriptblock]$WaitForDrains = {
    param([Threading.Tasks.Task[]]$Tasks, [int]$TimeoutMilliseconds)
    return [Threading.Tasks.Task]::WaitAll($Tasks, $TimeoutMilliseconds)
  },
  [object]$StartedAtMilliseconds = $null,
  [switch]$StartProcess
) {
  Set-StrictMode -Version Latest
  # The verifier may establish this timestamp before configuring ProcessStartInfo.
  # Every subsequent launch, wait, termination, and drain uses this same budget.
  [int64]$startedAtMilliseconds = if ($null -ne $StartedAtMilliseconds) {
    $StartedAtMilliseconds
  } else {
    & $NowMilliseconds
  }

  if ($StartProcess) {
    try {
      if (-not $Process.Start()) {
        return [pscustomobject]@{
          outcome = "compiler_launch_failed"
          retainTemporaryRoot = $true
        }
      }
    } catch {
      return [pscustomobject]@{
        outcome = "compiler_launch_failed"
        retainTemporaryRoot = $true
      }
    }
  }

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
      # A stream that cannot settle within the single compiler deadline leaves
      # the phase receipt incomplete. Keep its uniquely-owned root instead of
      # entering an unbounded recursive deletion after the deadline.
      retainTemporaryRoot = $true
    }
  }

  return [pscustomobject]@{
    outcome = $(if ($timedOut) { "compiler_timeout_terminated" } else { "completed" })
    retainTemporaryRoot = $false
  }
}
