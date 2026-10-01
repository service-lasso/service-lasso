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
    '    "path": "Visual Studio 2022 Build Tools via VsDevCmd",',
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

$temporaryRoot = Join-Path ([IO.Path]::GetTempPath()) ("service-lasso-native-bootstrap-" + [Guid]::NewGuid().ToString("N"))
try {
  $null = New-Item -ItemType Directory -Path $temporaryRoot
  $compiledPath = Join-Path $temporaryRoot "windows-managed-launcher-native.exe"
  $objectPath = Join-Path $temporaryRoot "windows-managed-launcher-native-bootstrap.obj"
  $nativeCommand = 'call "' + $vsDevCmd + '" -no_logo -arch=x64 && cl.exe /nologo /TC /O2 /GS /MT /W4 "' + $sourcePath + '" /Fo:"' + $objectPath + '" /Fe:"' + $compiledPath + '" /link /Brepro bcrypt.lib'
  & cmd.exe /d /s /c $nativeCommand
  if ($LASTEXITCODE -ne 0 -or -not [IO.File]::Exists($compiledPath)) { throw "Native bootstrap compilation failed." }
  [byte[]]$normalizedBinaryBytes = Get-NormalizedNativePeBytes $compiledPath
  [byte[]]$sourceBytes = [IO.File]::ReadAllBytes($sourcePath)
  [byte[]]$managedBytes = [IO.File]::ReadAllBytes($managedPath)
  $sourceSha256 = Get-Sha256Hex $sourceBytes
  $managedSha256 = Get-Sha256Hex $managedBytes
  $binarySha256 = Get-Sha256Hex $normalizedBinaryBytes
  $sourceText = [Text.Encoding]::UTF8.GetString($sourceBytes)
  if ($sourceText -notmatch ('MANAGED_LAUNCHER_BYTE_LENGTH\s+' + $managedBytes.Length + 'LL') -or $sourceText -notmatch ('0x' + $managedSha256.Substring(0, 2))) {
    throw "Native bootstrap source did not pin the managed launcher identity."
  }
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
} finally {
  if ([IO.Directory]::Exists($temporaryRoot)) { Remove-Item -LiteralPath $temporaryRoot -Recurse -Force }
}
