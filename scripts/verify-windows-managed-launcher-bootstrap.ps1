[CmdletBinding()]
param([switch]$Update)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
  throw "Windows managed-launcher bootstrap verification requires Windows."
}

$repoRoot = Split-Path -Parent $PSScriptRoot
$sourceRelativePath = "src/runtime/execution/windows-managed-launcher-native-bootstrap.c"
$managedRelativePath = "src/runtime/execution/windows-managed-launcher-managed.exe"
$binaryRelativePath = "src/runtime/execution/windows-managed-launcher-native.exe"
$provenanceRelativePath = "src/runtime/execution/windows-managed-launcher-native.provenance.json"
$sourcePath = Join-Path $repoRoot $sourceRelativePath
$managedPath = Join-Path $repoRoot $managedRelativePath
$binaryPath = Join-Path $repoRoot $binaryRelativePath
$provenancePath = Join-Path $repoRoot $provenanceRelativePath
$vsDevCmd = "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\Common7\Tools\VsDevCmd.bat"
$vcVars = Join-Path (Split-Path -Parent $vsDevCmd) "vsdevcmd/ext/vcvars.bat"
$recipe = "BOOTSTRAP-NATIVE-VCVARS-ENV-2"
$compilerOptions = @("/nologo", "/TC", "/O2", "/GS", "/MT", "/W4", "/link", "/Brepro", "bcrypt.lib")

if (-not [IO.File]::Exists($vsDevCmd)) { throw "The trusted Visual Studio native compiler environment was unavailable." }
if (-not [IO.File]::Exists($sourcePath) -or -not [IO.File]::Exists($managedPath)) { throw "The native bootstrap source or managed launcher was missing." }

function Get-Sha256Hex([byte[]]$bytes) {
  $sha256 = [Security.Cryptography.SHA256]::Create()
  try { return [BitConverter]::ToString($sha256.ComputeHash($bytes)).Replace("-", "").ToLowerInvariant() }
  finally { $sha256.Dispose() }
}

function Get-NormalizedNativePeBytes([string]$path) {
  [byte[]]$bytes = [IO.File]::ReadAllBytes($path)
  if ($bytes.Length -lt 512 -or $bytes[0] -ne 0x4d -or $bytes[1] -ne 0x5a) { throw "The native bootstrap was not a PE image." }
  $peOffset = [BitConverter]::ToInt32($bytes, 0x3c)
  if ($peOffset -lt 0x40 -or $peOffset + 12 -gt $bytes.Length -or $bytes[$peOffset] -ne 0x50 -or $bytes[$peOffset + 1] -ne 0x45) { throw "The native bootstrap PE headers were invalid." }
  [Array]::Clear($bytes, $peOffset + 8, 4)
  return $bytes
}

function Test-ByteArrayEqual([byte[]]$left, [byte[]]$right) {
  if ($left.Length -ne $right.Length) { return $false }
  for ($index = 0; $index -lt $left.Length; $index += 1) {
    if ($left[$index] -ne $right[$index]) { return $false }
  }
  return $true
}

function Get-CanonicalProvenanceJson([string]$sourceSha256, [string]$managedSha256, [int64]$managedLength, [string]$binarySha256, [int64]$binaryLength) {
  return (@(
    '{',
    '  "schemaVersion": 1,',
    '  "compiler": {',
    '    "family": "Microsoft Visual C++ Build Tools native compiler",',
    '    "path": "Visual Studio 2022 Build Tools via BOOTSTRAP-NATIVE-VCVARS-ENV-2",',
    '    "options": [',
    '      "/nologo",',
    '      "/TC",',
    '      "/O2",',
    '      "/GS",',
    '      "/MT",',
    '      "/W4",',
    '      "/link",',
    '      "/Brepro",',
    '      "bcrypt.lib"',
    '    ]',
    '  },',
    '  "source": {',
    ('    "path": "{0}",' -f $sourceRelativePath),
    ('    "sha256": "{0}"' -f $sourceSha256),
    '  },',
    '  "managedLauncher": {',
    ('    "path": "{0}",' -f $managedRelativePath),
    ('    "sha256": "{0}",' -f $managedSha256),
    ('    "byteLength": {0}' -f $managedLength),
    '  },',
    '  "binary": {',
    ('    "path": "{0}",' -f $binaryRelativePath),
    ('    "sha256": "{0}",' -f $binarySha256),
    ('    "byteLength": {0},' -f $binaryLength),
    '    "peTimestamp": "zero",',
    '    "clrMetadata": "absent"',
    '  }',
    '}',
    ''
  ) -join "`n")
}

