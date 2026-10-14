$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '../scripts/managed-pe-normalization.ps1')
function Set-U16([byte[]]$b,[int]$p,[uint16]$v) { [BitConverter]::GetBytes($v).CopyTo($b,$p) }
function Set-U32([byte[]]$b,[int]$p,[uint32]$v) { [BitConverter]::GetBytes($v).CopyTo($b,$p) }
function Set-U64([byte[]]$b,[int]$p,[uint64]$v) { [BitConverter]::GetBytes($v).CopyTo($b,$p) }
function New-PassiveFixture([bool]$Wide=$false,[bool]$Uncompressed=$false,[bool]$Pe64=$false) {
  [byte[]]$b = New-Object byte[] 1536
  Set-U16 $b 0 0x5a4d; Set-U32 $b 60 128; Set-U32 $b 128 0x4550
  Set-U16 $b 134 1; Set-U32 $b 136 123456
  $optionalSize = if ($Pe64) {240} else {224}
  $directories = if ($Pe64) {112} else {96}
  Set-U16 $b 148 $optionalSize
  Set-U16 $b 152 $(if ($Pe64) {0x20b} else {0x10b})
  Set-U32 $b 212 512
  Set-U32 $b (152+$directories-4) 16
  Set-U32 $b (152+$directories+112) 4096
  Set-U32 $b (152+$directories+116) 72
  $section = 152+$optionalSize
  Set-U32 $b ($section+8) 1024; Set-U32 $b ($section+12) 4096
  Set-U32 $b ($section+16) 1024; Set-U32 $b ($section+20) 512
  Set-U32 $b 512 72; Set-U32 $b 520 4176; Set-U32 $b 524 512
  Set-U32 $b 592 0x424a5342; Set-U32 $b 604 4
  $b[608]=118; $b[609]=49
  Set-U16 $b 614 3
  Set-U32 $b 616 128; Set-U32 $b 620 128
  [Text.Encoding]::ASCII.GetBytes($(if ($Uncompressed) {'#-'} else {'#~'})).CopyTo($b,624)
  Set-U32 $b 628 256; Set-U32 $b 632 32
  [Text.Encoding]::ASCII.GetBytes('#GUID').CopyTo($b,636)
  Set-U32 $b 644 320; Set-U32 $b 648 32
  [Text.Encoding]::ASCII.GetBytes('#Blob').CopyTo($b,652)
  $b[724]=2; $b[726]=$(if ($Wide) {3} else {0})
  Set-U64 $b 728 1; Set-U32 $b 744 1
  if ($Wide) { Set-U32 $b 754 1 } else { Set-U16 $b 752 1 }
  for ($i=0;$i -lt 16;$i++) { $b[848+$i]=[byte]($i+1); $b[912+$i]=[byte]($i+1) }
  return ,$b
}
$passed = New-Object 'Collections.Generic.List[string]'
foreach ($variant in @(@{wide=$false;raw=$false;pe64=$false},@{wide=$true;raw=$false;pe64=$true},@{wide=$false;raw=$true;pe64=$false})) {
  [byte[]]$b = New-PassiveFixture $variant.wide $variant.raw $variant.pe64
  $offsets = Get-ManagedPeNormalizationOffsets $b
  if ($offsets.timestamp -ne 136 -or $offsets.mvid -ne 848) { throw 'Wrong structural offsets.' }
  [byte[]]$normalized=$b.Clone()
  [Array]::Clear($normalized,$offsets.timestamp,4); [Array]::Clear($normalized,$offsets.mvid,16)
  for ($i=0;$i -lt $b.Length;$i++) {
    $expected=if (($i -ge 136 -and $i -lt 140) -or ($i -ge 848 -and $i -lt 864)) {0} else {$b[$i]}
    if ($normalized[$i] -ne $expected) { throw "Normalization changed unrelated byte $i." }
  }
  $passed.Add("structural-decoy-wide=$($variant.wide)-raw=$($variant.raw)-pe64=$($variant.pe64)")
}
$cases=@(
  @{name='DOS signature';change={param($b) $b[0]=0}},
  @{name='PE offset bounds';change={param($b) Set-U32 $b 60 ([uint32]::MaxValue)}},
  @{name='CLI RVA bounds';change={param($b) Set-U32 $b 360 8192}},
  @{name='CLI length';change={param($b) Set-U32 $b 364 71}},
  @{name='metadata RVA bounds';change={param($b) Set-U32 $b 520 5000}},
  @{name='metadata signature';change={param($b) Set-U32 $b 592 0}},
  @{name='version bounds';change={param($b) Set-U32 $b 604 ([uint32]::MaxValue)}},
  @{name='stream bounds';change={param($b) Set-U32 $b 632 513}},
  @{name='overlapping streams';change={param($b) Set-U32 $b 644 260}},
  @{name='stream overlaps headers';change={param($b) Set-U32 $b 628 16}},
  @{name='duplicate GUID stream';change={param($b) [Text.Encoding]::ASCII.GetBytes('#GUID').CopyTo($b,652)}},
  @{name='missing GUID stream';change={param($b) $b[637]=88}},
  @{name='missing tables stream';change={param($b) $b[625]=88}},
  @{name='ambiguous tables streams';change={param($b) [Array]::Clear($b,652,8); [Text.Encoding]::ASCII.GetBytes('#-').CopyTo($b,652)}},
  @{name='missing Module';change={param($b) Set-U64 $b 728 0}},
  @{name='unsupported ExtraData layout';change={param($b) $b[726]=0x40}},
  @{name='unsupported delta layout';change={param($b) $b[726]=0x20}},
  @{name='multiple Module rows';change={param($b) Set-U32 $b 744 2}},
  @{name='truncated Module row';change={param($b) Set-U32 $b 620 30}},
  @{name='zero GUID index';change={param($b) Set-U16 $b 752 0}},
  @{name='out-of-range GUID index';change={param($b) Set-U16 $b 752 3}},
  @{name='invalid GUID heap size';change={param($b) Set-U32 $b 632 31}},
  # PE32 optional header starts152, length224: section2 starts416.
  @{name='overlapping raw sections';change={param($b) Set-U16 $b 134 2; Set-U32 $b 424 64; Set-U32 $b 428 8192; Set-U32 $b 432 64; Set-U32 $b 436 512}},
  @{name='overlapping virtual sections';change={param($b) Set-U16 $b 134 2; Set-U32 $b 424 64; Set-U32 $b 428 4096; Set-U32 $b 432 0; Set-U32 $b 436 1536}}
)
foreach ($case in $cases) {
  [byte[]]$b=New-PassiveFixture
  & $case.change $b
  $rejected=$false
  try { $null=Get-ManagedPeNormalizationOffsets $b } catch { $rejected=$true }
  if (-not $rejected) { throw "Accepted invalid fixture: $($case.name)." }
  $passed.Add($case.name)
}
[byte[]]$short=New-Object byte[] 63
try { $null=Get-ManagedPeNormalizationOffsets $short; throw 'Accepted short fixture.' } catch {
  if ($_.Exception.Message -eq 'Accepted short fixture.') { throw }
}
$passed.Add('truncated image')
[pscustomobject]@{passed=$passed.Count;cases=$passed.ToArray();claim='Passive parser corpus only; no compiler or product execution.'} | ConvertTo-Json -Depth 3
