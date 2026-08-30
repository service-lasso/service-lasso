[CmdletBinding()]
param(
  [switch]$Update
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

if (-not $IsWindows -and $PSVersionTable.PSEdition -eq "Core") {
  throw "Windows process-inspector provenance verification requires Windows."
}

$repoRoot = Split-Path -Parent $PSScriptRoot
$sourceRelativePath = "src/runtime/process/windows-process-inspector.cs"
$binaryRelativePath = "src/runtime/process/windows-process-inspector.exe"
$provenanceRelativePath = "src/runtime/process/windows-process-inspector.provenance.json"
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

$temporaryRoot = Join-Path ([IO.Path]::GetTempPath()) ("service-lasso-inspector-provenance-" + [Guid]::NewGuid().ToString("N"))
try {
  $null = New-Item -ItemType Directory -Path $temporaryRoot
  $compiledPath = Join-Path $temporaryRoot "windows-process-inspector.exe"
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

  if ($Update) {
    [IO.File]::WriteAllBytes($binaryPath, $normalizedBytes)
    $provenanceJson = ($expectedProvenance | ConvertTo-Json -Depth 6).Replace("`r`n", "`n").Replace("`r", "`n")
    [IO.File]::WriteAllText($provenancePath, $provenanceJson + "`n", (New-Object Text.UTF8Encoding($false)))
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

  $actualProvenance = Get-Content -LiteralPath $provenancePath -Raw | ConvertFrom-Json
  $expectedJson = $expectedProvenance | ConvertTo-Json -Depth 6 -Compress
  $actualJson = $actualProvenance | ConvertTo-Json -Depth 6 -Compress
  if ($actualJson -cne $expectedJson) {
    throw "The Windows process-inspector provenance manifest did not match source and binary content."
  }

  [pscustomobject]@{
    result = "passed"
    compilerPath = "%WINDIR%/Microsoft.NET/Framework64/v4.0.30319/csc.exe"
    compilerFileVersion = $compilerItem.VersionInfo.FileVersion
    compilerSha256 = Get-Sha256Hex ([IO.File]::ReadAllBytes($compilerPath))
    sourceSha256 = $sourceSha256
    binarySha256 = $binarySha256
    binaryByteLength = $normalizedBytes.Length
  } | ConvertTo-Json -Compress
} finally {
  if ([IO.Directory]::Exists($temporaryRoot)) {
    Remove-Item -LiteralPath $temporaryRoot -Recurse -Force
  }
}
