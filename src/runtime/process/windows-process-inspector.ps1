param(
  [Parameter(Mandatory = $true)]
  [int]$ProcessId,
  [switch]$IncludeDescendants
)

$ErrorActionPreference = "Stop"
$OutputEncoding = [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

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

$assemblyName = New-Object Reflection.AssemblyName("ServiceLasso.NativeProcess")
$assembly = [AppDomain]::CurrentDomain.DefineDynamicAssembly(
  $assemblyName,
  [Reflection.Emit.AssemblyBuilderAccess]::Run
)
$module = $assembly.DefineDynamicModule("ServiceLasso.NativeProcess")
$builder = $module.DefineType(
  "ServiceLasso.NativeProcess.Inspector",
  [Reflection.TypeAttributes]"Public, Sealed, Abstract"
)
Add-ServiceLassoNativeMethod $builder "OpenProcess" "kernel32.dll" ([IntPtr]) ([Type[]]@([UInt32], [Bool], [Int32])) $true ([Runtime.InteropServices.CharSet]::Unicode)
Add-ServiceLassoNativeMethod $builder "CloseHandle" "kernel32.dll" ([Bool]) ([Type[]]@([IntPtr])) $true ([Runtime.InteropServices.CharSet]::Unicode)
Add-ServiceLassoNativeMethod $builder "GetProcessId" "kernel32.dll" ([UInt32]) ([Type[]]@([IntPtr])) $true ([Runtime.InteropServices.CharSet]::Unicode)
Add-ServiceLassoNativeMethod $builder "GetProcessTimes" "kernel32.dll" ([Bool]) ([Type[]]@([IntPtr], [IntPtr], [IntPtr], [IntPtr], [IntPtr])) $true ([Runtime.InteropServices.CharSet]::Unicode)
Add-ServiceLassoNativeMethod $builder "QueryFullProcessImageNameW" "kernel32.dll" ([Bool]) ([Type[]]@([IntPtr], [UInt32], [Text.StringBuilder], [UInt32].MakeByRefType())) $true ([Runtime.InteropServices.CharSet]::Unicode)
Add-ServiceLassoNativeMethod $builder "NtQueryInformationProcess" "ntdll.dll" ([Int32]) ([Type[]]@([IntPtr], [Int32], [IntPtr], [Int32], [Int32].MakeByRefType())) $false ([Runtime.InteropServices.CharSet]::Unicode)
Add-ServiceLassoNativeMethod $builder "CreateToolhelp32Snapshot" "kernel32.dll" ([IntPtr]) ([Type[]]@([UInt32], [UInt32])) $true ([Runtime.InteropServices.CharSet]::Unicode)
Add-ServiceLassoNativeMethod $builder "Process32FirstW" "kernel32.dll" ([Bool]) ([Type[]]@([IntPtr], [IntPtr])) $true ([Runtime.InteropServices.CharSet]::Unicode)
Add-ServiceLassoNativeMethod $builder "Process32NextW" "kernel32.dll" ([Bool]) ([Type[]]@([IntPtr], [IntPtr])) $true ([Runtime.InteropServices.CharSet]::Unicode)
$native = $builder.CreateType()

function Read-ServiceLassoCommandLine([IntPtr]$ProcessHandle) {
  $headerSize = if ([IntPtr]::Size -eq 8) { 16 } else { 8 }
  [int]$requiredLength = 0
  $null = $native::NtQueryInformationProcess(
    $ProcessHandle,
    60,
    [IntPtr]::Zero,
    0,
    [ref]$requiredLength
  )
  if ($requiredLength -lt $headerSize -or $requiredLength -gt (1024 * 1024)) {
    throw "Native process command line length was invalid."
  }

  $buffer = [Runtime.InteropServices.Marshal]::AllocHGlobal($requiredLength)
  try {
    [int]$returnedLength = 0
    $status = $native::NtQueryInformationProcess(
      $ProcessHandle,
      60,
      $buffer,
      $requiredLength,
      [ref]$returnedLength
    )
    if ($status -ne 0 -or $returnedLength -lt $headerSize -or $returnedLength -gt $requiredLength) {
      throw "Native process command line query failed."
    }

    $length = [uint16][Runtime.InteropServices.Marshal]::ReadInt16($buffer, 0)
    $maximumLength = [uint16][Runtime.InteropServices.Marshal]::ReadInt16($buffer, 2)
    $pointerOffset = if ([IntPtr]::Size -eq 8) { 8 } else { 4 }
    $valuePointer = [Runtime.InteropServices.Marshal]::ReadIntPtr($buffer, $pointerOffset)
    $bufferStart = $buffer.ToInt64()
    $bufferEnd = $bufferStart + [int64]$returnedLength
    $valueStart = $valuePointer.ToInt64()
    if ($valueStart -lt ($bufferStart + $headerSize) -or $valueStart -ge $bufferEnd) {
      throw "Native process command line evidence was invalid."
    }

    $valueOffset = $valueStart - $bufferStart
    $availableLength = $returnedLength - $valueOffset
    if (
      $length -eq 0 -or
      ($length % 2) -ne 0 -or
      ($maximumLength % 2) -ne 0 -or
      $length -gt $maximumLength -or
      $length -gt $availableLength -or
      $maximumLength -gt $availableLength
    ) {
      throw "Native process command line evidence was invalid."
    }

    $commandLine = [Runtime.InteropServices.Marshal]::PtrToStringUni($valuePointer, ($length / 2))
    if ([String]::IsNullOrWhiteSpace($commandLine)) {
      throw "Native process command line was empty."
    }
    return $commandLine
  } finally {
    [Runtime.InteropServices.Marshal]::FreeHGlobal($buffer)
  }
}

function Read-ServiceLassoParentProcessId([IntPtr]$ProcessHandle) {
  $informationSize = if ([IntPtr]::Size -eq 8) { 48 } else { 24 }
  $parentOffset = if ([IntPtr]::Size -eq 8) { 40 } else { 20 }
  $information = [Runtime.InteropServices.Marshal]::AllocHGlobal($informationSize)
  try {
    [int]$returnedLength = 0
    $status = $native::NtQueryInformationProcess(
      $ProcessHandle,
      0,
      $information,
      $informationSize,
      [ref]$returnedLength
    )
    if ($status -ne 0 -or $returnedLength -lt $informationSize -or $returnedLength -gt $informationSize) {
      throw "Native process parent query failed."
    }
    $parentProcessId = [Runtime.InteropServices.Marshal]::ReadIntPtr($information, $parentOffset).ToInt64()
    if ($parentProcessId -lt 0 -or $parentProcessId -gt [int]::MaxValue) {
      throw "Native process parent evidence was invalid."
    }
    return [int]$parentProcessId
  } finally {
    [Runtime.InteropServices.Marshal]::FreeHGlobal($information)
  }
}

function Get-ServiceLassoDescendantProcesses([int]$RootProcessId) {
  $snapshot = $native::CreateToolhelp32Snapshot([uint32]2, [uint32]0)
  if ($snapshot -eq [IntPtr]::Zero -or $snapshot.ToInt64() -eq -1) {
    $snapshotError = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
    throw (New-Object ComponentModel.Win32Exception($snapshotError, "Native process snapshot failed."))
  }

  $entrySize = if ([IntPtr]::Size -eq 8) { 568 } else { 556 }
  $parentOffset = if ([IntPtr]::Size -eq 8) { 32 } else { 24 }
  $entry = [Runtime.InteropServices.Marshal]::AllocHGlobal($entrySize)
  $rows = New-Object Collections.Generic.List[object]
  try {
    [Runtime.InteropServices.Marshal]::WriteInt32($entry, 0, $entrySize)
    $present = $native::Process32FirstW($snapshot, $entry)
    while ($present) {
      $candidateProcessId = [Runtime.InteropServices.Marshal]::ReadInt32($entry, 8)
      $candidateParentId = [Runtime.InteropServices.Marshal]::ReadInt32($entry, $parentOffset)
      if ($candidateProcessId -gt 0 -and $candidateParentId -ge 0) {
        $rows.Add([pscustomobject]@{ ProcessId = $candidateProcessId; ParentProcessId = $candidateParentId })
      }
      [Runtime.InteropServices.Marshal]::WriteInt32($entry, 0, $entrySize)
      $present = $native::Process32NextW($snapshot, $entry)
    }
    $enumerationError = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
    if ($enumerationError -ne 18) {
      throw (New-Object ComponentModel.Win32Exception($enumerationError, "Native process snapshot enumeration failed."))
    }
  } finally {
    [Runtime.InteropServices.Marshal]::FreeHGlobal($entry)
    if (-not $native::CloseHandle($snapshot)) {
      $snapshotCloseError = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
      throw (New-Object ComponentModel.Win32Exception($snapshotCloseError, "Native process snapshot handle close failed."))
    }
  }

  $childrenByParent = @{}
  foreach ($row in $rows) {
    $key = [string]$row.ParentProcessId
    if (-not $childrenByParent.ContainsKey($key)) {
      $childrenByParent[$key] = New-Object Collections.Generic.List[object]
    }
    $childrenByParent[$key].Add($row)
  }

  $descendants = New-Object Collections.Generic.List[object]
  $visited = New-Object Collections.Generic.HashSet[int]
  $queue = New-Object Collections.Generic.Queue[int]
  $null = $visited.Add($RootProcessId)
  $queue.Enqueue($RootProcessId)
  while ($queue.Count -gt 0) {
    $parent = $queue.Dequeue()
    $children = $childrenByParent[[string]$parent]
    if ($null -eq $children) {
      continue
    }
    foreach ($child in $children) {
      $childProcessId = [int]$child.ProcessId
      if ($visited.Add($childProcessId)) {
        $descendants.Add($child)
        $queue.Enqueue($childProcessId)
      }
    }
  }
  return $descendants.ToArray()
}

function Get-ServiceLassoProcessEvidence([int]$TargetProcessId) {
  $processHandle = $native::OpenProcess([uint32]0x1010, $false, $TargetProcessId)
  if ($processHandle -eq [IntPtr]::Zero) {
    $openError = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
    if ($openError -eq 87) {
      return [pscustomobject]@{ Status = "not_running" }
    }
    throw (New-Object ComponentModel.Win32Exception($openError, "Native process open failed."))
  }

  try {
    $actualProcessId = $native::GetProcessId($processHandle)
    if ($actualProcessId -ne $TargetProcessId) {
      throw "Native process ID changed."
    }

    $times = [Runtime.InteropServices.Marshal]::AllocHGlobal(32)
    try {
      if (-not $native::GetProcessTimes(
        $processHandle,
        $times,
        [IntPtr]::Add($times, 8),
        [IntPtr]::Add($times, 16),
        [IntPtr]::Add($times, 24)
      )) {
        $timeError = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
        throw (New-Object ComponentModel.Win32Exception($timeError, "Native process time query failed."))
      }
      $fileTimeBytes = New-Object byte[] 8
      [Runtime.InteropServices.Marshal]::Copy($times, $fileTimeBytes, 0, 8)
      $fileTime = [BitConverter]::ToInt64($fileTimeBytes, 0)
    } finally {
      [Runtime.InteropServices.Marshal]::FreeHGlobal($times)
    }

    $imagePath = New-Object Text.StringBuilder 32768
    [uint32]$imagePathLength = $imagePath.Capacity
    if (-not $native::QueryFullProcessImageNameW(
      $processHandle,
      0,
      $imagePath,
      [ref]$imagePathLength
    ) -or $imagePathLength -eq 0) {
      $imageError = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
      throw (New-Object ComponentModel.Win32Exception($imageError, "Native process image query failed."))
    }

    $commandLine = Read-ServiceLassoCommandLine $processHandle
    $parentProcessId = Read-ServiceLassoParentProcessId $processHandle
    return [pscustomobject]@{
      Status = "running"
      ProcessId = $TargetProcessId
      CreationDate = [DateTime]::FromFileTimeUtc($fileTime).ToString("o")
      ExecutablePath = $imagePath.ToString()
      CommandLine = $commandLine
      ParentProcessId = $parentProcessId
    }
  } finally {
    if (-not $native::CloseHandle($processHandle)) {
      $closeError = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
      throw (New-Object ComponentModel.Win32Exception($closeError, "Native process handle close failed."))
    }
  }
}

$descendantProcesses = if ($IncludeDescendants) {
  @(Get-ServiceLassoDescendantProcesses $ProcessId)
} else {
  @()
}
$rootEvidence = Get-ServiceLassoProcessEvidence $ProcessId
if (-not $IncludeDescendants) {
  $rootEvidence | ConvertTo-Json -Compress
  exit 0
}

$processes = New-Object Collections.Generic.List[object]
if ($rootEvidence.Status -eq "running") {
  $processes.Add($rootEvidence)
}
foreach ($descendantProcess in $descendantProcesses) {
  $descendantEvidence = Get-ServiceLassoProcessEvidence ([int]$descendantProcess.ProcessId)
  if ($descendantEvidence.Status -eq "running") {
    if ([int]$descendantEvidence.ParentProcessId -ne [int]$descendantProcess.ParentProcessId) {
      throw "Native process tree changed during inspection."
    }
    $processes.Add($descendantEvidence)
  }
}
[pscustomobject]@{
  Status = "tree"
  RootStatus = $rootEvidence.Status
  Processes = $processes.ToArray()
} | ConvertTo-Json -Compress -Depth 4
