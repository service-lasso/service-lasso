# Passive PE/CLI metadata inspection. Never load or execute the input image.
function Get-ManagedPeNormalizationOffsets([byte[]]$Bytes) {
  function Assert-ManagedRange([uint64]$Offset, [uint64]$Count, [uint64]$Limit) {
    if ($Offset -gt $Limit -or $Count -gt ($Limit - $Offset)) {
      throw 'Managed PE range exceeds its containing bytes.'
    }
  }
  function Read-ManagedU16([uint64]$Offset) {
    Assert-ManagedRange $Offset 2 $Bytes.LongLength
    return [BitConverter]::ToUInt16($Bytes, [int]$Offset)
  }
  function Read-ManagedU32([uint64]$Offset) {
    Assert-ManagedRange $Offset 4 $Bytes.LongLength
    return [BitConverter]::ToUInt32($Bytes, [int]$Offset)
  }
  function Read-ManagedU64([uint64]$Offset) {
    Assert-ManagedRange $Offset 8 $Bytes.LongLength
    return [BitConverter]::ToUInt64($Bytes, [int]$Offset)
  }
  Assert-ManagedRange 0 64 $Bytes.LongLength
  if ((Read-ManagedU16 0) -ne 0x5a4d) { throw 'Missing DOS signature.' }
  [uint64]$pe = Read-ManagedU32 0x3c
  Assert-ManagedRange $pe 24 $Bytes.LongLength
  if ($pe -lt 64 -or (Read-ManagedU32 $pe) -ne 0x4550) { throw 'Invalid PE signature.' }
  [uint64]$sections = Read-ManagedU16 ($pe + 6)
  [uint64]$optionalSize = Read-ManagedU16 ($pe + 20)
  [uint64]$optional = $pe + 24
  Assert-ManagedRange $optional $optionalSize $Bytes.LongLength
  $magic = Read-ManagedU16 $optional
  if ($magic -eq 0x10b) { [uint64]$directories = 96 }
  elseif ($magic -eq 0x20b) { [uint64]$directories = 112 }
  else { throw 'Unsupported PE optional header.' }
  Assert-ManagedRange $directories (15 * 8) $optionalSize
  if ((Read-ManagedU32 ($optional + $directories - 4)) -lt 15) { throw 'Missing CLI directory.' }
  [uint64]$headerSize = Read-ManagedU32 ($optional + 60)
  Assert-ManagedRange 0 $headerSize $Bytes.LongLength
  [uint64]$sectionTable = $optional + $optionalSize
  Assert-ManagedRange $sectionTable ($sections * 40) $headerSize
  $maps = New-Object 'Collections.Generic.List[object]'
  for ([uint64]$i = 0; $i -lt $sections; $i++) {
    [uint64]$row = $sectionTable + $i * 40
    [uint64]$rawSize = Read-ManagedU32 ($row + 16)
    [uint64]$raw = Read-ManagedU32 ($row + 20)
    [uint64]$rva = Read-ManagedU32 ($row + 12)
    [uint64]$virtualSize = Read-ManagedU32 ($row + 8)
    Assert-ManagedRange $raw $rawSize $Bytes.LongLength
    if ($rawSize -gt 0 -and $raw -lt $headerSize) { throw 'Section overlaps PE headers.' }
    [uint64]$extent = [Math]::Max($rawSize, $virtualSize)
    foreach ($previous in $maps) {
      if ($rawSize -gt 0 -and $previous.rawSize -gt 0 -and
          $raw -lt ($previous.raw + $previous.rawSize) -and $previous.raw -lt ($raw + $rawSize)) {
        throw 'Overlapping raw sections.'
      }
      if ($extent -gt 0 -and $previous.extent -gt 0 -and
          $rva -lt ($previous.rva + $previous.extent) -and $previous.rva -lt ($rva + $extent)) {
        throw 'Overlapping virtual sections.'
      }
    }
    $maps.Add(@{raw=$raw;rawSize=$rawSize;rva=$rva;extent=$extent})
  }
  function Resolve-ManagedRva([uint64]$Rva, [uint64]$Count) {
    $matches = New-Object 'Collections.Generic.List[object]'
    if ($Rva -lt $headerSize -and $Count -le ($headerSize - $Rva)) { $matches.Add($Rva) }
    foreach ($map in $maps) {
      if ($Rva -ge $map.rva -and ($Rva - $map.rva) -lt $map.rawSize -and
          $Count -le ($map.rawSize - ($Rva - $map.rva))) {
        $matches.Add([uint64]($map.raw + ($Rva - $map.rva)))
      }
    }
    if ($matches.Count -ne 1) { throw 'RVA is not uniquely file-backed.' }
    return [uint64]$matches[0]
  }
  [uint64]$cliSize = Read-ManagedU32 ($optional + $directories + 14 * 8 + 4)
  if ($cliSize -lt 72) { throw 'Truncated CLI header.' }
  [uint64]$cli = Resolve-ManagedRva (Read-ManagedU32 ($optional + $directories + 14 * 8)) $cliSize
  [uint64]$declaredCliSize = Read-ManagedU32 $cli
  if ($declaredCliSize -lt 72 -or $declaredCliSize -gt $cliSize) { throw 'Invalid CLI header length.' }
  [uint64]$metadataSize = Read-ManagedU32 ($cli + 12)
  [uint64]$metadata = Resolve-ManagedRva (Read-ManagedU32 ($cli + 8)) $metadataSize
  Assert-ManagedRange 0 20 $metadataSize
  if ((Read-ManagedU32 $metadata) -ne 0x424a5342) { throw 'Invalid CLI metadata signature.' }
  [uint64]$versionLength = Read-ManagedU32 ($metadata + 12)
  Assert-ManagedRange 16 $versionLength $metadataSize
  [uint64]$cursor = 16 + $versionLength
  $cursor = $cursor + ((4 - ($cursor % 4)) % 4)
  Assert-ManagedRange $cursor 4 $metadataSize
  [uint64]$streamCount = Read-ManagedU16 ($metadata + $cursor + 2)
  $cursor += 4
  $streams = @{}
  for ([uint64]$i = 0; $i -lt $streamCount; $i++) {
    Assert-ManagedRange $cursor 9 $metadataSize
    [uint64]$offset = Read-ManagedU32 ($metadata + $cursor)
    [uint64]$size = Read-ManagedU32 ($metadata + $cursor + 4)
    $cursor += 8
    $nameBytes = New-Object 'Collections.Generic.List[byte]'
    do {
      Assert-ManagedRange $cursor 1 $metadataSize
      [byte]$value = $Bytes[[int]($metadata + $cursor)]
      $cursor++
      if ($value -gt 127) { throw 'Non-ASCII metadata stream name.' }
      if ($value -ne 0) { $nameBytes.Add($value) }
    } while ($value -ne 0)
    $cursor = $cursor + ((4 - ($cursor % 4)) % 4)
    Assert-ManagedRange $offset $size $metadataSize
    $name = [Text.Encoding]::ASCII.GetString($nameBytes.ToArray())
    if ($streams.ContainsKey($name)) { throw 'Duplicate metadata stream.' }
    $streams.Add($name, @{offset=$offset;size=$size})
  }
  Assert-ManagedRange 0 $cursor $metadataSize
  foreach ($stream in $streams.Values) {
    if ($stream.offset -lt $cursor) { throw 'Metadata stream overlaps headers.' }
    foreach ($other in $streams.Values) {
      if (-not [object]::ReferenceEquals($stream, $other) -and $stream.size -gt 0 -and $other.size -gt 0 -and
          $stream.offset -lt ($other.offset + $other.size) -and $other.offset -lt ($stream.offset + $stream.size)) {
        throw 'Overlapping metadata streams.'
      }
    }
  }
  if (-not $streams.ContainsKey('#GUID') -or ($streams.ContainsKey('#~') -eq $streams.ContainsKey('#-'))) {
    throw 'Missing or ambiguous metadata heaps/tables.'
  }
  $tables = if ($streams.ContainsKey('#~')) { $streams['#~'] } else { $streams['#-'] }
  [uint64]$tableBase = $metadata + $tables.offset
  Assert-ManagedRange 0 24 $tables.size
  [byte]$heaps = $Bytes[[int]($tableBase + 6)]
  # This normalizer accepts the ordinary csc heap-width flags only. ExtraData
  # and delta/deletion layouts change table semantics and must fail closed.
  if (($heaps -band 0xf8) -ne 0) { throw 'Unsupported metadata table heap flags.' }
  [uint64]$valid = Read-ManagedU64 ($tableBase + 8)
  if (($valid -band [uint64]1) -eq 0) { throw 'Missing Module table.' }
  [uint64]$rowsEnd = 24
  [uint32]$moduleRows = 0
  for ($i = 0; $i -lt 64; $i++) {
    if ((($valid -shr $i) -band [uint64]1) -ne 0) {
      Assert-ManagedRange $rowsEnd 4 $tables.size
      $count = Read-ManagedU32 ($tableBase + $rowsEnd)
      if ($i -eq 0) { $moduleRows = $count }
      $rowsEnd += 4
    }
  }
  if ($moduleRows -ne 1) { throw 'Module table must contain exactly one row.' }
  [uint64]$stringWidth = if (($heaps -band 1) -ne 0) { 4 } else { 2 }
  [uint64]$guidWidth = if (($heaps -band 2) -ne 0) { 4 } else { 2 }
  Assert-ManagedRange $rowsEnd (2 + $stringWidth + 3 * $guidWidth) $tables.size
  [uint64]$mvidColumn = $tableBase + $rowsEnd + 2 + $stringWidth
  [uint64]$index = if ($guidWidth -eq 4) { Read-ManagedU32 $mvidColumn } else { Read-ManagedU16 $mvidColumn }
  $guid = $streams['#GUID']
  if ($index -eq 0 -or ($guid.size % 16) -ne 0) { throw 'Invalid MVID GUID heap index/size.' }
  [uint64]$guidOffset = ($index - 1) * 16
  Assert-ManagedRange $guidOffset 16 $guid.size
  return [pscustomobject]@{timestamp=[int]($pe + 8);mvid=[int]($metadata + $guid.offset + $guidOffset)}
}
