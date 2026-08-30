param()

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

function Add-ServiceLassoNativeMethod {
  param(
    [Reflection.Emit.TypeBuilder]$TypeBuilder,
    [string]$Name,
    [string]$Library,
    [Type]$ReturnType,
    [Type[]]$ParameterTypes,
    [bool]$SetLastError,
    [Runtime.InteropServices.CharSet]$CharSet
  )

  $attributes = [Reflection.MethodAttributes]::Public -bor
    [Reflection.MethodAttributes]::Static -bor
    [Reflection.MethodAttributes]::PinvokeImpl
  $method = $TypeBuilder.DefineMethod($Name, $attributes, $ReturnType, $ParameterTypes)
  $constructor = [Runtime.InteropServices.DllImportAttribute].GetConstructor([Type[]]@([String]))
  $fields = [Reflection.FieldInfo[]]@(
    [Runtime.InteropServices.DllImportAttribute].GetField("EntryPoint"),
    [Runtime.InteropServices.DllImportAttribute].GetField("SetLastError"),
    [Runtime.InteropServices.DllImportAttribute].GetField("PreserveSig"),
    [Runtime.InteropServices.DllImportAttribute].GetField("CallingConvention"),
    [Runtime.InteropServices.DllImportAttribute].GetField("CharSet")
  )
  $values = [Object[]]@(
    $Name,
    $SetLastError,
    $true,
    [Runtime.InteropServices.CallingConvention]::Winapi,
    $CharSet
  )
  $attribute = New-Object Reflection.Emit.CustomAttributeBuilder(
    $constructor,
    [Object[]]@($Library),
    $fields,
    $values
  )
  $method.SetCustomAttribute($attribute)
  $method.SetImplementationFlags([Reflection.MethodImplAttributes]::PreserveSig)
}

$assemblyName = New-Object Reflection.AssemblyName("ServiceLasso.ManagedLauncher")
$assembly = [AppDomain]::CurrentDomain.DefineDynamicAssembly(
  $assemblyName,
  [Reflection.Emit.AssemblyBuilderAccess]::Run
)
$module = $assembly.DefineDynamicModule("ServiceLasso.ManagedLauncher")
$builder = $module.DefineType(
  "ServiceLasso.ManagedLauncher.Native",
  [Reflection.TypeAttributes]"Public, Sealed, Abstract"
)
Add-ServiceLassoNativeMethod $builder "CreateJobObjectW" "kernel32.dll" ([IntPtr]) ([Type[]]@([IntPtr], [String])) $true ([Runtime.InteropServices.CharSet]::Unicode)
Add-ServiceLassoNativeMethod $builder "SetInformationJobObject" "kernel32.dll" ([Bool]) ([Type[]]@([IntPtr], [Int32], [IntPtr], [UInt32])) $true ([Runtime.InteropServices.CharSet]::Unicode)
Add-ServiceLassoNativeMethod $builder "CreateProcessW" "kernel32.dll" ([Bool]) ([Type[]]@([String], [Text.StringBuilder], [IntPtr], [IntPtr], [Bool], [UInt32], [IntPtr], [String], [IntPtr], [IntPtr])) $true ([Runtime.InteropServices.CharSet]::Unicode)
Add-ServiceLassoNativeMethod $builder "AssignProcessToJobObject" "kernel32.dll" ([Bool]) ([Type[]]@([IntPtr], [IntPtr])) $true ([Runtime.InteropServices.CharSet]::Unicode)
Add-ServiceLassoNativeMethod $builder "ResumeThread" "kernel32.dll" ([UInt32]) ([Type[]]@([IntPtr])) $true ([Runtime.InteropServices.CharSet]::Unicode)
Add-ServiceLassoNativeMethod $builder "WaitForSingleObject" "kernel32.dll" ([UInt32]) ([Type[]]@([IntPtr], [UInt32])) $true ([Runtime.InteropServices.CharSet]::Unicode)
Add-ServiceLassoNativeMethod $builder "GetExitCodeProcess" "kernel32.dll" ([Bool]) ([Type[]]@([IntPtr], [UInt32].MakeByRefType())) $true ([Runtime.InteropServices.CharSet]::Unicode)
Add-ServiceLassoNativeMethod $builder "TerminateProcess" "kernel32.dll" ([Bool]) ([Type[]]@([IntPtr], [UInt32])) $true ([Runtime.InteropServices.CharSet]::Unicode)
Add-ServiceLassoNativeMethod $builder "GetStdHandle" "kernel32.dll" ([IntPtr]) ([Type[]]@([Int32])) $true ([Runtime.InteropServices.CharSet]::Unicode)
Add-ServiceLassoNativeMethod $builder "GetFinalPathNameByHandleW" "kernel32.dll" ([UInt32]) ([Type[]]@([IntPtr], [Text.StringBuilder], [UInt32], [UInt32])) $true ([Runtime.InteropServices.CharSet]::Unicode)
Add-ServiceLassoNativeMethod $builder "CloseHandle" "kernel32.dll" ([Bool]) ([Type[]]@([IntPtr])) $true ([Runtime.InteropServices.CharSet]::Unicode)
$native = $builder.CreateType()

