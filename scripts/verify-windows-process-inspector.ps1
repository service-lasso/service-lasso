[CmdletBinding()]
param(
  [switch]$Update,
  [switch]$ManagedLauncherNative,
  [switch]$DirectorySyncHelper,
  [switch]$HeldExitFixture,
  [switch]$Behavioral
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
. (Join-Path $PSScriptRoot "windows-compiler-process-budget.ps1")

if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
  throw "Windows process-inspector provenance verification requires Windows."
}

$repoRoot = Split-Path -Parent $PSScriptRoot
$fixtureCount = $(if ($ManagedLauncherNative) { 1 } else { 0 }) + $(if ($DirectorySyncHelper) { 1 } else { 0 }) + $(if ($HeldExitFixture) { 1 } else { 0 })
if ($fixtureCount -gt 1) {
  throw "Select only one Windows native fixture."
}
$sourceRelativePath = if ($HeldExitFixture) {
  "tests/fixtures/windows-held-exit-probe.cs"
} elseif ($DirectorySyncHelper) {
  "src/runtime/operator/windows-directory-sync-helper.cs"
} elseif ($ManagedLauncherNative) {
  "src/runtime/execution/windows-managed-launcher-native.cs"
} else {
  "src/runtime/process/windows-process-inspector.cs"
}
$binaryRelativePath = if ($HeldExitFixture) {
  "tests/fixtures/windows-held-exit-probe.exe"
} elseif ($DirectorySyncHelper) {
  "src/runtime/operator/windows-directory-sync-helper.exe"
} elseif ($ManagedLauncherNative) {
  "src/runtime/execution/windows-managed-launcher-managed.exe"
} else {
  "src/runtime/process/windows-process-inspector.exe"
}
$provenanceRelativePath = if ($HeldExitFixture) {
  "tests/fixtures/windows-held-exit-probe.provenance.json"
} elseif ($DirectorySyncHelper) {
  "src/runtime/operator/windows-directory-sync-helper.provenance.json"
} elseif ($ManagedLauncherNative) {
  "src/runtime/execution/windows-managed-launcher-managed.provenance.json"
} else {
  "src/runtime/process/windows-process-inspector.provenance.json"
}
$sourcePath = Join-Path $repoRoot $sourceRelativePath
$binaryPath = Join-Path $repoRoot $binaryRelativePath
$provenancePath = Join-Path $repoRoot $provenanceRelativePath
$compilerPath = Join-Path $env:WINDIR "Microsoft.NET/Framework64/v4.0.30319/csc.exe"
$compilerOptions = @(
  "/nologo",
  "/target:exe",
  "/platform:anycpu",
  "/optimize+"
)
if ($ManagedLauncherNative) {
  $compilerOptions += "/reference:System.Web.Extensions.dll"
}
if ($HeldExitFixture) {
  $compilerOptions += "/debug-"
}

if (-not [IO.Path]::IsPathRooted($compilerPath) -or -not [IO.File]::Exists($compilerPath)) {
  throw "The trusted Windows .NET Framework C# compiler was unavailable."
}
$compilerItem = Get-Item -LiteralPath $compilerPath
if ($compilerItem.VersionInfo.FileMajorPart -ne 4 -or $compilerItem.VersionInfo.FileMinorPart -lt 8) {
  throw "Windows process-inspector provenance requires the trusted .NET Framework 4.8 compiler family."
}

function Get-Sha256Hex([byte[]]$Bytes) {
  $sha256 = [Security.Cryptography.SHA256]::Create()
  try {
    return [BitConverter]::ToString($sha256.ComputeHash($Bytes)).Replace("-", "").ToLowerInvariant()
  } finally {
    $sha256.Dispose()
  }
}

function Assert-ExactPropertyNames($Object, [string[]]$ExpectedNames, [string]$Label) {
  [string[]]$actualNames = @($Object.PSObject.Properties | ForEach-Object { $_.Name })
  if ($actualNames.Length -ne $ExpectedNames.Length) {
    throw "The Windows process-inspector $Label property set was invalid."
  }
  for ($index = 0; $index -lt $ExpectedNames.Length; $index += 1) {
    if ($actualNames[$index] -cne $ExpectedNames[$index]) {
      throw "The Windows process-inspector $Label property set was invalid."
    }
  }
}

