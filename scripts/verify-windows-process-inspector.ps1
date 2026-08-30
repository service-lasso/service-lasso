[CmdletBinding()]
param(
  [switch]$Update,
  [switch]$ManagedLauncherNative
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

if (-not $IsWindows -and $PSVersionTable.PSEdition -eq "Core") {
  throw "Windows process-inspector provenance verification requires Windows."
}

$repoRoot = Split-Path -Parent $PSScriptRoot
$sourceRelativePath = if ($ManagedLauncherNative) {
  "src/runtime/execution/windows-managed-launcher-native.cs"
} else {
  "src/runtime/process/windows-process-inspector.cs"
}
$binaryRelativePath = if ($ManagedLauncherNative) {
  "src/runtime/execution/windows-managed-launcher-native.exe"
} else {
  "src/runtime/process/windows-process-inspector.exe"
}
$provenanceRelativePath = if ($ManagedLauncherNative) {
  "src/runtime/execution/windows-managed-launcher-native.provenance.json"
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
  return @(
    '{',
    '  "schemaVersion": 1,',
    '  "compiler": {',
    '    "family": "Microsoft .NET Framework 4.8 C# compiler",',
    '    "path": "%WINDIR%/Microsoft.NET/Framework64/v4.0.30319/csc.exe",',
    '    "options": [',
    '      "/nologo",',
    '      "/target:exe",',
    '      "/platform:anycpu",',
    '      "/optimize+"',
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
  ) -join "`n"
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
try {
  $null = New-Item -ItemType Directory -Path $temporaryRoot
  $compiledPath = Join-Path $temporaryRoot (Split-Path -Leaf $binaryRelativePath)
  $compilerArguments = @($compilerOptions) + @(
    "/out:$compiledPath",
    $sourcePath
  )
  & $compilerPath @compilerArguments
  if ($LASTEXITCODE -ne 0 -or -not [IO.File]::Exists($compiledPath)) {
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

  [pscustomobject]@{
    result = "passed"
    compilerPath = "%WINDIR%/Microsoft.NET/Framework64/v4.0.30319/csc.exe"
    compilerFileVersion = $compilerItem.VersionInfo.FileVersion
    compilerSha256 = Get-Sha256Hex ([IO.File]::ReadAllBytes($compilerPath))
    sourceSha256 = $sourceSha256
    binarySha256 = $binarySha256
    binaryByteLength = $normalizedBytes.Length
    negativeCaseCount = $negativeCaseCount
  } | ConvertTo-Json -Compress
} finally {
  if ([IO.Directory]::Exists($temporaryRoot)) {
    Remove-Item -LiteralPath $temporaryRoot -Recurse -Force
  }
}