[byte[]]$sourceBytes = [IO.File]::ReadAllBytes($sourcePath)
[byte[]]$managedBytes = [IO.File]::ReadAllBytes($managedPath)
$sourceSha256 = Get-Sha256Hex $sourceBytes
$managedSha256 = Get-Sha256Hex $managedBytes
$sourceText = [Text.Encoding]::UTF8.GetString($sourceBytes)
$digestDeclaration = [regex]::Match($sourceText, 'MANAGED_LAUNCHER_SHA256\[32\]\s*=\s*\{([^}]+)\}', [Text.RegularExpressions.RegexOptions]::Singleline)
$digestValues = @([regex]::Matches($digestDeclaration.Groups[1].Value, '0x([a-fA-F0-9]{2})') | ForEach-Object { $_.Groups[1].Value.ToLowerInvariant() })
if ($managedBytes.Length -ne 39936 -or $sourceText -notmatch 'MANAGED_LAUNCHER_BYTE_LENGTH\s+39936LL' -or $digestValues.Count -ne 32 -or ($digestValues -join '') -cne $managedSha256) {
  throw "Native bootstrap source did not pin the managed launcher identity."
}
$script:NativeToolOwners = [Collections.Generic.Dictionary[string,object]]::new([StringComparer]::Ordinal)
$temporaryRoot = Join-Path ([IO.Path]::GetTempPath()) ("service-lasso-native-bootstrap-" + [Guid]::NewGuid().ToString("N"))
  # Retain every original attempt, including failed initialization/compiler output.
  $null = New-Item -ItemType Directory -Path $temporaryRoot -ErrorAction Stop
  $childTemp = Join-Path $temporaryRoot "temp"
  $null = New-Item -ItemType Directory -Path $childTemp -ErrorAction Stop
  $childEnvironment = [Collections.Generic.Dictionary[string,string]]::new([StringComparer]::OrdinalIgnoreCase)
  foreach ($name in @("PUBLIC", "PROCESSOR_IDENTIFIER", "SystemRoot", "PROCESSOR_REVISION", "ProgramW6432", "PROCESSOR_ARCHITECTURE", "SystemDrive", "ProgramFiles", "APPDATA", "USERPROFILE", "OS", "LOCALAPPDATA", "ProgramFiles(x86)", "WINDIR", "ProgramData", "NUMBER_OF_PROCESSORS", "PROCESSOR_LEVEL", "COMSPEC")) {
    $value = [Environment]::GetEnvironmentVariable($name)
    if ([string]::IsNullOrEmpty($value)) { throw "A required minimal child environment input was unavailable: $name" }
    $childEnvironment.Add($name, $value)
  }
  $childEnvironment.Add("TEMP", $childTemp)
  $childEnvironment.Add("TMP", $childTemp)
  $childEnvironment.Add("PATH", "$env:SystemRoot\System32;$env:SystemRoot;$env:SystemRoot\System32\Wbem")
  $childEnvironment.Add("VSCMD_SKIP_SENDTELEMETRY", "1")
  if (-not [IO.File]::Exists($vcVars)) { throw "The selected native compiler extension was unavailable." }
  $initializePath = Join-Path $temporaryRoot "initialize-native-env.cmd"
  $initializeText = @(
    '@echo off',
    ('call "{0}" -no_logo -arch=x64 -no_ext' -f $vsDevCmd),
    'if errorlevel 1 exit /b 1',
    ('call "{0}"' -f $vcVars),
    'if errorlevel 1 exit /b 1',
    'set "INCLUDE=%__VSCMD_VCVARS_INCLUDE%%INCLUDE%"',
    'set "EXTERNAL_INCLUDE=%__VSCMD_VCVARS_INCLUDE%%EXTERNAL_INCLUDE%"',
    'set __VSCMD_VCVARS_INCLUDE=',
    'set',
    'exit /b 0',
    ''
  ) -join "`r`n"
  [IO.File]::WriteAllText($initializePath, $initializeText, [Text.UTF8Encoding]::new($false))
  function Get-NativeCmdInitializerArguments([string]$path) {
    if (-not [IO.Path]::IsPathFullyQualified($path) -or $path.IndexOfAny([char[]]'"%!^&|<>') -ge 0 -or $path.Contains("`r") -or $path.Contains("`n")) { throw "The initializer path cannot be represented in the closed CMD call grammar." }
    $full = [IO.Path]::GetFullPath($path)
    if ($full -notmatch '^[A-Za-z]:\\' -or $full.Contains('/')) { throw "The initializer requires an absolute Windows drive path." }
    # CMD /s removes only the first/last outer quotes. The inner quoted batch
    # path remains literal in call; no CRT-style ArgumentList escaping occurs.
    return '/u /d /s /c "call "' + $full + '""'
  }
  function Invoke-RetainedNativeTool([string]$file, [string[]]$arguments, $environment, [string]$label, [string]$nativeArguments = $null) {
    $start = [Diagnostics.ProcessStartInfo]::new()
    $start.FileName = $file
    $start.WorkingDirectory = $temporaryRoot
    $start.UseShellExecute = $false
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true
    $start.Environment.Clear()
    foreach ($entry in $environment.GetEnumerator()) { $start.Environment.Add($entry.Key, $entry.Value) }
    if ([string]::IsNullOrEmpty($nativeArguments)) { foreach ($argument in $arguments) { $start.ArgumentList.Add($argument) } }
    else { $start.Arguments = $nativeArguments }
    $key = "$temporaryRoot|$label"
    if ($script:NativeToolOwners.ContainsKey($key)) { throw "An original tool owner already exists; no retry." }
    $owner = @{ process = $null; stdoutRaw = $null; stderrRaw = $null; startAttempted = $false; startReturned = $false; started = $null; attached = $false; exitObserved = $false; exitCode = $null; settled = $false; gate = [Threading.ManualResetEventSlim]::new($false); errors = [Collections.Generic.List[object]]::new(); copies = @{ stdout = @{ source = $null; task = $null; terminal = $false; observation = $null }; stderr = @{ source = $null; task = $null; terminal = $false; observation = $null } } }
    $script:NativeToolOwners.Add($key, $owner)
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
        $failure = $_.Exception.ToString()
        $copy.terminal = $copy.task.IsCompleted
        $state = if ($copy.task.IsFaulted) { 'ACTUAL_COPY_FAULTED' } elseif ($copy.task.IsCanceled) { 'ACTUAL_COPY_CANCELED' } else { 'COPY_OBSERVATION_UNRESOLVED' }
        $owner.errors.Add(@{ phase = "$name-copy-observation"; exception = $failure })
      }
      $faults = @()
      if ($copy.task.IsFaulted -and $copy.task.Exception) { $faults = @($copy.task.Exception.Flatten().InnerExceptions | ForEach-Object { $_.ToString() }) }
      $copy.observation = @{ state = $state; terminalObserved = $copy.terminal; taskStatus = [string]$copy.task.Status; exception = $failure; allFaults = $faults }
    }
    function Retain-ActiveOriginalOwner {
      # The registry and this non-returning live invocation strongly own every
      # original resource. A custody file alone is never a live handoff/terminal.
      foreach ($name in @('stdout', 'stderr')) { if ($owner.copies.$name.task -and -not $owner.copies.$name.terminal) { Observe-OriginalCopy $name } }
      try { Write-OriginalToolRecord 'ACTIVE-CUSTODY' @{ state = 'ACTIVE_INVOCATION_RETAINS_UNRESOLVED_ORIGINAL_RESOURCES'; ownerKey = $key; invocationPid = $PID; recipe = $recipe; startAttempted = $owner.startAttempted; startReturned = $owner.startReturned; started = $owner.started; attached = $owner.attached; exitObserved = $owner.exitObserved; exitCode = $owner.exitCode; stdoutCopy = $owner.copies.stdout.observation; stderrCopy = $owner.copies.stderr.observation; errors = @($owner.errors); returned = $false; resourcesReleased = $false } }
      catch { $owner.errors.Add(@{ phase = 'custody-record'; exception = $_.Exception.ToString() }) }
      while ($true) { try { $owner.gate.Wait() } catch { $owner.errors.Add(@{ phase = 'custody-wait'; exception = $_.Exception.ToString() }) } }
    }
    try {
      $owner.stdoutRaw = [IO.File]::Open((Join-Path $temporaryRoot "$label.stdout.raw"), [IO.FileMode]::CreateNew)
      $owner.stderrRaw = [IO.File]::Open((Join-Path $temporaryRoot "$label.stderr.raw"), [IO.FileMode]::CreateNew)
      $owner.process = [Diagnostics.Process]::new(); $owner.process.StartInfo = $start
      try {
        $owner.startAttempted = $true; $owner.started = $owner.process.Start(); $owner.startReturned = $true
        $owner.attached = $owner.started
        if (-not $owner.started) { $owner.errors.Add(@{ phase = 'start'; exception = 'Original Start returned false' }) }
      } catch {
        $owner.errors.Add(@{ phase = 'start'; exception = $_.Exception.ToString() })
        try { $null = $owner.process.Id; $owner.attached = $true } catch { $owner.errors.Add(@{ phase = 'original-attachment-unobserved'; exception = $_.Exception.ToString() }) }
      }
      if ($owner.attached) {
        # Independent setup and observation: one fault never skips the other.
        foreach ($name in @('stdout', 'stderr')) {
          try {
            if ($name -eq 'stdout') { $source = $owner.process.StandardOutput.BaseStream; $destination = $owner.stdoutRaw }
            else { $source = $owner.process.StandardError.BaseStream; $destination = $owner.stderrRaw }
            $owner.copies.$name.source = $source
            $owner.copies.$name.task = $source.CopyToAsync($destination)
          } catch { $owner.errors.Add(@{ phase = "$name-copy-start"; exception = $_.Exception.ToString() }) }
        }
        try { $owner.process.WaitForExit(); $owner.exitCode = $owner.process.ExitCode; $owner.exitObserved = $true }
        catch { $owner.errors.Add(@{ phase = 'natural-exit'; exception = $_.Exception.ToString() }) }
        Observe-OriginalCopy 'stdout'
        Observe-OriginalCopy 'stderr'
        if (-not $owner.exitObserved) {
          try { if ($owner.process.HasExited) { $owner.exitCode = $owner.process.ExitCode; $owner.exitObserved = $true } }
          catch { $owner.errors.Add(@{ phase = 'available-original-exit'; exception = $_.Exception.ToString() }) }
        }
        if (-not $owner.exitObserved -or -not $owner.copies.stdout.terminal -or -not $owner.copies.stderr.terminal) { Retain-ActiveOriginalOwner }
      } elseif ($owner.startAttempted -and -not $owner.startReturned) { Retain-ActiveOriginalOwner }
      # Either each issued task and original exit is observed, or actual Start
      # false/pre-start failure issued neither a process nor any copy.
      $owner.settled = $true
    } catch {
      $owner.errors.Add(@{ phase = 'initiating-boundary'; exception = $_.Exception.ToString() })
      if ($owner.startAttempted -and -not $owner.settled) { Retain-ActiveOriginalOwner }
      $owner.settled = $true # pre-start only: no original process/copy issued
    }
    $releaseFailed = $false
    foreach ($name in @('stdout', 'stderr')) {
      if ($owner.copies.$name.source) { try { $owner.copies.$name.source.Dispose() } catch { $releaseFailed = $true; $owner.errors.Add(@{ phase = "$name-source-release"; exception = $_.Exception.ToString() }) } }
    }
    foreach ($name in @('stdoutRaw', 'stderrRaw')) {
      if ($owner.$name) {
        try { $owner.$name.Flush($true) } catch { $owner.errors.Add(@{ phase = "$name-flush"; exception = $_.Exception.ToString() }) }
        try { $owner.$name.Dispose() } catch { $releaseFailed = $true; $owner.errors.Add(@{ phase = "$name-release"; exception = $_.Exception.ToString() }) }
      }
    }
    if ($owner.process) { try { $owner.process.Dispose() } catch { $releaseFailed = $true; $owner.errors.Add(@{ phase = 'process-release'; exception = $_.Exception.ToString() }) } }
    if ($releaseFailed) { Retain-ActiveOriginalOwner }
    $completed = $owner.exitObserved -and $owner.copies.stdout.observation.state -eq 'ACTUAL_COPY_COMPLETED' -and $owner.copies.stderr.observation.state -eq 'ACTUAL_COPY_COMPLETED'
    Write-OriginalToolRecord 'result' @{ recipe = $recipe; tool = $file; arguments = $arguments; nativeArguments = $nativeArguments; startAttempted = $owner.startAttempted; startReturned = $owner.startReturned; started = $owner.started; completed = $completed; exitObserved = $owner.exitObserved; exitCode = $owner.exitCode; stdoutCopy = $owner.copies.stdout.observation; stderrCopy = $owner.copies.stderr.observation; exceptions = @($owner.errors); classification = $(if ($completed -and $owner.errors.Count -eq 0 -and $owner.exitCode -eq 0) { 'completed_success' } else { 'original_observed_failure' }) }
    $null = $script:NativeToolOwners.Remove($key)
    if (-not $completed -or $owner.errors.Count -or $owner.exitCode -ne 0) { throw "The original tool/copy outcomes failed; retained without retry." }
  }
  $cmdImage = [IO.Path]::GetFullPath((Join-Path $env:SystemRoot 'System32\cmd.exe'))
  $cmdArguments = Get-NativeCmdInitializerArguments $initializePath
  Invoke-RetainedNativeTool $cmdImage @() $childEnvironment 'initialize' $cmdArguments
  $initialized = [Collections.Generic.Dictionary[string,string]]::new([StringComparer]::OrdinalIgnoreCase)
  $rawEnvironment = [IO.File]::ReadAllBytes((Join-Path $temporaryRoot "initialize.stdout.raw"))
  if ($rawEnvironment.Length % 2 -ne 0) { throw "The initialized environment output was not UTF16LE." }
  foreach ($line in ([Text.UnicodeEncoding]::new($false, $false, $true).GetString($rawEnvironment) -split "\r?\n")) {
    if ($line.Length -eq 0) { continue }
    $separator = $line.IndexOf('=')
    if ($separator -lt 1) { throw "The initialized environment contained an invalid record." }
    $initialized.Add($line.Substring(0, $separator), $line.Substring($separator + 1))
  }
  if ($initialized['VSCMD_ARG_HOST_ARCH'] -ne 'x64' -or $initialized['VSCMD_ARG_TGT_ARCH'] -ne 'x64') { throw "The initialized native architecture was invalid." }
  foreach ($name in @('CL', '_CL_', 'LINK', '_LINK_')) { if ($initialized.ContainsKey($name)) { throw "An undeclared compiler override was present." } }
  foreach ($name in @('VCToolsInstallDir', 'VCToolsVersion', 'WindowsSdkDir', 'WindowsSDKVersion', 'PATH', 'INCLUDE', 'EXTERNAL_INCLUDE', 'LIB', 'LIBPATH')) {
    if (-not $initialized.ContainsKey($name) -or [string]::IsNullOrEmpty($initialized[$name])) { throw "A selected native dependency was unavailable: $name" }
  }
  [IO.File]::WriteAllText((Join-Path $temporaryRoot "PRIVATE-initialized-environment.json"), ($initialized | ConvertTo-Json -Depth 3), [Text.UTF8Encoding]::new($false))
  $cl = Join-Path $initialized['VCToolsInstallDir'] "bin/Hostx64/x64/cl.exe"
  if (-not [IO.File]::Exists($cl)) { throw "The selected absolute native compiler was unavailable." }
  $compiledPath = Join-Path $temporaryRoot "windows-managed-launcher-native.exe"
  $objectPath = Join-Path $temporaryRoot "windows-managed-launcher-native-bootstrap.obj"
  Invoke-RetainedNativeTool $cl @('/nologo', '/TC', '/O2', '/GS', '/MT', '/W4', $sourcePath, "/Fo:$objectPath", "/Fe:$compiledPath", '/link', '/Brepro', 'bcrypt.lib') $initialized "compile"
  if (-not [IO.File]::Exists($compiledPath)) { throw "Native bootstrap compilation did not produce an image." }
  [byte[]]$normalizedBinaryBytes = Get-NormalizedNativePeBytes $compiledPath
  $binarySha256 = Get-Sha256Hex $normalizedBinaryBytes
  $provenanceJson = Get-CanonicalProvenanceJson $sourceSha256 $managedSha256 $managedBytes.Length $binarySha256 $normalizedBinaryBytes.Length
  [byte[]]$provenanceBytes = (New-Object Text.UTF8Encoding($false, $true)).GetBytes($provenanceJson)
  if ($Update) {
    [IO.File]::WriteAllBytes($binaryPath, $normalizedBinaryBytes)
    [IO.File]::WriteAllBytes($provenancePath, $provenanceBytes)
  }
  if (-not [IO.File]::Exists($binaryPath) -or -not [IO.File]::Exists($provenancePath)) { throw "The shipped native bootstrap or provenance manifest was missing." }
  [byte[]]$shippedBytes = [IO.File]::ReadAllBytes($binaryPath)
  if (-not (Test-ByteArrayEqual $shippedBytes $normalizedBinaryBytes)) { throw "The shipped native bootstrap did not match the reproducible compiler output." }
  [byte[]]$shippedProvenance = [IO.File]::ReadAllBytes($provenancePath)
  if (-not (Test-ByteArrayEqual $shippedProvenance $provenanceBytes)) { throw "The native bootstrap provenance was not canonical." }
  if ([Text.Encoding]::ASCII.GetString($shippedBytes).Contains("BSJB")) { throw "The native bootstrap unexpectedly contains CLR metadata." }
  [pscustomobject]@{ result = "passed"; sourceSha256 = $sourceSha256; managedLauncherSha256 = $managedSha256; managedLauncherByteLength = $managedBytes.Length; binarySha256 = $binarySha256; binaryByteLength = $normalizedBinaryBytes.Length; clrMetadata = "absent" } | ConvertTo-Json -Compress