function Test-ProvenanceJsonInteger($Value) {
  return $Value -is [System.Int32] -or $Value -is [System.Int64]
}

function Test-ProvenanceExactString($Value, [string]$ExpectedValue) {
  return $Value -is [System.String] -and [String]::Equals($Value, $ExpectedValue, [StringComparison]::Ordinal)
}

function Get-CanonicalProvenanceJson(
  [string]$SourceSha256,
  [string]$BinarySha256,
  [int64]$BinaryByteLength
) {
  $compilerOptionLines = @()
  for ($index = 0; $index -lt $compilerOptions.Length; $index += 1) {
    $suffix = if ($index -lt $compilerOptions.Length - 1) { ',' } else { '' }
    $compilerOptionLines += ('      "{0}"{1}' -f $compilerOptions[$index], $suffix)
  }
  $provenanceLines = @(
    '{',
    '  "schemaVersion": 1,',
    '  "compiler": {',
    '    "family": "Microsoft .NET Framework 4.8 C# compiler",',
    '    "path": "%WINDIR%/Microsoft.NET/Framework64/v4.0.30319/csc.exe",',
    '    "options": ['
  )
  $provenanceLines += $compilerOptionLines
  $provenanceLines += @(
    '    ]',
    '  },',
    '  "source": {',
    ('    "path": "{0}",' -f $sourceRelativePath),
    ('    "sha256": "{0}"' -f $SourceSha256),
    '  },',
    '  "binary": {',
    ('    "path": "{0}",' -f $binaryRelativePath),
    ('    "sha256": "{0}",' -f $BinarySha256),
    ('    "byteLength": {0},' -f $BinaryByteLength),
    '    "peTimestamp": "zero",',
    '    "moduleVersionId": "zero"',
    '  }',
    '}'
  )
  return $provenanceLines -join "`n"
}

function Assert-CanonicalProvenanceBytes([byte[]]$ActualBytes, [byte[]]$ExpectedBytes) {
  if ($ActualBytes.Length -ne $ExpectedBytes.Length) {
    throw "The Windows process-inspector provenance bytes were not canonical."
  }
  for ($index = 0; $index -lt $ExpectedBytes.Length; $index += 1) {
    if ($ActualBytes[$index] -ne $ExpectedBytes[$index]) {
      throw "The Windows process-inspector provenance bytes were not canonical."
    }
  }
}

function Assert-CanonicalProvenanceBytesRejected(
  [byte[]]$CandidateBytes,
  [byte[]]$ExpectedBytes,
  [string]$CaseName
) {
  $rejected = $false
  try {
    Assert-CanonicalProvenanceBytes $CandidateBytes $ExpectedBytes
  } catch {
    $rejected = $true
  }
  if (-not $rejected) {
    throw "The Windows process-inspector provenance byte negative case was accepted: $CaseName."
  }
}

function Assert-ProvenanceManifest(
  $ActualProvenance,
  $ExpectedProvenance,
  [string]$SourceSha256,
  [string]$BinarySha256,
  [int64]$BinaryByteLength
) {
  Assert-ExactPropertyNames $ActualProvenance @("schemaVersion", "compiler", "source", "binary") "provenance"
  Assert-ExactPropertyNames $ActualProvenance.compiler @("family", "path", "options") "compiler provenance"
  Assert-ExactPropertyNames $ActualProvenance.source @("path", "sha256") "source provenance"
  Assert-ExactPropertyNames $ActualProvenance.binary @("path", "sha256", "byteLength", "peTimestamp", "moduleVersionId") "binary provenance"
  $actualCompilerOptions = $ActualProvenance.compiler.options
  $compilerOptionsMatch = $actualCompilerOptions -is [System.Array] -and $actualCompilerOptions.Length -eq $compilerOptions.Length
  if ($compilerOptionsMatch) {
    for ($index = 0; $index -lt $compilerOptions.Length; $index += 1) {
      if (-not (Test-ProvenanceExactString $actualCompilerOptions[$index] $compilerOptions[$index])) {
        $compilerOptionsMatch = $false
        break
      }
    }
  }
  if (
    -not (Test-ProvenanceJsonInteger $ActualProvenance.schemaVersion) -or
    $ActualProvenance.schemaVersion -ne 1 -or
    -not (Test-ProvenanceExactString $ActualProvenance.compiler.family $ExpectedProvenance.compiler.family) -or
    -not (Test-ProvenanceExactString $ActualProvenance.compiler.path $ExpectedProvenance.compiler.path) -or
    -not $compilerOptionsMatch -or
    -not (Test-ProvenanceExactString $ActualProvenance.source.path $sourceRelativePath) -or
    -not (Test-ProvenanceExactString $ActualProvenance.source.sha256 $SourceSha256) -or
    -not (Test-ProvenanceExactString $ActualProvenance.binary.path $binaryRelativePath) -or
    -not (Test-ProvenanceExactString $ActualProvenance.binary.sha256 $BinarySha256) -or
    -not (Test-ProvenanceJsonInteger $ActualProvenance.binary.byteLength) -or
    $ActualProvenance.binary.byteLength -ne $BinaryByteLength -or
    -not (Test-ProvenanceExactString $ActualProvenance.binary.peTimestamp "zero") -or
    -not (Test-ProvenanceExactString $ActualProvenance.binary.moduleVersionId "zero")
  ) {
    throw "The Windows process-inspector provenance manifest did not match source and binary content."
  }
}

