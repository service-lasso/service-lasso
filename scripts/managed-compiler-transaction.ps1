  function Invoke-RetainedManagedCompiler([string]$file, [string[]]$arguments, $environment, [string]$OwnedRoot) {
    $temporaryRoot = $OwnedRoot
    $label = 'managed-compile'
    $recipe = 'MANAGED-CSC-RETAINED-1'
    $nativeArguments = $null
    if (-not (Get-Variable -Name ManagedCompilerOwners -Scope Script -ErrorAction SilentlyContinue)) {
      $script:ManagedCompilerOwners = New-Object 'Collections.Generic.Dictionary[string,object]'
    }
    $start = [Diagnostics.ProcessStartInfo]::new()
    $start.FileName = $file
    $start.WorkingDirectory = $temporaryRoot
    $start.UseShellExecute = $false
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true
    $start.RedirectStandardInput = $true
    $start.CreateNoWindow = $true
    $start.EnvironmentVariables.Clear()
    foreach ($entry in $environment.GetEnumerator()) { $start.EnvironmentVariables.Add($entry.Key, $entry.Value) }
    if ($null -ne $start.PSObject.Properties['ArgumentList']) {
      foreach ($argument in $arguments) { $start.ArgumentList.Add($argument) }
    } else {
      # Fixed compiler options and source/output file paths have no embedded
      # quote or trailing separator. Keep CRT quoting literal on Framework.
      foreach ($argument in $arguments) {
        if ($argument.Contains('"') -or $argument.Contains("`r") -or $argument.Contains("`n") -or $argument.Contains([string][char]0) -or $argument.EndsWith('\')) {
          throw 'Compiler argument is outside the fixed literal grammar.'
        }
      }
      $start.Arguments = (($arguments | ForEach-Object { '"' + $_ + '"' }) -join ' ')
    }
    $key = "$temporaryRoot|$label"
    if ($script:ManagedCompilerOwners.ContainsKey($key)) { throw "An original tool owner already exists; no retry." }
    $owner = @{ process = $null; stdinSource = $null; stdinClosed = $false; stdoutRaw = $null; stderrRaw = $null; startAttempted = $false; startReturned = $false; started = $null; attached = $false; exitObserved = $false; exitCode = $null; settled = $false; recordingFailed = $false; recordingFailure = $null; lastOriginalError = $null; primaryError = $null; errors = [Collections.Generic.List[object]]::new(); copies = @{ stdout = @{ source = $null; task = $null; terminal = $false; observation = $null }; stderr = @{ source = $null; task = $null; terminal = $false; observation = $null } } }
    $script:ManagedCompilerOwners.Add($key, $owner)
    function Add-OriginalToolError([string]$phase, $original) {
      $owner.lastOriginalError = $original
      if ($null -eq $owner.primaryError -and $original -is [Exception]) { $owner.primaryError = $original }
      try { $owner.errors.Add(@{ phase = $phase; exception = $original }) }
      catch { $owner.recordingFailure = $_.Exception; $owner.recordingFailed = $true }
    }
    function Write-OriginalToolRecord([string]$suffix, $record) {
      $bytes = [Text.UTF8Encoding]::new($false).GetBytes(($record | ConvertTo-Json -Depth 12))
      $stream = [IO.File]::Open((Join-Path $temporaryRoot "$label.$suffix.json"), [IO.FileMode]::CreateNew)
      try { $stream.Write($bytes, 0, $bytes.Length) } finally { $stream.Dispose() }
    }
    function Observe-OriginalCopy([string]$name) {
      $copy = $owner.copies.$name
      if ($null -eq $copy.task) { return }
      $state = 'ACTUAL_COPY_COMPLETED'; $failure = $null
      try { [void]($copy.task.GetAwaiter().GetResult()); $copy.terminal = $true }
      catch {
        $failure = $_.Exception
        $copy.terminal = $copy.task.IsCompleted
        $state = if ($copy.task.IsFaulted) { 'ACTUAL_COPY_FAULTED' } elseif ($copy.task.IsCanceled) { 'ACTUAL_COPY_CANCELED' } else { 'COPY_OBSERVATION_UNRESOLVED' }
        try { Add-OriginalToolError "$name-copy-observation" $failure } catch { $owner.recordingFailure = $_.Exception; $owner.recordingFailed = $true }
      }
      $faults = @()
      if ($copy.task.IsFaulted -and $copy.task.Exception) { $faults = @($copy.task.Exception.Flatten().InnerExceptions | ForEach-Object { $_.ToString() }) }
      $copy.observation = @{ state = $state; terminalObserved = $copy.terminal; taskStatus = [string]$copy.task.Status; exception = $failure; allFaults = $faults }
    }
    function Retain-ActiveOriginalOwner {
      # The registry and this non-returning live invocation strongly own every
      # original resource. A custody file alone is never a live handoff/terminal.
      try { foreach ($name in @('stdout', 'stderr')) { if ($owner.copies.$name.task -and -not $owner.copies.$name.terminal) { Observe-OriginalCopy $name } } }
      catch { try { Add-OriginalToolError 'retention-copy-observation' $_.Exception } catch { $owner.recordingFailure = $_.Exception; $owner.recordingFailed = $true } }
      try { Write-OriginalToolRecord 'ACTIVE-CUSTODY' @{ state = 'ACTIVE_INVOCATION_RETAINS_UNRESOLVED_ORIGINAL_RESOURCES'; ownerKey = $key; invocationPid = $PID; recipe = $recipe; startAttempted = $owner.startAttempted; startReturned = $owner.startReturned; started = $owner.started; attached = $owner.attached; exitObserved = $owner.exitObserved; exitCode = $owner.exitCode; stdoutCopy = $owner.copies.stdout.observation; stderrCopy = $owner.copies.stderr.observation; errors = @($owner.errors); returned = $false; resourcesReleased = $false } }
      catch { try { Add-OriginalToolError 'custody-record' $_.Exception } catch { $owner.recordingFailure = $_.Exception; $owner.recordingFailed = $true } }
      while ($true) { try { [Threading.Thread]::Sleep([Threading.Timeout]::Infinite) } catch { try { Add-OriginalToolError 'custody-wait' $_.Exception } catch { $owner.recordingFailure = $_.Exception; $owner.recordingFailed = $true } } }
    }
    try {
      $owner.stdoutRaw = [IO.File]::Open((Join-Path $temporaryRoot "$label.stdout.raw"), [IO.FileMode]::CreateNew)
      $owner.stderrRaw = [IO.File]::Open((Join-Path $temporaryRoot "$label.stderr.raw"), [IO.FileMode]::CreateNew)
      $owner.process = [Diagnostics.Process]::new(); $owner.process.StartInfo = $start
      try {
        $owner.startAttempted = $true; $owner.started = $owner.process.Start(); $owner.startReturned = $true
        $owner.attached = $owner.started
        if (-not $owner.started) { try { Add-OriginalToolError 'start' 'Original Start returned false' } catch { $owner.recordingFailure = $_.Exception; $owner.recordingFailed = $true } }
      } catch {
        try { Add-OriginalToolError 'start' $_.Exception } catch { $owner.recordingFailure = $_.Exception; $owner.recordingFailed = $true }
        try { $null = $owner.process.Id; $owner.attached = $true } catch { try { Add-OriginalToolError 'original-attachment-unobserved' $_.Exception } catch { $owner.recordingFailure = $_.Exception; $owner.recordingFailed = $true } }
      }
      if ($owner.attached) {
        try { $owner.stdinSource = $owner.process.StandardInput; $owner.stdinSource.Close(); $owner.stdinClosed = $true }
        catch { try { Add-OriginalToolError 'stdin-close' $_.Exception } catch { $owner.recordingFailure = $_.Exception; $owner.recordingFailed = $true } }
        # Independent setup and observation: one fault never skips the other.
        foreach ($name in @('stdout', 'stderr')) {
          try {
            if ($name -eq 'stdout') { $source = $owner.process.StandardOutput.BaseStream; $destination = $owner.stdoutRaw }
            else { $source = $owner.process.StandardError.BaseStream; $destination = $owner.stderrRaw }
            $owner.copies.$name.source = $source
            $owner.copies.$name.task = $source.CopyToAsync($destination)
          } catch { try { Add-OriginalToolError "$name-copy-start" $_.Exception } catch { $owner.recordingFailure = $_.Exception; $owner.recordingFailed = $true } }
        }
        try { $owner.process.WaitForExit(); $owner.exitCode = $owner.process.ExitCode; $owner.exitObserved = $true }
        catch { try { Add-OriginalToolError 'natural-exit' $_.Exception } catch { $owner.recordingFailure = $_.Exception; $owner.recordingFailed = $true } }
        Observe-OriginalCopy 'stdout'
        Observe-OriginalCopy 'stderr'
        if (-not $owner.exitObserved) {
          try { if ($owner.process.HasExited) { $owner.exitCode = $owner.process.ExitCode; $owner.exitObserved = $true } }
          catch { try { Add-OriginalToolError 'available-original-exit' $_.Exception } catch { $owner.recordingFailure = $_.Exception; $owner.recordingFailed = $true } }
        }
        if (-not $owner.stdinClosed -or -not $owner.exitObserved -or -not $owner.copies.stdout.terminal -or -not $owner.copies.stderr.terminal) { Retain-ActiveOriginalOwner }
      } elseif ($owner.startAttempted -and -not $owner.startReturned) { Retain-ActiveOriginalOwner }
      # Either each issued task and original exit is observed, or actual Start
      # false/pre-start failure issued neither a process nor any copy.
      $owner.settled = $true
    } catch {
      if (-not $owner.primaryError) { $owner.primaryError = $_.Exception }
      try { Add-OriginalToolError 'initiating-boundary' $_.Exception } catch { $owner.recordingFailure = $_.Exception; $owner.recordingFailed = $true }
      if ($owner.startAttempted -and -not $owner.settled) { Retain-ActiveOriginalOwner }
      $owner.settled = $true # pre-start only: no original process/copy issued
    }
    $releaseFailed = $false
    foreach ($name in @('stdout', 'stderr')) {
      if ($owner.copies.$name.source) { try { $owner.copies.$name.source.Dispose() } catch { $releaseFailed = $true; try { Add-OriginalToolError "$name-source-release" $_.Exception } catch { $owner.recordingFailure = $_.Exception; $owner.recordingFailed = $true } } }
    }
    foreach ($name in @('stdoutRaw', 'stderrRaw')) {
      if ($owner.$name) {
        try { $owner.$name.Flush($true) } catch { try { Add-OriginalToolError "$name-flush" $_.Exception } catch { $owner.recordingFailure = $_.Exception; $owner.recordingFailed = $true } }
        try { $owner.$name.Dispose() } catch { $releaseFailed = $true; try { Add-OriginalToolError "$name-release" $_.Exception } catch { $owner.recordingFailure = $_.Exception; $owner.recordingFailed = $true } }
      }
    }
    if ($owner.process) { try { $owner.process.Dispose() } catch { $releaseFailed = $true; try { Add-OriginalToolError 'process-release' $_.Exception } catch { $owner.recordingFailure = $_.Exception; $owner.recordingFailed = $true } } }
    if ($releaseFailed -or $owner.recordingFailed) { Retain-ActiveOriginalOwner }
    $completed = $owner.exitObserved -and $owner.copies.stdout.observation.state -eq 'ACTUAL_COPY_COMPLETED' -and $owner.copies.stderr.observation.state -eq 'ACTUAL_COPY_COMPLETED'
    try { Write-OriginalToolRecord 'result' @{ recipe = $recipe; tool = $file; arguments = $arguments; nativeArguments = $nativeArguments; startAttempted = $owner.startAttempted; startReturned = $owner.startReturned; started = $owner.started; completed = $completed; exitObserved = $owner.exitObserved; exitCode = $owner.exitCode; stdoutCopy = $owner.copies.stdout.observation; stderrCopy = $owner.copies.stderr.observation; exceptions = @($owner.errors); classification = $(if ($completed -and $owner.errors.Count -eq 0 -and -not $owner.recordingFailed -and $owner.exitCode -eq 0) { 'completed_success' } else { 'original_observed_failure' }) } } catch { try { Add-OriginalToolError 'result-observer' $_.Exception } catch { $owner.recordingFailure = $_.Exception; $owner.recordingFailed = $true } }
    if ($owner.recordingFailed) { Retain-ActiveOriginalOwner }
    $null = $script:ManagedCompilerOwners.Remove($key)
    if (-not $completed -or $owner.errors.Count -or $owner.recordingFailed -or $owner.exitCode -ne 0) { if ($owner.primaryError) { throw $owner.primaryError }; throw "The original tool/copy outcomes failed; retained without retry." }
  }
