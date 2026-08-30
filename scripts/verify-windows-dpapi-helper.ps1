[CmdletBinding()]
param(
  [switch]$Update,
  [switch]$Behavioral
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

if (-not $IsWindows -and $PSVersionTable.PSEdition -eq "Core") {
  throw "Windows DPAPI-helper provenance verification requires Windows."
}

$repoRoot = Split-Path -Parent $PSScriptRoot
$sourceRelativePath = "src/runtime/security/windows-dpapi-helper.cs"
$binaryRelativePath = "src/runtime/security/windows-dpapi-helper.exe"
$provenanceRelativePath = "src/runtime/security/windows-dpapi-helper.provenance.json"
$sourcePath = Join-Path $repoRoot $sourceRelativePath
$binaryPath = Join-Path $repoRoot $binaryRelativePath
$provenancePath = Join-Path $repoRoot $provenanceRelativePath
$compilerPath = Join-Path $env:WINDIR "Microsoft.NET/Framework64/v4.0.30319/csc.exe"
$compilerOptions = @(
  "/nologo",
  "/target:exe",
  "/platform:anycpu",
  "/optimize+",
  "/reference:System.Security.dll"
)

if (-not [IO.Path]::IsPathRooted($compilerPath) -or -not [IO.File]::Exists($compilerPath)) {
  throw "The trusted Windows .NET Framework C# compiler was unavailable."
}
$compilerItem = Get-Item -LiteralPath $compilerPath
if ($compilerItem.VersionInfo.FileMajorPart -ne 4 -or $compilerItem.VersionInfo.FileMinorPart -lt 8) {
  throw "Windows DPAPI-helper provenance requires the trusted .NET Framework 4.8 compiler family."
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
  $match = -1
  for ($offset = 0; $offset -le $Bytes.Length - $Sequence.Length; $offset += 1) {
    $equal = $true
    for ($index = 0; $index -lt $Sequence.Length; $index += 1) {
      if ($Bytes[$offset + $index] -ne $Sequence[$index]) {
        $equal = $false
        break
      }
    }
    if ($equal) {
      if ($match -ne -1) {
        throw "The compiled DPAPI-helper module identifier was not uniquely locatable."
      }
      $match = $offset
    }
  }
  if ($match -eq -1) {
    throw "The compiled DPAPI-helper module identifier was not locatable."
  }
  return $match
}

function Get-NormalizedAssemblyBytes([string]$AssemblyPath) {
  [byte[]]$bytes = [IO.File]::ReadAllBytes($AssemblyPath)
  if ($bytes.Length -lt 512 -or $bytes[0] -ne 0x4d -or $bytes[1] -ne 0x5a) {
    throw "The compiled DPAPI helper was not a bounded PE image."
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
    throw "The compiled DPAPI helper had invalid PE headers."
  }

  $assembly = [Reflection.Assembly]::Load([IO.File]::ReadAllBytes($AssemblyPath))
  [byte[]]$moduleVersionId = $assembly.ManifestModule.ModuleVersionId.ToByteArray()
  $moduleVersionIdOffset = Find-UniqueByteSequence $bytes $moduleVersionId
  [Array]::Clear($bytes, $peOffset + 8, 4)
  [Array]::Clear($bytes, $moduleVersionIdOffset, 16)
  return $bytes
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
    '      "/optimize+",',
    '      "/reference:System.Security.dll"',
    '    ]',
    '  },',
    '  "source": {',
    '    "path": "src/runtime/security/windows-dpapi-helper.cs",',
    ('    "sha256": "{0}"' -f $SourceSha256),
    '  },',
    '  "binary": {',
    '    "path": "src/runtime/security/windows-dpapi-helper.exe",',
    ('    "sha256": "{0}",' -f $BinarySha256),
    ('    "byteLength": {0},' -f $BinaryByteLength),
    '    "peTimestamp": "zero",',
    '    "moduleVersionId": "zero"',
    '  }',
    '}'
  ) -join "`n"
}

function Assert-ExactBytes([byte[]]$Actual, [byte[]]$Expected, [string]$Label) {
  if ($Actual.Length -ne $Expected.Length) {
    throw "$Label length was invalid."
  }
  for ($index = 0; $index -lt $Expected.Length; $index += 1) {
    if ($Actual[$index] -ne $Expected[$index]) {
      throw "$Label did not match the reproducible expected bytes."
    }
  }
}

function Invoke-Helper([string]$Operation, [string]$InputText, [int]$ExpectedExitCode) {
  $startInfo = New-Object Diagnostics.ProcessStartInfo
  $startInfo.FileName = $binaryPath
  $startInfo.Arguments = $Operation
  $startInfo.UseShellExecute = $false
  $startInfo.CreateNoWindow = $true
  $startInfo.RedirectStandardInput = $true
  $startInfo.RedirectStandardOutput = $true
  $startInfo.RedirectStandardError = $true
  $process = New-Object Diagnostics.Process
  $process.StartInfo = $startInfo
  try {
    if (-not $process.Start()) {
      throw "The DPAPI helper did not start."
    }
    $stdoutTask = $process.StandardOutput.ReadToEndAsync()
    $stderrTask = $process.StandardError.ReadToEndAsync()
    $process.StandardInput.Write($InputText)
    $process.StandardInput.Close()
    if (-not $process.WaitForExit(15000)) {
      $process.Kill()
      if (-not $process.WaitForExit(5000)) {
        throw "The DPAPI helper could not be stopped after its bounded verification timeout."
      }
      throw "The DPAPI helper exceeded its bounded verification timeout."
    }
    $stdout = $stdoutTask.GetAwaiter().GetResult()
    $stderr = $stderrTask.GetAwaiter().GetResult()
    if ($process.ExitCode -ne $ExpectedExitCode -or $stderr.Length -ne 0) {
      throw "The DPAPI helper returned an invalid bounded result."
    }
    return $stdout
  } finally {
    $process.Dispose()
  }
}