function Copy-ProvenanceObject($Provenance) {
  return $Provenance | ConvertTo-Json -Depth 6 | ConvertFrom-Json
}

function Assert-ProvenanceRejected(
  $Candidate,
  $ExpectedProvenance,
  [string]$SourceSha256,
  [string]$BinarySha256,
  [int64]$BinaryByteLength,
  [string]$CaseName
) {
  $rejected = $false
  try {
    Assert-ProvenanceManifest $Candidate $ExpectedProvenance $SourceSha256 $BinarySha256 $BinaryByteLength
  } catch {
    $rejected = $true
  }
  if (-not $rejected) {
    throw "The Windows process-inspector provenance negative case was accepted: $CaseName."
  }
}

function Invoke-ProvenanceNegativeTests(
  $ActualProvenance,
  $ExpectedProvenance,
  [string]$SourceSha256,
  [string]$BinarySha256,
  [int64]$BinaryByteLength
) {
  $candidate = Copy-ProvenanceObject $ActualProvenance
  $candidate | Add-Member -NotePropertyName unexpected -NotePropertyValue $true
  Assert-ProvenanceRejected $candidate $ExpectedProvenance $SourceSha256 $BinarySha256 $BinaryByteLength "extra property"

  $candidate = [pscustomobject][ordered]@{
    compiler = $ActualProvenance.compiler
    schemaVersion = $ActualProvenance.schemaVersion
    source = $ActualProvenance.source
    binary = $ActualProvenance.binary
  }
  Assert-ProvenanceRejected $candidate $ExpectedProvenance $SourceSha256 $BinarySha256 $BinaryByteLength "reordered properties"

  $candidate = Copy-ProvenanceObject $ActualProvenance
  $candidate.schemaVersion = "1"
  Assert-ProvenanceRejected $candidate $ExpectedProvenance $SourceSha256 $BinarySha256 $BinaryByteLength "string schema"
  $candidate = Copy-ProvenanceObject $ActualProvenance
  $candidate.schemaVersion = 1.5
  Assert-ProvenanceRejected $candidate $ExpectedProvenance $SourceSha256 $BinarySha256 $BinaryByteLength "non-integral schema"
  $candidate = Copy-ProvenanceObject $ActualProvenance
  $candidate.binary.byteLength = "$BinaryByteLength"
  Assert-ProvenanceRejected $candidate $ExpectedProvenance $SourceSha256 $BinarySha256 $BinaryByteLength "string binary length"
  $candidate = Copy-ProvenanceObject $ActualProvenance
  $candidate.binary.byteLength = $BinaryByteLength + 0.5
  Assert-ProvenanceRejected $candidate $ExpectedProvenance $SourceSha256 $BinarySha256 $BinaryByteLength "non-integral binary length"

  $candidate = Copy-ProvenanceObject $ActualProvenance
  $candidate.compiler.path = "untrusted/compiler.exe"
  Assert-ProvenanceRejected $candidate $ExpectedProvenance $SourceSha256 $BinarySha256 $BinaryByteLength "compiler path"
  $candidate = Copy-ProvenanceObject $ActualProvenance
  $candidate.compiler.options[0] = "/unsafe"
  Assert-ProvenanceRejected $candidate $ExpectedProvenance $SourceSha256 $BinarySha256 $BinaryByteLength "compiler option"
  $candidate = Copy-ProvenanceObject $ActualProvenance
  $candidate.source.sha256 = ("0" * 64)
  Assert-ProvenanceRejected $candidate $ExpectedProvenance $SourceSha256 $BinarySha256 $BinaryByteLength "source digest"
  $candidate = Copy-ProvenanceObject $ActualProvenance
  $candidate.binary.sha256 = ("0" * 64)
  Assert-ProvenanceRejected $candidate $ExpectedProvenance $SourceSha256 $BinarySha256 $BinaryByteLength "binary digest"
  $candidate = Copy-ProvenanceObject $ActualProvenance
  $candidate.binary.peTimestamp = "retained"
  Assert-ProvenanceRejected $candidate $ExpectedProvenance $SourceSha256 $BinarySha256 $BinaryByteLength "normalization declaration"

  $candidate = Copy-ProvenanceObject $ActualProvenance
  $candidate.compiler.path = $true
  Assert-ProvenanceRejected $candidate $ExpectedProvenance $SourceSha256 $BinarySha256 $BinaryByteLength "boolean compiler path"
  $candidate = Copy-ProvenanceObject $ActualProvenance
  $candidate.compiler.options[0] = $true
  Assert-ProvenanceRejected $candidate $ExpectedProvenance $SourceSha256 $BinarySha256 $BinaryByteLength "boolean compiler option"
  $candidate = Copy-ProvenanceObject $ActualProvenance
  $candidate.source.sha256 = $true
  Assert-ProvenanceRejected $candidate $ExpectedProvenance $SourceSha256 $BinarySha256 $BinaryByteLength "boolean source digest"
  $candidate = Copy-ProvenanceObject $ActualProvenance
  $candidate.binary.peTimestamp = $true
  Assert-ProvenanceRejected $candidate $ExpectedProvenance $SourceSha256 $BinarySha256 $BinaryByteLength "boolean normalization declaration"
  return 15
}