$jobHandle = [IntPtr]::Zero
$processHandle = [IntPtr]::Zero
$threadHandle = [IntPtr]::Zero
$processStarted = $false
$boundFiles = New-Object Collections.Generic.List[IO.FileStream]
$boundFilePaths = @{}

function ConvertTo-ServiceLassoCommandLineArgument([string]$Value) {
  if ($Value.Length -gt 0 -and $Value -notmatch '[\s"]') {
    return $Value
  }
  $result = New-Object Text.StringBuilder
  $null = $result.Append('"')
  $backslashes = 0
  foreach ($character in $Value.ToCharArray()) {
    if ($character -eq [char]'\') {
      $backslashes += 1
      continue
    }
    if ($character -eq [char]'"') {
      $null = $result.Append([char]'\', ($backslashes * 2) + 1)
      $null = $result.Append('"')
      $backslashes = 0
      continue
    }
    if ($backslashes -gt 0) {
      $null = $result.Append([char]'\', $backslashes)
      $backslashes = 0
    }
    $null = $result.Append($character)
  }
  if ($backslashes -gt 0) {
    $null = $result.Append([char]'\', $backslashes * 2)
  }
  $null = $result.Append('"')
  return $result.ToString()
}

function Test-ServiceLassoGateToken([string]$Path, [string]$ExpectedToken) {
  try {
    if (-not [IO.File]::Exists($Path)) {
      return $false
    }
    $actualToken = [IO.File]::ReadAllText($Path, [Text.Encoding]::UTF8).Trim()
    return [String]::Equals($actualToken, $ExpectedToken, [StringComparison]::Ordinal)
  } catch [IO.IOException] {
    return $false
  } catch [UnauthorizedAccessException] {
    return $false
  }
}

try {
  $encodedPayload = [Environment]::GetEnvironmentVariable("SERVICE_LASSO_MANAGED_LAUNCH_PAYLOAD", "Process")
  $gatePath = [Environment]::GetEnvironmentVariable("SERVICE_LASSO_MANAGED_LAUNCH_GATE", "Process")
  if ([String]::IsNullOrWhiteSpace($encodedPayload) -or [String]::IsNullOrWhiteSpace($gatePath)) {
    throw "Managed launch evidence was missing."
  }
  $payloadJson = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($encodedPayload))
  $payload = $payloadJson | ConvertFrom-Json
  if (
    [String]::IsNullOrWhiteSpace([string]$payload.executable) -or
    [String]::IsNullOrWhiteSpace([string]$payload.workingDirectory) -or
    [String]::IsNullOrWhiteSpace([string]$payload.ackPath) -or
    [String]::IsNullOrWhiteSpace([string]$payload.filesBoundPath) -or
    [String]::IsNullOrWhiteSpace([string]$payload.continuePath) -or
    [string]$payload.releaseToken -notmatch '^[0-9a-f]{64}$' -or
    [string]$payload.filesBoundToken -notmatch '^[0-9a-f]{64}$' -or
    [string]$payload.continueToken -notmatch '^[0-9a-f]{64}$' -or
    [string]$payload.ackToken -notmatch '^[0-9a-f]{64}$'
  ) {
    throw "Managed launch evidence was invalid."
  }
  [Environment]::SetEnvironmentVariable("SERVICE_LASSO_MANAGED_LAUNCH_PAYLOAD", $null, "Process")
  [Environment]::SetEnvironmentVariable("SERVICE_LASSO_MANAGED_LAUNCH_GATE", $null, "Process")

  $gateDeadline = [DateTime]::UtcNow.AddSeconds(45)
  while (-not (Test-ServiceLassoGateToken $gatePath ([string]$payload.releaseToken))) {
    if ([DateTime]::UtcNow -ge $gateDeadline) {
      throw "Managed launch gate timed out."
    }
    Start-Sleep -Milliseconds 25
  }

  $approvedFiles = @($payload.approvedFiles)
  if ($approvedFiles.Count -gt 256) {
    throw "Managed launch file evidence exceeded its bound."
  }
  for ($approvedIndex = 0; $approvedIndex -lt $approvedFiles.Count; $approvedIndex += 1) {
    $approvedFile = $approvedFiles[$approvedIndex]
    $approvedPath = [string]$approvedFile.file
    $approvedSha256 = [string]$approvedFile.sha256
    [int64]$approvedSize = $approvedFile.size
    if (
      [String]::IsNullOrWhiteSpace($approvedPath) -or
      $approvedSha256 -notmatch '^[0-9a-f]{64}$' -or
      $approvedSize -lt 0
    ) {
      throw "Managed launch file evidence was invalid."
    }
    $boundFile = [IO.File]::Open(
      $approvedPath,
      [IO.FileMode]::Open,
      [IO.FileAccess]::Read,
      [IO.FileShare]::Read
    )
    $boundFiles.Add($boundFile)
    if ($boundFile.Length -ne $approvedSize) {
      throw "Managed launch file size changed."
    }
    $sha256 = [Security.Cryptography.SHA256]::Create()
    try {
      $actualSha256 = [BitConverter]::ToString($sha256.ComputeHash($boundFile)).Replace("-", "").ToLowerInvariant()
    } finally {
      $sha256.Dispose()
    }
    if ($actualSha256 -ne $approvedSha256) {
      throw "Managed launch file digest changed."
    }
    $finalPathBuffer = New-Object Text.StringBuilder 32768
    $finalPathLength = $native::GetFinalPathNameByHandleW(
      $boundFile.SafeFileHandle.DangerousGetHandle(),
      $finalPathBuffer,
      [uint32]$finalPathBuffer.Capacity,
      [uint32]0
    )
    if ($finalPathLength -eq 0 -or $finalPathLength -ge $finalPathBuffer.Capacity) {
      $finalPathError = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
      throw (New-Object ComponentModel.Win32Exception($finalPathError, "Managed launch final path query failed."))
    }
    $finalPath = $finalPathBuffer.ToString()
    if ($finalPath.StartsWith("\\?\UNC\", [StringComparison]::OrdinalIgnoreCase)) {
      $finalPath = "\\" + $finalPath.Substring(8)
    } elseif ($finalPath.StartsWith("\\?\", [StringComparison]::OrdinalIgnoreCase)) {
      $finalPath = $finalPath.Substring(4)
    }
    if (-not [IO.Path]::IsPathRooted($finalPath)) {
      throw "Managed launch final path evidence was invalid."
    }
    $boundFilePaths[[string]$approvedIndex] = $finalPath
  }

  $resolvedExecutable = [string]$payload.executable
  [int]$executableBindingIndex = $payload.executableBindingIndex
  if ([bool]$payload.requireExecutableBinding -and $executableBindingIndex -lt 0) {
    throw "Managed executable was not bound to approved bytes."
  }
  if ($executableBindingIndex -ge 0) {
    $resolvedExecutable = [string]$boundFilePaths[[string]$executableBindingIndex]
    if ([String]::IsNullOrWhiteSpace($resolvedExecutable)) {
      throw "Managed executable binding was invalid."
    }
  }
  $resolvedArgs = @($payload.args | ForEach-Object { [string]$_ })
  foreach ($argumentBinding in @($payload.argumentBindings)) {
    [int]$argumentIndex = $argumentBinding.index
    [int]$bindingIndex = $argumentBinding.bindingIndex
    if ($argumentIndex -lt 0 -or $argumentIndex -ge $resolvedArgs.Count) {
      throw "Managed argument binding was invalid."
    }
    $boundPath = [string]$boundFilePaths[[string]$bindingIndex]
    if ([String]::IsNullOrWhiteSpace($boundPath)) {
      throw "Managed argument binding was invalid."
    }
    $resolvedArgs[$argumentIndex] = ([string]$argumentBinding.prefix) + $boundPath
  }
  [IO.File]::WriteAllText(
    [string]$payload.filesBoundPath,
    [string]$payload.filesBoundToken,
    (New-Object Text.UTF8Encoding($false))
  )
  $continueDeadline = [DateTime]::UtcNow.AddSeconds(45)
  while (-not (Test-ServiceLassoGateToken ([string]$payload.continuePath) ([string]$payload.continueToken))) {
    if ([DateTime]::UtcNow -ge $continueDeadline) {
      throw "Managed launch continuation timed out."
    }
    Start-Sleep -Milliseconds 25
  }

  $commandLineParts = @($resolvedExecutable) + @($resolvedArgs)
  $commandLineValue = ($commandLineParts |
    ForEach-Object { ConvertTo-ServiceLassoCommandLineArgument ([string]$_) }) -join " "

  $jobHandle = $native::CreateJobObjectW([IntPtr]::Zero, $null)
  if ($jobHandle -eq [IntPtr]::Zero) {
    $jobError = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
    throw (New-Object ComponentModel.Win32Exception($jobError, "Managed launch job creation failed."))
  }

  $jobInformationSize = if ([IntPtr]::Size -eq 8) { 144 } else { 108 }
  $jobInformation = [Runtime.InteropServices.Marshal]::AllocHGlobal($jobInformationSize)
  try {
    for ($offset = 0; $offset -lt $jobInformationSize; $offset += 4) {
      [Runtime.InteropServices.Marshal]::WriteInt32($jobInformation, $offset, 0)
    }
    [Runtime.InteropServices.Marshal]::WriteInt32($jobInformation, 16, 0x2000)
    if (-not $native::SetInformationJobObject($jobHandle, 9, $jobInformation, [uint32]$jobInformationSize)) {
      $jobInformationError = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
      throw (New-Object ComponentModel.Win32Exception($jobInformationError, "Managed launch job configuration failed."))
    }
  } finally {
    [Runtime.InteropServices.Marshal]::FreeHGlobal($jobInformation)
  }

  $startupInfoSize = if ([IntPtr]::Size -eq 8) { 104 } else { 68 }
  $startupInfo = [Runtime.InteropServices.Marshal]::AllocHGlobal($startupInfoSize)
  $processInformationSize = if ([IntPtr]::Size -eq 8) { 24 } else { 16 }
  $processInformation = [Runtime.InteropServices.Marshal]::AllocHGlobal($processInformationSize)
  try {
    for ($offset = 0; $offset -lt $startupInfoSize; $offset += 4) {
      [Runtime.InteropServices.Marshal]::WriteInt32($startupInfo, $offset, 0)
    }
    for ($offset = 0; $offset -lt $processInformationSize; $offset += 4) {
      [Runtime.InteropServices.Marshal]::WriteInt32($processInformation, $offset, 0)
    }
    [Runtime.InteropServices.Marshal]::WriteInt32($startupInfo, 0, $startupInfoSize)
    $flagsOffset = if ([IntPtr]::Size -eq 8) { 60 } else { 44 }
    $showWindowOffset = if ([IntPtr]::Size -eq 8) { 64 } else { 48 }
    $stdinOffset = if ([IntPtr]::Size -eq 8) { 80 } else { 56 }
    $stdoutOffset = if ([IntPtr]::Size -eq 8) { 88 } else { 60 }
    $stderrOffset = if ([IntPtr]::Size -eq 8) { 96 } else { 64 }
    [Runtime.InteropServices.Marshal]::WriteInt32($startupInfo, $flagsOffset, 0x101)
    [Runtime.InteropServices.Marshal]::WriteInt16($startupInfo, $showWindowOffset, 0)
    [Runtime.InteropServices.Marshal]::WriteIntPtr($startupInfo, $stdinOffset, $native::GetStdHandle(-10))
    [Runtime.InteropServices.Marshal]::WriteIntPtr($startupInfo, $stdoutOffset, $native::GetStdHandle(-11))
    [Runtime.InteropServices.Marshal]::WriteIntPtr($startupInfo, $stderrOffset, $native::GetStdHandle(-12))

    $commandLine = New-Object Text.StringBuilder $commandLineValue
    if (-not $native::CreateProcessW(
      $resolvedExecutable,
      $commandLine,
      [IntPtr]::Zero,
      [IntPtr]::Zero,
      $true,
      [uint32]0x00000004,
      [IntPtr]::Zero,
      [string]$payload.workingDirectory,
      $startupInfo,
      $processInformation
    )) {
      $createError = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
      throw (New-Object ComponentModel.Win32Exception($createError, "Managed target creation failed."))
    }
    $processHandle = [Runtime.InteropServices.Marshal]::ReadIntPtr($processInformation, 0)
    $threadHandle = [Runtime.InteropServices.Marshal]::ReadIntPtr($processInformation, [IntPtr]::Size)
    $targetPidOffset = if ([IntPtr]::Size -eq 8) { 16 } else { 8 }
    $targetPid = [Runtime.InteropServices.Marshal]::ReadInt32($processInformation, $targetPidOffset)
  } finally {
    [Runtime.InteropServices.Marshal]::FreeHGlobal($startupInfo)
    [Runtime.InteropServices.Marshal]::FreeHGlobal($processInformation)
  }

  if ($processHandle -eq [IntPtr]::Zero -or $threadHandle -eq [IntPtr]::Zero -or $targetPid -le 0) {
    throw "Managed target process evidence was invalid."
  }
  if (-not $native::AssignProcessToJobObject($jobHandle, $processHandle)) {
    $assignError = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
    throw (New-Object ComponentModel.Win32Exception($assignError, "Managed target job assignment failed."))
  }
  if ($native::ResumeThread($threadHandle) -eq [uint32]::MaxValue) {
    $resumeError = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
    throw (New-Object ComponentModel.Win32Exception($resumeError, "Managed target resume failed."))
  }
  $processStarted = $true
  if (-not $native::CloseHandle($threadHandle)) {
    $threadCloseError = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
    throw (New-Object ComponentModel.Win32Exception($threadCloseError, "Managed target thread handle close failed."))
  }
  $threadHandle = [IntPtr]::Zero
  $acknowledgment = [pscustomobject]@{
    token = [string]$payload.ackToken
    pid = $targetPid
  } | ConvertTo-Json -Compress
  [IO.File]::WriteAllText([string]$payload.ackPath, $acknowledgment, (New-Object Text.UTF8Encoding($false)))

  $waitResult = $native::WaitForSingleObject($processHandle, [uint32]::MaxValue)
  if ($waitResult -ne 0) {
    throw "Managed target wait failed."
  }
  [uint32]$exitCode = 1
  if (-not $native::GetExitCodeProcess($processHandle, [ref]$exitCode)) {
    $exitCodeError = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
    throw (New-Object ComponentModel.Win32Exception($exitCodeError, "Managed target exit-code query failed."))
  }
  exit ([int]$exitCode)
} catch {
  exit 1
} finally {
  foreach ($boundFile in $boundFiles) {
    $boundFile.Dispose()
  }
  if (-not $processStarted -and $processHandle -ne [IntPtr]::Zero) {
    $null = $native::TerminateProcess($processHandle, 1)
  }
  if ($threadHandle -ne [IntPtr]::Zero) {
    $null = $native::CloseHandle($threadHandle)
  }
  if ($processHandle -ne [IntPtr]::Zero) {
    $null = $native::CloseHandle($processHandle)
  }
  if ($jobHandle -ne [IntPtr]::Zero) {
    $null = $native::CloseHandle($jobHandle)
  }
}