$temporaryRoot = Join-Path ([IO.Path]::GetTempPath()) ("service-lasso-dpapi-provenance-" + [Guid]::NewGuid().ToString("N"))
try {
  $null = New-Item -ItemType Directory -Path $temporaryRoot
  $compiledPath = Join-Path $temporaryRoot "windows-dpapi-helper.exe"
  $compilerArguments = @($compilerOptions) + @(
    "/out:$compiledPath",
    $sourcePath
  )
  & $compilerPath @compilerArguments
  if ($LASTEXITCODE -ne 0 -or -not [IO.File]::Exists($compiledPath)) {
    throw "The Windows DPAPI-helper provenance compilation failed."
  }

  [byte[]]$normalizedBytes = Get-NormalizedAssemblyBytes $compiledPath
  [byte[]]$sourceBytes = [IO.File]::ReadAllBytes($sourcePath)
  $sourceSha256 = Get-Sha256Hex $sourceBytes
  $binarySha256 = Get-Sha256Hex $normalizedBytes
  $canonicalJson = (Get-CanonicalProvenanceJson $sourceSha256 $binarySha256 $normalizedBytes.Length) + "`n"
  $strictUtf8 = New-Object Text.UTF8Encoding($false, $true)
  [byte[]]$canonicalBytes = $strictUtf8.GetBytes($canonicalJson)

  if ($Update) {
    [IO.File]::WriteAllBytes($binaryPath, $normalizedBytes)
    [IO.File]::WriteAllBytes($provenancePath, $canonicalBytes)
  }
  if (-not [IO.File]::Exists($binaryPath) -or -not [IO.File]::Exists($provenancePath)) {
    throw "The shipped DPAPI-helper binary or provenance manifest was missing."
  }

  Assert-ExactBytes ([IO.File]::ReadAllBytes($binaryPath)) $normalizedBytes "The shipped DPAPI-helper binary"
  Assert-ExactBytes ([IO.File]::ReadAllBytes($provenancePath)) $canonicalBytes "The canonical DPAPI-helper provenance"
  $manifest = $strictUtf8.GetString([IO.File]::ReadAllBytes($provenancePath)) | ConvertFrom-Json
  if (
    $manifest.schemaVersion -ne 1 -or
    $manifest.compiler.path -cne "%WINDIR%/Microsoft.NET/Framework64/v4.0.30319/csc.exe" -or
    $manifest.source.path -cne $sourceRelativePath -or
    $manifest.source.sha256 -cne $sourceSha256 -or
    $manifest.binary.path -cne $binaryRelativePath -or
    $manifest.binary.sha256 -cne $binarySha256 -or
    $manifest.binary.byteLength -ne $normalizedBytes.Length -or
    $manifest.binary.peTimestamp -cne "zero" -or
    $manifest.binary.moduleVersionId -cne "zero"
  ) {
    throw "The DPAPI-helper provenance manifest was invalid."
  }

  $contractCases = 0
  if ($Behavioral) {
    [byte[]]$plainBytes = [Text.Encoding]::UTF8.GetBytes("service-lasso-dpapi-provenance-probe")
    try {
      $plain = [Convert]::ToBase64String($plainBytes)
      $protected = Invoke-Helper "protect" $plain 0
      if ($protected -ceq $plain -or $protected -notmatch '^[A-Za-z0-9+/]+={0,2}$') {
        throw "The DPAPI helper did not return protected canonical base64."
      }
      $roundTrip = Invoke-Helper "unprotect" $protected 0
      if ($roundTrip -cne $plain) {
        throw "The DPAPI helper did not preserve CurrentUser DPAPI round-trip semantics."
      }
      $invalidResult = Invoke-Helper "invalid" $plain 2
      if ($invalidResult.Length -ne 0) {
        throw "The DPAPI helper exposed output for an invalid request."
      }
      foreach ($invalidCase in @(
        @{ Input = ""; ExitCode = 2 },
        @{ Input = "not-base64"; ExitCode = 2 },
        @{ Input = "AB=="; ExitCode = 2 },
        @{ Input = "AA=="; ExitCode = 3 },
        @{ Input = ("A" * 350004); ExitCode = 2 }
      )) {
        $failureOutput = Invoke-Helper "unprotect" $invalidCase.Input $invalidCase.ExitCode
        if ($failureOutput.Length -ne 0) {
          throw "The DPAPI helper exposed output for a bounded negative case."
        }
      }
      $contractCases = 8
    } finally {
      [Array]::Clear($plainBytes, 0, $plainBytes.Length)
    }
  }

  [pscustomobject]@{
    result = "passed"
    compilerPath = "%WINDIR%/Microsoft.NET/Framework64/v4.0.30319/csc.exe"
    compilerFileVersion = $compilerItem.VersionInfo.FileVersion
    sourceSha256 = $sourceSha256
    binarySha256 = $binarySha256
    binaryByteLength = $normalizedBytes.Length
    contractCases = $contractCases
  } | ConvertTo-Json -Compress
} finally {
  if ([IO.Directory]::Exists($temporaryRoot)) {
    Remove-Item -LiteralPath $temporaryRoot -Recurse -Force
  }
}