function Find-UniqueByteSequence([byte[]]$Bytes, [byte[]]$Sequence) {
  $matches = New-Object Collections.Generic.List[int]
  for ($offset = 0; $offset -le $Bytes.Length - $Sequence.Length; $offset += 1) {
    $equal = $true
    for ($index = 0; $index -lt $Sequence.Length; $index += 1) {
      if ($Bytes[$offset + $index] -ne $Sequence[$index]) {
        $equal = $false
        break
      }
    }
    if ($equal) {
      $matches.Add($offset)
    }
  }
  if ($matches.Count -ne 1) {
    throw "The compiled process-inspector module identifier was not uniquely locatable."
  }
  return $matches[0]
}

function Get-NormalizedAssemblyBytes([string]$AssemblyPath) {
  [byte[]]$bytes = [IO.File]::ReadAllBytes($AssemblyPath)
  if ($bytes.Length -lt 512 -or $bytes[0] -ne 0x4d -or $bytes[1] -ne 0x5a) {
    throw "The compiled process inspector was not a bounded PE image."
  }
  $peOffset = [BitConverter]::ToInt32($bytes, 0x3c)
  if (
    $peOffset -lt 0x40 -or
    $peOffset + 12 -gt $bytes.Length -or
    $bytes[$peOffset] -ne 0x50 -or
    $bytes[$peOffset + 1] -ne 0x45 -or
    $bytes[$peOffset + 2] -ne 0 -or
    $bytes[$peOffset + 3] -ne 0
  ) {
    throw "The compiled process inspector had invalid PE headers."
  }

  $assembly = [Reflection.Assembly]::Load([IO.File]::ReadAllBytes($AssemblyPath))
  [byte[]]$moduleVersionId = $assembly.ManifestModule.ModuleVersionId.ToByteArray()
  $moduleVersionIdOffset = Find-UniqueByteSequence $bytes $moduleVersionId

  [Array]::Clear($bytes, $peOffset + 8, 4)
  [Array]::Clear($bytes, $moduleVersionIdOffset, 16)
  return $bytes
}

$temporaryRoot = Join-Path ([IO.Path]::GetTempPath()) ("service-lasso-native-provenance-" + [Guid]::NewGuid().ToString("N"))
# The held-exit compiler phase has one 15-second absolute budget. Retain this
# uniquely-created compiler root rather than run an unbounded Remove-Item after
# that phase; retention is conservative evidence, including successful runs.
$retainTemporaryRoot = $HeldExitFixture
try {
  $null = New-Item -ItemType Directory -Path $temporaryRoot
  $compiledPath = Join-Path $temporaryRoot (Split-Path -Leaf $binaryRelativePath)
  # Start before assembling the owned compiler command so configuration,
  # launch, wait, termination and stream settlement share one absolute bound.
  [int64]$compilerPhaseStartedAtMilliseconds = if ($HeldExitFixture) { Get-CompilerMonotonicMilliseconds } else { 0 }
  $compilerArguments = @($compilerOptions) + @(
    "/out:$compiledPath",
    $sourcePath
  )
  if ($HeldExitFixture) {
    $compilerProcess = New-Object Diagnostics.Process
    try {
      $compilerProcess.StartInfo.FileName = $compilerPath
      $compilerProcess.StartInfo.UseShellExecute = $false
      $compilerProcess.StartInfo.CreateNoWindow = $true
       $compilerProcess.StartInfo.RedirectStandardOutput = $true
       $compilerProcess.StartInfo.RedirectStandardError = $true
      if ($null -ne $compilerProcess.StartInfo.ArgumentList) {
        foreach ($compilerArgument in $compilerArguments) {
          [void]$compilerProcess.StartInfo.ArgumentList.Add($compilerArgument)
        }
      } else {
        # Windows PowerShell 5's .NET Framework ProcessStartInfo does not
        # expose ArgumentList. The compiler inputs are fixed, owned paths and
        # options; quote each one before using its compatible Arguments form.
        $compilerProcess.StartInfo.Arguments = (($compilerArguments | ForEach-Object {
          '"' + $_.Replace('"', '\"') + '"'
        }) -join ' ')
      }
       $compilerResult = Invoke-BoundedOwnedCompilerProcess $compilerProcess 15000 -StartedAtMilliseconds $compilerPhaseStartedAtMilliseconds -StartProcess
       if ($compilerResult.outcome -ne "completed") {
         $retainTemporaryRoot = $compilerResult.retainTemporaryRoot
         throw "The Windows held-exit fixture compiler failed closed with $($compilerResult.outcome) inside its 15000ms absolute compiler-phase bound."
      }
      if ($compilerProcess.ExitCode -ne 0) {
        throw "The Windows held-exit fixture provenance compilation failed."
      }
    } finally {
      $compilerProcess.Dispose()
    }
  } else {
    & $compilerPath @compilerArguments
  }
  if (-not [IO.File]::Exists($compiledPath)) {
    throw "The Windows process-inspector provenance compilation failed."
  }

  [byte[]]$normalizedBytes = Get-NormalizedAssemblyBytes $compiledPath
  [byte[]]$sourceBytes = [IO.File]::ReadAllBytes($sourcePath)
  $sourceSha256 = Get-Sha256Hex $sourceBytes
  $binarySha256 = Get-Sha256Hex $normalizedBytes
  $expectedProvenance = [ordered]@{
    schemaVersion = 1
    compiler = [ordered]@{
      family = "Microsoft .NET Framework 4.8 C# compiler"
      path = "%WINDIR%/Microsoft.NET/Framework64/v4.0.30319/csc.exe"
      options = $compilerOptions
    }
    source = [ordered]@{
      path = $sourceRelativePath
      sha256 = $sourceSha256
    }
    binary = [ordered]@{
      path = $binaryRelativePath
      sha256 = $binarySha256
      byteLength = $normalizedBytes.Length
      peTimestamp = "zero"
      moduleVersionId = "zero"
    }
  }
  $expectedCanonicalProvenanceJson = (Get-CanonicalProvenanceJson $sourceSha256 $binarySha256 $normalizedBytes.Length) + "`n"
  $strictUtf8 = New-Object Text.UTF8Encoding($false, $true)
  [byte[]]$expectedCanonicalProvenanceBytes = $strictUtf8.GetBytes($expectedCanonicalProvenanceJson)

  if ($Update) {
    [IO.File]::WriteAllBytes($binaryPath, $normalizedBytes)
    [IO.File]::WriteAllBytes($provenancePath, $expectedCanonicalProvenanceBytes)
  }

  if (-not [IO.File]::Exists($binaryPath) -or -not [IO.File]::Exists($provenancePath)) {
    throw "The shipped process-inspector binary or provenance manifest was missing."
  }
  [byte[]]$shippedBytes = [IO.File]::ReadAllBytes($binaryPath)
  if ($shippedBytes.Length -ne $normalizedBytes.Length) {
    throw "The shipped process-inspector binary length did not match the normalized compiler output."
  }
  for ($index = 0; $index -lt $normalizedBytes.Length; $index += 1) {
    if ($shippedBytes[$index] -ne $normalizedBytes[$index]) {
      throw "The shipped process-inspector binary did not match the normalized compiler output."
    }
  }

  [byte[]]$actualProvenanceBytes = [IO.File]::ReadAllBytes($provenancePath)
  Assert-CanonicalProvenanceBytes $actualProvenanceBytes $expectedCanonicalProvenanceBytes
  $actualProvenanceJson = $strictUtf8.GetString($actualProvenanceBytes)
  $duplicateKeyCandidate = $actualProvenanceJson.Replace(
    '  "schemaVersion": 1,',
    "  `"schemaVersion`": 2,`n  `"schemaVersion`": 1,"
  )
  Assert-CanonicalProvenanceBytesRejected ($strictUtf8.GetBytes($duplicateKeyCandidate)) $expectedCanonicalProvenanceBytes "first-bad last-good duplicate key"
  $utf8WithBom = New-Object Text.UTF8Encoding($true, $true)
  [byte[]]$utf8BomCandidate = @($utf8WithBom.GetPreamble()) + @($expectedCanonicalProvenanceBytes)
  Assert-CanonicalProvenanceBytesRejected $utf8BomCandidate $expectedCanonicalProvenanceBytes "UTF-8 BOM"
  $utf16WithBom = New-Object Text.UnicodeEncoding($false, $true, $true)
  [byte[]]$utf16BomCandidate = @($utf16WithBom.GetPreamble()) + @($utf16WithBom.GetBytes($expectedCanonicalProvenanceJson))
  Assert-CanonicalProvenanceBytesRejected $utf16BomCandidate $expectedCanonicalProvenanceBytes "UTF-16 BOM"
  $actualProvenance = $actualProvenanceJson | ConvertFrom-Json
  Assert-ProvenanceManifest $actualProvenance $expectedProvenance $sourceSha256 $binarySha256 $normalizedBytes.Length
  $negativeCaseCount = 3 + (Invoke-ProvenanceNegativeTests $actualProvenance $expectedProvenance $sourceSha256 $binarySha256 $normalizedBytes.Length)

  $behavioralCaseCount = 0
  if ($Behavioral) {
    if (-not $DirectorySyncHelper) {
      throw "Behavioral verification is only defined for the Windows directory-sync helper."
    }
    $probeDirectory = Join-Path $temporaryRoot "flush-probe"
    $null = New-Item -ItemType Directory -Path $probeDirectory
    & $binaryPath $probeDirectory
    if ($LASTEXITCODE -ne 0) {
      throw "The Windows directory-sync helper did not report a successful directory flush."
    }
    & $binaryPath
    if ($LASTEXITCODE -ne 2) {
      throw "The Windows directory-sync helper did not reject an absent directory argument."
    }
    & $binaryPath (Join-Path $temporaryRoot "missing-directory")
    if ($LASTEXITCODE -ne 3) {
      throw "The Windows directory-sync helper did not report an open failure."
    }
    $behavioralCaseCount = 3
  }

  [pscustomobject]@{
    result = "passed"
    compilerPath = "%WINDIR%/Microsoft.NET/Framework64/v4.0.30319/csc.exe"
    compilerFileVersion = $compilerItem.VersionInfo.FileVersion
    compilerSha256 = Get-Sha256Hex ([IO.File]::ReadAllBytes($compilerPath))
    sourceSha256 = $sourceSha256
    binarySha256 = $binarySha256
    binaryByteLength = $normalizedBytes.Length
    negativeCaseCount = $negativeCaseCount
    behavioralCaseCount = $behavioralCaseCount
  } | ConvertTo-Json -Compress
} finally {
  if (-not $retainTemporaryRoot -and [IO.Directory]::Exists($temporaryRoot)) {
    Remove-Item -LiteralPath $temporaryRoot -Recurse -Force
  }
}

# The directory-sync negative probe intentionally exits 3. It is an asserted
# successful case, so do not leak that child exit code as this verifier's own
# process status after the result record has been emitted.
exit 0
