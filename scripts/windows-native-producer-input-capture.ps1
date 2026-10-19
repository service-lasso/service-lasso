# Fixed Core build-input custody. Source only; external startup reservation and
# complete independent source/input/command admission precede every effect.
. (Join-Path $PSScriptRoot 'windows-native-producer-input-worker.ps1')

function New-CoreInputResourceRoster {
  param([int]$Count)
  $records=[object[]]::new($Count)
  for($index=0;$index -lt $Count;$index++) {
    $records[$index]=@{ captureOriginal=$null; sourceOriginal=$null; objectOriginal=$null;
      kind='disposable-native-or-managed';lifetime=$null;retentionVisited=$false;retainedBackingOriginal=$null;
      disposalAttempted=$false; disposalReturned=$false; disposalOriginal=$null; phaseWorkerOriginal=$null }
  }
  return ,$records
}

function Publish-CoreInputWorkerResources {
  param($WorkerOriginal)
  $w=$WorkerOriginal; $c=$w.preparation.inputRead.capture; $subject=$w.effectOriginal
  if($w.phase -cin @('subject-read-hash','member-hash','generated-open-length')) {
    $c.resources[$subject.resourceOffset].objectOriginal=$w.outputs[0]
    $c.resources[$subject.resourceOffset+1].objectOriginal=$w.outputs[1]
  } elseif($w.phase -ceq 'root-json-parse') {
    # SAME parse owner was enrolled before any backing allocation/worker entry.
    # Null/failed worker outputs cannot erase the retained partial graph.
    if(-not [object]::ReferenceEquals($c.resources[2].objectOriginal,$subject)){
      throw 'Original managed parser backing was replaced.'
    }
  } elseif($w.phase -ceq 'build-file-write') {
    $c.resources[$subject.resourceOffset].objectOriginal=$w.outputs[0]
  }
}

function Invoke-CoreInputPhase {
  param($HostOwnerOriginal,[string]$Phase,$EffectOriginal)
  $worker=New-CoreNativeInputPhase $HostOwnerOriginal $Phase $EffectOriginal
  try {
    $null=Start-CoreNativeInputPhase $worker
    return Wait-CoreNativeInputPhase $worker
  } finally {
    # Actual output references are published even when completion interpretation
    # throws. A pending worker still owns its original arrays until actual join.
    if($worker.terminalJoined){Publish-CoreInputWorkerResources $worker}
  }
}

function Read-CoreNativeInputRoot {
  param($HostOwnerOriginal,[string]$Path,[long]$Bytes,[string]$Sha256)
  $p=$HostOwnerOriginal
  if(-not $p.receiver.frames.ContainsKey($p.key) -or -not [object]::ReferenceEquals($p.receiver.frames[$p.key],$p) -or
    $Bytes -le 0 -or $Bytes -ge [int]::MaxValue -or -not (Test-CoreFullyQualifiedWindowsPath $Path) -or $Sha256 -notmatch '^[0-9a-fA-F]{64}$') {
    throw 'Original independently admitted root extent/path/hash/host required before effects.'
  }
  if($null -ne $p.inputRead.capture){throw 'Original root capture cannot be reset.'}
  $c=@{kind='core.native-producer-input.v1';rootPath=$Path;rootBytes=$Bytes;rootSha256=$Sha256;
    subjects=$null;resources=$null;priorResourceRoster=$null;managedPhases=$null;managedPhaseCount=5;
    parseOriginal=$null;nodeOriginals=$null;propertyOriginals=$null;rootOriginal=$null;memberCount=0;failureOriginal=$null;
    membersEnrolled=$false;structuralReturned=$false;disposalVisited=$false;nativeAssociationOriginals=$null;heldMetadataQueries=$null;nativeSubjectHolds=$null;nativeSubjectEffects=$null;nativePathSources=$null;
    payloadCopies=$null;payloadCopyByRole=$null;selectedSourcesOriginal=$null;repositoryRoot=$null;buildWrites=$null;buildWriteByRole=$null;buildWriteResourceOffset=0;buildWriteRetainedPayloadBytes=0L;buildDirectories=$null;buildDirectoryByRole=$null}
  $p.inputRead.capture=$c
  try {
  $c.payloadCopies=[Collections.Generic.List[object]]::new(5)
  $c.payloadCopyByRole=[Collections.Generic.Dictionary[string,object]]::new([StringComparer]::Ordinal)
  $c.buildWrites=[Collections.Generic.List[object]]::new(5)
  $c.buildWriteByRole=[Collections.Generic.Dictionary[string,object]]::new([StringComparer]::Ordinal)
  $c.buildDirectories=[Collections.Generic.List[object]]::new(2)
  $c.buildDirectoryByRole=[Collections.Generic.Dictionary[string,object]]::new([StringComparer]::Ordinal)
  $c.nativeSubjectHolds=[Collections.Generic.List[object]]::new()
  $c.nativeSubjectEffects=[Collections.Generic.List[object]]::new()
  $c.nativePathSources=[Collections.Generic.List[object]]::new()
  $c.subjects=[Collections.Generic.List[object]]::new(1)
  $c.managedPhases=[Collections.Generic.List[object]]::new(5)
  $c.resources=New-CoreInputResourceRoster 3
  foreach($resource in $c.resources){$resource.captureOriginal=$c}
  $c.nodeOriginals=[Collections.ArrayList]::new([int]$Bytes)
  $c.propertyOriginals=[Collections.ArrayList]::new([int]$Bytes)
  $subject=@{captureOriginal=$c;role='input-root';path=$Path;bytes=$null;resourceOffset=0;
    stream=$null;hashOriginal=$null;digestOriginal=$null;exception=$null;actualLength=0L;
    openAttempted=$false;openReturned=$false;hashAttempted=$false;hashReturned=$false;used=0;eof=$false}
  $c.subjects.Add($subject)
  $subject.bytes=[byte[]]::new([int]($Bytes+1))
  $subject.readCountsOriginal=[int[]]::new([int]($Bytes+1))
  $c.resources[0].sourceOriginal=$subject;$c.resources[1].sourceOriginal=$subject
  $null=Invoke-CoreInputPhase $p 'subject-read-hash' $subject
  if($subject.readCallAttemptedCount -ne $subject.readCallReturnedCount -or $subject.readCallReturnedCount -le 0 -or $subject.readCallReturnedCount -gt $subject.readCountsOriginal.Length){throw 'Original root read-call transcript is incomplete.'}
  $readExtent=0L
  for($readIndex=0;$readIndex -lt $subject.readCallReturnedCount;$readIndex++) {
    Observe-OwnedPrerequisiteDeadline $p
    $rawCount=$subject.readCountsOriginal[$readIndex]
    if(($readIndex -eq $subject.readCallReturnedCount-1 -and $rawCount -ne 0) -or
      ($readIndex -lt $subject.readCallReturnedCount-1 -and $rawCount -le 0)){throw 'Original root read transcript lacks exact terminal EOF.'}
    $readExtent+=$rawCount
  }
  $subject.readExtentOriginal=$readExtent
  if($readExtent -ne $subject.used){throw 'Original root read extents differ from retained raw bytes.'}
  if(-not $subject.eof -or $subject.used -ne $Bytes -or $subject.actualLength -ne $Bytes){throw 'Held root extent/EOF differs from original admitted bytes.'}
  $actualHash=[BitConverter]::ToString($subject.digestOriginal).Replace('-', '').ToLowerInvariant()
  if($actualHash -ine $Sha256){throw 'Held original input root digest differs.'}
  $parse=@{captureOriginal=$c;sourceOriginal=$subject;grammarRootOriginal=$null;decodedRootOriginal=$null;
    cursorOriginal=$null;tokensOriginal=$null;grammarInvocationOriginal=$null;conversionOriginal=$null;
    exception=$null;effectReturned=$false;backingAllocationReturned=$false}
  $c.parseOriginal=$parse;$c.resources[2].sourceOriginal=$parse;$c.resources[2].objectOriginal=$parse
  $c.resources[2].kind='managed-json-backing';$c.resources[2].lifetime='host-process'
  try {
  $parse.cursorOriginal=[int[]]::new(1)
  $parse.tokensOriginal=[Collections.ArrayList]::new()
  $parse.grammarInvocationOriginal=[object[]]::new(3)
  $parse.conversionOriginal=[object[]]::new(11)
  $parse.conversionOriginal[0]=$c.nodeOriginals;$parse.conversionOriginal[1]=$c.propertyOriginals
  $parse.conversionOriginal[7]=[int[]]@([int]$Bytes)
  $parse.conversionOriginal[9]=[long[]]@($p.originalDeadlineTicks,0)
  $parse.conversionOriginal[10]=[int[]]::new(2)
  $parse.backingAllocationReturned=$true
  }catch{$parse.exception=$_;throw}
  $null=Invoke-CoreInputPhase $p 'root-json-parse' $parse
  $c.rootOriginal=$parse.decodedRootOriginal
  if($c.rootOriginal -isnot [Collections.IDictionary]){throw 'Fixed producer root must be one JSON object.'}
  return $c.rootOriginal
  }catch{$c.failureOriginal=$_;throw}
}

function Initialize-CoreInputMembers {
  param($HostOwnerOriginal,$Members)
  $c=$HostOwnerOriginal.inputRead.capture
  if($c.membersEnrolled -or $null -eq $Members -or $Members -isnot [array] -or $Members.Count -gt $c.rootBytes){throw 'Actual bounded root member array required once.'}
  # Root read/parse + four input borrowers + five write/dispose pairs +
  # three root disposers + two directories + generated open/copy/hash/two
  # disposers, then each member hash and two member disposers.
  [decimal]$phaseCount=29+4*[decimal]$Members.Count
  [decimal]$resourceCount=10+2*[decimal]$Members.Count
  if($phaseCount -gt [int]::MaxValue -or $resourceCount -gt [int]::MaxValue){throw 'Source-derived member geometry cannot be represented.'}
  $c.priorResourceRoster=$c.resources
  $newResources=New-CoreInputResourceRoster ([int]$resourceCount)
  [Array]::Copy($c.resources,0,$newResources,0,3)
  $c.resources=$newResources
  foreach($resource in $c.resources){$resource.captureOriginal=$c}
  $c.managedPhases.Capacity=[int]$phaseCount
  $c.managedPhaseCount=[int]$phaseCount
  $c.subjects.Capacity=2+$Members.Count
  $c.heldMetadataQueries=[Collections.Generic.List[object]]::new(2+$Members.Count)
  $c.nativeAssociationOriginals=@{hostOwnerOriginal=$HostOwnerOriginal;heldMetadataQueriesOriginal=$c.heldMetadataQueries;
    ancestorAcquisitionOriginals=$c.nativeSubjectHolds;leafAcquisitionOriginals=$c.nativeSubjectHolds;pathSourcesOriginal=$c.nativePathSources;principalOriginals=$null;loadedImageOriginals=$null;nativeAuthority='UNKNOWN'}
  for($index=0;$index -lt $Members.Count;$index++) {
    Observe-OwnedPrerequisiteDeadline $HostOwnerOriginal
    if($HostOwnerOriginal.deadlineReported){throw 'Original deadline expired before member enrollment.'}
    $entry=$Members[$index]
    $subject=@{captureOriginal=$c;role='input-member';path=$entry.path;bytes=$null;resourceOffset=3+2*$index;
      declaredOriginal=$entry;stream=$null;hashOriginal=$null;digestOriginal=$null;exception=$null;actualLength=0L;
      openAttempted=$false;openReturned=$false;hashAttempted=$false;hashReturned=$false;used=0;eof=$false}
    $c.subjects.Add($subject)
    $c.resources[$subject.resourceOffset].sourceOriginal=$subject
    $c.resources[$subject.resourceOffset+1].sourceOriginal=$subject
  }
  $c.memberCount=$Members.Count;$c.membersEnrolled=$true
  $c.buildWriteResourceOffset=3+2*$Members.Count
}

function Read-CoreNativeHeldMetadata {
  param($HostOwnerOriginal,$AbiOriginal,$SubjectOriginal)
  $p=$HostOwnerOriginal;$c=$p.inputRead.capture;$subject=$SubjectOriginal
  if(-not $c.subjects.Contains($subject) -or $subject.role -cnotin @('input-root','input-member','generated-candidate') -or
    $null -eq $subject.handleOriginal -or $subject.handleOriginal.IsClosed -or
    -not $subject.readWorkerOriginal.terminalJoined -or $subject.readWorkerOriginal.thread.IsAlive){throw 'Actual SAME terminal held subject required.'}
  foreach($prior in $c.heldMetadataQueries){if([object]::ReferenceEquals($prior.sourceSubjectOriginal,$subject)){throw 'Once-only held metadata subject required.'}}
  $effect=@{captureOriginal=$c;sourceSubjectOriginal=$subject;handleOriginal=$subject.handleOriginal;abiOriginal=$AbiOriginal;
    nativeTypeOriginal=$p.inputRecipes['held-metadata'].nativeTypeOriginal;delegateOriginal=$AbiOriginal.delegates['GetFileInformationByHandleEx'];
    buffersOriginal=$null;rosterAllocationAttempted=$false;rosterAllocationReturned=$false;firstAllocationAttempted=$false;firstAllocationReturned=$false;secondAllocationAttempted=$false;secondAllocationReturned=$false;
    phaseWorkerOriginal=$null;effectReturned=$false;metadataReturned=$false;nativeAuthority='UNKNOWN';reservationOriginal=$p.inputRead.value.budget.heldMetadataReservationBytes}
  $c.heldMetadataQueries.Add($effect)
  $effect.rosterAllocationAttempted=$true;$effect.buffersOriginal=[object[]]::new(2);$effect.rosterAllocationReturned=$true
  $effect.firstAllocationAttempted=$true;$effect.buffersOriginal[0]=[byte[]]::new(8);$effect.firstAllocationReturned=$true
  $effect.secondAllocationAttempted=$true;$effect.buffersOriginal[1]=[byte[]]::new(24);$effect.secondAllocationReturned=$true
  $worker=New-CoreNativeInputPhase $p 'held-metadata' $effect
  $null=Start-CoreNativeInputPhase $worker;$null=Wait-CoreNativeInputPhase $worker
  if($worker.results[20] -eq 0 -or $worker.results[21] -eq 0){throw 'Actual held file metadata query returned failure; raw native results are retained.'}
  $effect.metadataReturned=$true
  return $effect
}

function Read-CoreNativeSubjectNamespace {
  param($HostOwnerOriginal,$AbiOriginal,$SourceOriginal)
  $p=$HostOwnerOriginal;$c=$p.inputRead.capture;$source=$SourceOriginal
  $isFile=$c.subjects.Contains($source)
  $isDirectory=$c.buildDirectories.Contains($source)
  if((-not $isFile -and -not $isDirectory) -or -not $c.structuralReturned -or -not $c.membersEnrolled){throw 'SAME fixed actual input/generated/directory subject required.'}
  if($c.nativePathSources.Contains($source)){throw 'Once-only original namespace source required.'}
  if($isFile -and (-not $source.readWorkerOriginal.terminalJoined -or $source.readWorkerOriginal.thread.IsAlive)){throw 'Actual terminal SAME held file required.'}
  if($isDirectory -and (-not $source.effectReturned -or $source.resultCellsOriginal[12] -eq 0)){throw 'Actual created fixed directory required.'}
  $pathOwner=@{sourceOriginal=$source;originalPath=$source.path;componentPaths=$null;holds=$null;rosterReturned=$false;joinReturned=$false;nativeAuthority='UNKNOWN'}
  $c.nativePathSources.Add($source)
  # Keep this complete actual path record even if component enumeration fails.
  if(-not $c.Contains('nativePathOwners')){$c.nativePathOwners=[Collections.Generic.List[object]]::new()}
  $c.nativePathOwners.Add($pathOwner)
  $pathOwner.componentPaths=[Collections.Generic.List[string]]::new()
  $current=$source.path
  while($null -ne $current -and $current.Length -gt 0) {
    if($pathOwner.componentPaths.Count -gt $source.path.Length){throw 'Actual path component geometry escaped original string extent.'}
    $pathOwner.componentPaths.Add($current)
    $parent=[IO.Path]::GetDirectoryName($current)
    if($null -eq $parent -or $parent.Length -eq 0 -or $parent -ceq $current){break}
    $current=$parent
  }
  $pathOwner.componentPaths.Reverse()
  $pathOwner.holds=[Collections.Generic.List[object]]::new($pathOwner.componentPaths.Count)
  [decimal]$phaseCount=[decimal]$c.managedPhaseCount+3*[decimal]$pathOwner.componentPaths.Count
  if($phaseCount -gt [int]::MaxValue){throw 'Actual native path phase geometry cannot be represented.'}
  $c.managedPhases.Capacity=[int]$phaseCount;$c.managedPhaseCount=[int]$phaseCount
  for($index=0;$index -lt $pathOwner.componentPaths.Count;$index++) {
    $hold=@{captureOriginal=$c;pathOwnerOriginal=$pathOwner;sourceOriginal=$source;path=$pathOwner.componentPaths[$index];
      role=$(if($index -eq $pathOwner.componentPaths.Count-1){'leaf'}else{'ancestor'});directoryExpected=($isDirectory -or $index -lt $pathOwner.componentPaths.Count-1);
      openOriginal=$null;metadataOriginal=$null;disposalOriginal=$null;pointerCellsOriginal=$null;disposalEligible=$false;disposalAttempted=$false;disposalReturned=$false;
      metadataReturned=$false;identityJoined=$false;reservationOriginal=$p.inputRead.value.budget.heldMetadataReservationBytes;nativeAuthority='UNKNOWN'}
    $c.nativeSubjectHolds.Add($hold);$pathOwner.holds.Add($hold)
    foreach($phase in @('native-subject-open','native-subject-metadata','native-subject-dispose')) {
      $name=switch($phase){'native-subject-open'{'CreateFileW'}'native-subject-metadata'{'GetFileInformationByHandleEx'}'native-subject-dispose'{'CloseHandle'}}
      $effect=@{captureOriginal=$c;holdOriginal=$hold;abiOriginal=$AbiOriginal;nativeTypeOriginal=$p.inputRecipes[$phase].nativeTypeOriginal;delegateOriginal=$AbiOriginal.delegates[$name];phaseWorkerOriginal=$null;buffersOriginal=$null;effectReturned=$false;
        rosterAllocationAttempted=$false;rosterAllocationReturned=$false;firstAllocationAttempted=$false;firstAllocationReturned=$false;secondAllocationAttempted=$false;secondAllocationReturned=$false}
      $c.nativeSubjectEffects.Add($effect)
      switch($phase){'native-subject-open'{$hold.openOriginal=$effect}'native-subject-metadata'{$hold.metadataOriginal=$effect}'native-subject-dispose'{$hold.disposalOriginal=$effect}}
    }
    $query=$hold.metadataOriginal
    $query.rosterAllocationAttempted=$true;$query.buffersOriginal=[object[]]::new(2);$query.rosterAllocationReturned=$true
    $query.firstAllocationAttempted=$true;$query.buffersOriginal[0]=[byte[]]::new(8);$query.firstAllocationReturned=$true
    $query.secondAllocationAttempted=$true;$query.buffersOriginal[1]=[byte[]]::new(24);$query.secondAllocationReturned=$true
  }
  $pathOwner.rosterReturned=$true
  foreach($hold in $pathOwner.holds) {
    $null=Invoke-CoreInputPhase $p 'native-subject-open' $hold.openOriginal
    if($hold.pointerCellsOriginal[1] -eq [IntPtr]::Zero -or $hold.pointerCellsOriginal[1] -eq [IntPtr]::new(-1)){throw 'Original native subject open returned no handle; raw error retained.'}
    $null=Invoke-CoreInputPhase $p 'native-subject-metadata' $hold.metadataOriginal
    $query=$hold.metadataOriginal
    if($query.resultCellsOriginal[20] -eq 0 -or $query.resultCellsOriginal[21] -eq 0){throw 'Original native subject metadata returned failure.'}
    $hold.metadataReturned=$true
    $attributes=[BitConverter]::ToUInt32($query.buffersOriginal[0],0)
    if(($attributes -band 0x400) -ne 0 -or ((($attributes -band 0x10) -ne 0) -ne $hold.directoryExpected)){throw 'Actual native namespace component is redirected or has a different kind.'}
    if($hold.role -ceq 'leaf' -and $isFile) {
      $managed=$null
      foreach($candidate in $c.heldMetadataQueries){if([object]::ReferenceEquals($candidate.sourceSubjectOriginal,$source)){$managed=$candidate;break}}
      if($null -eq $managed -or -not $managed.metadataReturned){throw 'Actual SAME managed-held metadata required for leaf join.'}
      for($byte=0;$byte -lt 24;$byte++){if($managed.buffersOriginal[1][$byte] -ne $query.buffersOriginal[1][$byte]){throw 'Native named leaf differs from SAME managed-held volume/FileId original.'}}
    }
    $hold.identityJoined=$true
  }
  $pathOwner.joinReturned=$true
  # Actual held joins alone do not grant principal, loaded-image or native authority.
  return $pathOwner
}

function New-CoreNativeBuildDirectory {
  param($HostOwnerOriginal,$Abi,[Parameter(Mandatory)][ValidateSet('output-root','child-temp')][string]$Role)
  $p=$HostOwnerOriginal;$c=$p.inputRead.capture
  if(-not $c.structuralReturned -or -not $c.membersEnrolled -or $c.buildDirectoryByRole.ContainsKey($Role)){throw 'Once-only fixed build directory required.'}
  $path=if($Role -ceq 'output-root'){$p.inputRead.value.outputRoot}else{Join-Path $p.inputRead.value.outputRoot 'temp'}
  if(-not (Test-CoreFullyQualifiedWindowsPath $path) -or $path.IndexOf([char]0) -ge 0){throw 'Fixed absolute output directory path required.'}
  if($Role -ceq 'child-temp' -and (-not $c.buildDirectoryByRole.ContainsKey('output-root') -or -not $c.buildDirectoryByRole['output-root'].usefulReturned)){throw 'Actual original output-root creation must precede child temp.'}
  $effect=@{captureOriginal=$c;role=$Role;path=$path;abiOriginal=$Abi;delegateOriginal=$Abi.delegates['CreateDirectoryW'];
    nativeTypeOriginal=$p.inputRecipes['build-directory'].nativeTypeOriginal;pointerCellsOriginal=$null;resultCellsOriginal=$null;allocationAttempted=$false;allocationReturned=$false;
    nativeAttempted=$false;nativeReturned=$false;
    freeAttempted=$false;freeReturned=$false;freeOriginal=$null;original=$null;effectReturned=$false;usefulReturned=$false}
  $c.buildDirectoryByRole.Add($Role,$effect);$c.buildDirectories.Add($effect)
  $effect.reservationOriginal=$p.inputRead.value.budget.buildFileWriteReservationBytes
  [decimal]$pathExtent=2*([decimal]$path.Length+1)
  if($pathExtent+$c.buildWriteRetainedPayloadBytes -ge $effect.reservationOriginal){throw 'Fixed directory path storage exceeds the genuine complete output reservation.'}
  $c.buildWriteRetainedPayloadBytes+=[long]$pathExtent
  $null=Invoke-CoreInputPhase $p 'build-directory' $effect
  if(-not $effect.nativeReturned -or $null -eq $effect.resultCellsOriginal -or $effect.resultCellsOriginal[12] -eq 0 -or
    -not $effect.freeReturned -or $null -ne $effect.freeOriginal -or $p.deadlineReported){throw 'Fixed native exclusive directory creation/free did not complete before original deadline.'}
  # CreateDirectoryW fails when the leaf already exists. This actual return is
  # not proof of principal, ancestor exclusion, held identity or no replacement.
  $effect.usefulReturned=$true
  return $effect
}

function Write-CoreNativeBuildFile {
  param($HostOwnerOriginal,[Parameter(Mandatory)][ValidateSet('initializer','environment','candidate-binary','candidate-provenance','candidate-disposition')][string]$Role,[Parameter(Mandatory)]$Payload)
  $p=$HostOwnerOriginal;$c=$p.inputRead.capture
  if(-not $c.structuralReturned -or -not $c.membersEnrolled -or $c.buildWriteByRole.ContainsKey($Role)){throw 'Once-only fixed build output required.'}
  $name=switch -CaseSensitive ($Role) {
    'initializer' {'initialize-native-env.cmd'}
    'environment' {'PRIVATE-initialized-environment.json'}
    'candidate-binary' {'candidate.normalized.exe'}
    'candidate-provenance' {'candidate.provenance.json'}
    'candidate-disposition' {'candidate.disposition.json'}
  }
  $offset=$c.buildWriteResourceOffset+$c.buildWrites.Count
  $effect=@{captureOriginal=$c;role=$Role;path=(Join-Path $p.inputRead.value.outputRoot $name);resourceOffset=$offset;
    payloadOriginal=$Payload;encodingOriginal=$null;bytes=$null;encodingAttempted=$false;encodingReturned=$false;reservationOriginal=$p.inputRead.value.budget.buildFileWriteReservationBytes;
    streamOriginal=$null;openAttempted=$false;openReturned=$false;writeAttempted=$false;writeReturned=$false;
    flushAttempted=$false;flushReturned=$false;effectReturned=$false;original=$null;primaryPresent=$false;primary=$null;disposalOriginal=$null}
  $c.buildWriteByRole.Add($Role,$effect);$c.buildWrites.Add($effect)
  $resource=$c.resources[$offset];$resource.sourceOriginal=$effect
  try {
    Observe-OwnedPrerequisiteDeadline $p
    if($p.deadlineReported){throw 'Original deadline forbids output encoding or write.'}
    # This is only a minimum payload-extent check inside the independently
    # derived complete five-role reservation. It is not allocator/worker fit.
    [decimal]$payloadExtent=if($Payload -is [byte[]]){$Payload.Length}elseif($Payload -is [string]){5*[decimal]$Payload.Length}else{throw 'Fixed output payload shape required.'}
    if($Role -ceq 'candidate-binary') {
      if(-not $c.Contains('generatedCandidateOriginal') -or -not $c.generatedCandidateOriginal.normalizationReturned -or
        -not [object]::ReferenceEquals($Payload,$c.generatedCandidateOriginal.normalizedBytesOriginal)){throw 'Candidate write must borrow SAME charged normalized image.'}
      $effect.borrowedImageOriginal=$c.generatedCandidateOriginal
      # The retained array is already in the disjoint compiler-image subtotal.
      # This output reservation covers independent writer state, not its bytes twice.
      $payloadExtent=0
    }
    if($payloadExtent+$c.buildWriteRetainedPayloadBytes -ge $effect.reservationOriginal){throw 'Fixed output payload overlap exceeds its genuine complete reservation before encoding.'}
    $c.buildWriteRetainedPayloadBytes+=[long]$payloadExtent
    if($Role -cin @('candidate-binary','candidate-provenance')) {
      if($Payload -isnot [byte[]]){throw 'Fixed candidate byte payload required.'}
      $effect.bytes=$Payload
    } else {
      if($Payload -isnot [string]){throw 'Fixed output text payload required.'}
      $effect.encodingAttempted=$true
      # Match the original WriteAllText UTF8Encoding(false) replacement fallback.
      $effect.encodingOriginal=[Text.UTF8Encoding]::new($false)
      $effect.bytes=$effect.encodingOriginal.GetBytes($Payload)
      $effect.encodingReturned=$true
    }
    $null=Invoke-CoreInputPhase $p 'build-file-write' $effect
  } catch {$effect.primaryPresent=$true;$effect.primary=$_}
  # Dispose an actual returned stream independently even if Write/Flush failed.
  # A nonreturned constructor stays unknown; no invented CLR rollback.
  if($null -ne $resource.objectOriginal) {
    try {$null=Invoke-CoreInputPhase $p 'resource-dispose' $resource}
    catch {$effect.disposalOriginal=$_}
  }
  if($effect.primaryPresent){throw $effect.primary}
  if($null -ne $effect.disposalOriginal){throw $effect.disposalOriginal}
  if(-not $effect.effectReturned -or -not $resource.disposalReturned){throw 'Fixed output did not complete write/flush/disposal.'}
  return $effect
}

function Read-CoreNativeInputMember {
  param($HostOwnerOriginal,[int]$Index)
  $c=$HostOwnerOriginal.inputRead.capture
  if(-not $c.membersEnrolled -or $Index -lt 0 -or $Index -ge $c.memberCount){throw 'Original member index required.'}
  $subject=$c.subjects[$Index+1]
  if($subject.declaredOriginal.sha256 -isnot [string] -or $subject.declaredOriginal.sha256 -cnotmatch '^[0-9a-fA-F]{64}$'){throw 'Original member digest shape is invalid before hash acquisition.'}
  $null=Invoke-CoreInputPhase $HostOwnerOriginal 'member-hash' $subject
  $entry=$subject.declaredOriginal
  if(-not $subject.eofProbeReturned -or $subject.eofProbeOriginal -ne -1 -or -not $subject.endPositionReturned -or $subject.endPositionOriginal -ne $entry.byteLength -or $subject.actualLength -ne $entry.byteLength -or [BitConverter]::ToString($subject.digestOriginal).Replace('-', '') -ine $entry.sha256){throw 'SAME held producer member extent/observed EOF/hash differs.'}
  return $subject
}

function Read-CoreNativeInputPayload {
  param($HostOwnerOriginal,[Parameter(Mandatory)][ValidateSet('native-source','historical-managed-data','shipped-native-data','shipped-provenance-data')][string]$Role)
  $p=$HostOwnerOriginal;$c=$p.inputRead.capture
  if(-not $c.structuralReturned -or -not $c.membersEnrolled -or $c.payloadCopyByRole.ContainsKey($Role)){throw 'One original fixed canonical payload borrower required.'}
  $relative=switch -CaseSensitive ($Role) {
    'native-source' {'src/runtime/execution/windows-managed-launcher-native-bootstrap.c'}
    'historical-managed-data' {'src/runtime/execution/windows-managed-launcher-managed.exe'}
    'shipped-native-data' {'src/runtime/execution/windows-managed-launcher-native.exe'}
    'shipped-provenance-data' {'src/runtime/execution/windows-managed-launcher-native.provenance.json'}
  }
  $path=Join-Path $c.repositoryRoot $relative
  $subject=$null
  foreach($candidate in $c.subjects){if($candidate.role -ceq 'input-member' -and $candidate.path -ieq $path){$subject=$candidate;break}}
  return Read-CoreNativeHeldSourceBody $p $subject $Role
}

function Read-CoreNativeHeldSourceBody {
  param($HostOwnerOriginal,$SubjectOriginal,[string]$Role)
  $p=$HostOwnerOriginal;$c=$p.inputRead.capture;$subject=$SubjectOriginal
  $sameSubject=$false
  foreach($candidate in $c.subjects){if([object]::ReferenceEquals($candidate,$subject)){$sameSubject=$true;break}}
  if(-not $c.structuralReturned -or -not $c.membersEnrolled -or -not $sameSubject -or
    $subject.role -cne 'input-member' -or $c.payloadCopyByRole.ContainsKey($Role)){throw 'Once-only enrolled original member body required.'}
  if($null -eq $subject -or $null -eq $subject.stream -or $null -eq $subject.hashOriginal -or -not $subject.readWorkerOriginal.terminalJoined){throw 'Actual terminal held canonical member required.'}
  $extent=$subject.declaredOriginal.byteLength
  if($extent -lt 0 -or $extent -ge [int]::MaxValue){throw 'Original payload copy extent cannot be represented.'}
  $copy=@{captureOriginal=$c;role=$Role;sourceSubjectOriginal=$subject;streamOriginal=$subject.stream;stream=$subject.stream;
    hashOriginal=$subject.hashOriginal;bytes=$null;exactBytesOriginal=$null;readCountsOriginal=$null;digestOriginal=$null;
    actualLength=0L;used=0;eof=$false;returned=$false;exception=$null}
  $c.payloadCopyByRole.Add($Role,$copy);$c.payloadCopies.Add($copy)
  $copy.bytes=[byte[]]::new([int]($extent+1))
  $copy.exactBytesOriginal=[byte[]]::new([int]$extent)
  $copy.readCountsOriginal=[int[]]::new([int]($extent+1))
  $null=Invoke-CoreInputPhase $p 'held-payload-copy' $copy
  if(-not $copy.seekReturned -or $copy.seekPositionOriginal -ne 0 -or -not $copy.eof -or $copy.used -ne $extent -or
    $copy.actualLength -ne $extent -or -not $copy.endPositionReturned -or $copy.endPositionOriginal -ne $extent -or
    -not $copy.exactCopyReturned -or $copy.readCallAttemptedCount -ne $copy.readCallReturnedCount -or $copy.readCallReturnedCount -le 0){throw 'Original held payload copy is incomplete.'}
  $sum=0L
  for($index=0;$index -lt $copy.readCallReturnedCount;$index++){
    Observe-OwnedPrerequisiteDeadline $p
    $count=$copy.readCountsOriginal[$index]
    if(($index -eq $copy.readCallReturnedCount-1 -and $count -ne 0) -or ($index -lt $copy.readCallReturnedCount-1 -and $count -le 0)){throw 'Held payload transcript lacks exact EOF.'}
    $sum+=$count
  }
  $copy.readExtentOriginal=$sum
  if($sum -ne $extent -or [BitConverter]::ToString($copy.digestOriginal).Replace('-', '') -cne [BitConverter]::ToString($subject.digestOriginal).Replace('-', '')){throw 'SAME held payload extent/digest changed.'}
  $copy.returned=$true
  return $copy
}

function Read-CoreNativeCompilerReportedHeaders {
  param($HostOwnerOriginal,$CompilerOriginal)
  $p=$HostOwnerOriginal;$c=$p.inputRead.capture;$selected=$c.selectedSourcesOriginal
  if($null -eq $selected -or $null -ne $selected.headersOriginal -or
    -not [object]::ReferenceEquals($selected.compilerOriginal,$CompilerOriginal)){throw 'Once-only SAME compiler occurrence required for reported header custody.'}
  $owner=@{compilerOriginal=$CompilerOriginal;pathOriginal=$null;rows=$null;bodies=$null;
    pendingBodyOriginal=$null;resolved=$false;returned=$false;failed=$false;exception=$null;selectedReportOriginal=$null;nativeAuthority='UNKNOWN'}
  $selected.headersOriginal=$owner
  try {
    $owner.bodies=[Collections.Generic.List[object]]::new()
    $paths=$CompilerOriginal.dependencyOutputOriginal.pathOccurrencesOriginal;$owner.pathOriginal=$paths
    if($null -eq $paths -or -not $paths.returned){throw 'Original reported path occurrence acquisition is incomplete.'}
    [long]$count=0
    foreach($report in $paths.reports){if($null -ne $report.includes){$count+=$report.includes.Length}}
    if($count -gt [int]::MaxValue){throw 'Reported header occurrence geometry cannot be represented.'}
    $owner.rows=[object[]]::new([int]$count);$ordinal=0
    foreach($report in $paths.reports) { foreach($reported in $report.includes) {
      $owner.rows[$ordinal]=@{ordinal=$ordinal;reportOriginal=$report;reportedOriginal=$reported;exactMatches=$null;
        caseOnlyMatches=$null;resolution='PENDING';subjectOriginal=$null;bodyRowOriginal=$null;compilerReadOriginal=$null}
      $ordinal++
    }}
    foreach($row in $owner.rows) {
      $row.exactMatches=[Collections.Generic.List[object]]::new()
      $row.caseOnlyMatches=[Collections.Generic.List[object]]::new()
      if(-not $row.reportedOriginal.stringPath){$row.resolution='NONSTRING_REPORTED_VALUE';continue}
      foreach($subject in $c.subjects) {
        if($subject.role -cne 'input-member'){continue}
        if([StringComparer]::Ordinal.Equals($subject.path,$row.reportedOriginal.value)){$row.exactMatches.Add($subject)}
        elseif([StringComparer]::OrdinalIgnoreCase.Equals($subject.path,$row.reportedOriginal.value)){$row.caseOnlyMatches.Add($subject)}
      }
      if($row.exactMatches.Count -ne 1){
        $row.resolution=if($row.exactMatches.Count -gt 1){'AMBIGUOUS_EXACT_LOCATORS'}elseif($row.caseOnlyMatches.Count){'CASE_ONLY_LOCATOR_OBSERVATION'}else{'NO_ENROLLED_EXACT_LOCATOR'}
        continue
      }
      # Exact string equality chooses an already held candidate only. It does
      # not establish that the compiler read this native subject or its bytes.
      $row.subjectOriginal=$row.exactMatches[0]
      $row.resolution=if($row.caseOnlyMatches.Count){'EXACT_LOCATOR_WITH_CASE_ALIASES_CANDIDATE'}else{'EXACT_LOCATOR_CANDIDATE'}
      foreach($bodyRow in $owner.bodies){if([object]::ReferenceEquals($bodyRow.subjectOriginal,$row.subjectOriginal)){$row.bodyRowOriginal=$bodyRow;break}}
      if($null -eq $row.bodyRowOriginal) {
        $bodyRow=@{ordinal=$owner.bodies.Count;subjectOriginal=$row.subjectOriginal;copyOriginal=$null;borrowed=$false;
          attempted=$false;returned=$false;failed=$false;exception=$null;compilerReadOriginal=$null;nativeAuthority='UNKNOWN'}
        $owner.pendingBodyOriginal=$bodyRow;$owner.bodies.Add($bodyRow);$row.bodyRowOriginal=$bodyRow
        foreach($copy in $c.payloadCopies){if($copy.returned -and [object]::ReferenceEquals($copy.sourceSubjectOriginal,$bodyRow.subjectOriginal)){$bodyRow.copyOriginal=$copy;$bodyRow.borrowed=$true;break}}
      } else {$row.resolution='DUPLICATE_EXACT_LOCATOR_CANDIDATE'}
    }
    $owner.resolved=$true
    [long]$additional=0
    foreach($bodyRow in $owner.bodies){if(-not $bodyRow.borrowed){$additional++}}
    [decimal]$phaseCount=[decimal]$c.managedPhaseCount+$additional
    [decimal]$payloadCapacity=[decimal]$c.payloadCopies.Capacity+$additional
    if($phaseCount -gt [int]::MaxValue -or $payloadCapacity -gt [int]::MaxValue){throw 'Reported held body schedule geometry cannot be represented.'}
    $c.managedPhases.Capacity=[int]$phaseCount;$c.managedPhaseCount=[int]$phaseCount
    $c.payloadCopies.Capacity=[int]$payloadCapacity
    foreach($bodyRow in $owner.bodies) {
      $bodyRow.attempted=$true
      try {
        if(-not $bodyRow.borrowed){$bodyRow.copyOriginal=Read-CoreNativeHeldSourceBody $p $bodyRow.subjectOriginal ('compiler-reported-header-'+$bodyRow.ordinal)}
        $bodyRow.returned=$true
      } catch {$bodyRow.exception=$_;$bodyRow.failed=$true;throw}
    }
    $owner.returned=$true;return $owner
  } catch {$owner.exception=$_;$owner.failed=$true;throw}
}

function Read-CoreNativeSelectedSourceInputs {
  param($HostOwnerOriginal)
  $p=$HostOwnerOriginal;$c=$p.inputRead.capture
  if(-not $c.structuralReturned -or $null -ne $c.selectedSourcesOriginal){throw 'Once-only selected source acquisition required.'}
  $owner=@{captureOriginal=$c;rows=$null;resolved=$false;returned=$false;failed=$false;exception=$null;
    bootstrapBorrowOriginal=$null;compilerOriginal=$null;headersOriginal=$null;conditionsOriginal=$null;nativeAuthority='UNKNOWN'}
  $c.selectedSourcesOriginal=$owner
  try {
    $selection=@(
      @('L-managed','src/runtime/execution/windows-managed-launcher-native.cs'),
      @('L-acquisition','scripts/native/core1681-acquisition.cs'),@('L-msi','scripts/native/core1681-msi.cs'),
      @('L-trust','scripts/native/core1681-trust.cs'),@('L-opc','scripts/native/core1681-opc.cs'),
      @('L-vsix','scripts/native/core1681-vsix-bytes.cs'),
      @('L-bootstrap','src/runtime/execution/windows-managed-launcher-native-bootstrap.c'),
      @('L-budget','scripts/windows-compiler-process-budget.ps1'),@('CE-tests','tests/mcp-product-artifact.test.js'),
      @('CE-packaged','scripts/verify-mcp-packaged.mjs'),@('CE-compiler','scripts/verify-windows-process-inspector.ps1'),
      @('H-current','tests/helpers/core1681-managed-closure-source-contract.mjs'),
      @('CE-assets','scripts/copy-runtime-assets.mjs'),@('CD-mcp','scripts/mcp-product-acceptance-lib.mjs'))
    $owner.rows=[object[]]::new($selection.Count)
    for($index=0;$index -lt $selection.Count;$index++) {
      $row=@{ownerOriginal=$owner;ordinal=$index;id=$selection[$index][0];relativePath=$selection[$index][1];
        subjectOriginal=$null;payloadOriginal=$null;resolutionAttempted=$false;resolutionReturned=$false;resolutionFailed=$false;resolutionException=$null;
        attempted=$false;returned=$false;failed=$false;exception=$null}
      $owner.rows[$index]=$row
    }
    foreach($row in $owner.rows) {
      $row.resolutionAttempted=$true
      try {
        $path=Join-Path $c.repositoryRoot $row.relativePath
        foreach($subject in $c.subjects){if($subject.role -ceq 'input-member' -and $subject.path -ieq $path){$row.subjectOriginal=$subject;break}}
        if($null -eq $row.subjectOriginal){throw 'Selected source body is absent from the already acquired input members.'}
        $row.resolutionReturned=$true
      } catch {$row.resolutionException=$_;$row.resolutionFailed=$true;throw}
    }
    $owner.resolved=$true
    # Thirteen new body phases; the existing native-source phase is shared.
    [decimal]$phaseCount=[decimal]$c.managedPhaseCount+$selection.Count-1
    if($phaseCount -gt [int]::MaxValue){throw 'Selected source phase geometry cannot be represented.'}
    $c.managedPhases.Capacity=[int]$phaseCount;$c.managedPhaseCount=[int]$phaseCount
    $c.payloadCopies.Capacity=5+$selection.Count-1
    foreach($row in $owner.rows) {
      $row.attempted=$true
      try {
        $role=if($row.id -ceq 'L-bootstrap'){'native-source'}else{'selected-source:'+$row.id}
        $row.payloadOriginal=Read-CoreNativeHeldSourceBody $p $row.subjectOriginal $role
        $row.returned=$true
      } catch {$row.exception=$_;$row.failed=$true;throw}
    }
    $owner.returned=$true
    return $owner
  } catch {$owner.exception=$_;$owner.failed=$true;throw}
}

function Borrow-CoreNativeSelectedBootstrap {
  param($HostOwnerOriginal)
  $c=$HostOwnerOriginal.inputRead.capture;$owner=$c.selectedSourcesOriginal
  if($null -eq $owner -or -not $owner.returned -or $null -ne $owner.bootstrapBorrowOriginal){throw 'Once-only completed selected bootstrap borrower required.'}
  $borrow=@{ownerOriginal=$owner;payloadOriginal=$null;returned=$false}
  $owner.bootstrapBorrowOriginal=$borrow
  foreach($row in $owner.rows){if($row.id -ceq 'L-bootstrap'){$borrow.payloadOriginal=$row.payloadOriginal;break}}
  if($null -eq $borrow.payloadOriginal){throw 'Actual acquired bootstrap body required.'}
  $borrow.returned=$true
  return $borrow.payloadOriginal
}

function New-CoreCompilerPredefineObservations {
  param($SourceOwnerOriginal,$CompilerOriginal)
  if(-not $SourceOwnerOriginal.returned -or
    -not [object]::ReferenceEquals($SourceOwnerOriginal.compilerOriginal,$CompilerOriginal) -or
    $null -ne $CompilerOriginal.predefinesOriginal -or -not $SourceOwnerOriginal.bootstrapBorrowOriginal.returned){throw 'SAME once-only actual compiler/source occurrence required.'}
  $owner=@{compilerOriginal=$CompilerOriginal;sourceBorrowOriginal=$SourceOwnerOriginal.bootstrapBorrowOriginal;
    rawCaptureOriginal=$CompilerOriginal.dependencyOutputOriginal;phasesOriginal=$null;pendingOriginal=$null;
    sourceRawOriginal=$null;physicalLineStartsOriginal=$null;physicalLineMapReturned=$false;
    rosterReturned=$false;failed=$false;exception=$null;selectedCompilerReadOriginal=$null;nativeAuthority='UNKNOWN'}
  $CompilerOriginal.predefinesOriginal=$owner
  try {
    $owner.sourceRawOriginal=$owner.sourceBorrowOriginal.payloadOriginal.exactBytesOriginal
    if($owner.sourceRawOriginal -isnot [byte[]]){throw 'Actual held bootstrap source bytes required before predefine observation ownership.'}
    [long]$lineCount=1
    foreach($byte in $owner.sourceRawOriginal){if($byte -eq 10){$lineCount++}}
    if($lineCount -gt [int]::MaxValue){throw 'Bootstrap physical source-line map geometry cannot be represented.'}
    $owner.physicalLineStartsOriginal=[long[]]::new([int]$lineCount)
    $line=1
    for($offset=0;$offset -lt $owner.sourceRawOriginal.Length;$offset++) {
      if($owner.sourceRawOriginal[$offset] -eq 10){$owner.physicalLineStartsOriginal[$line]=$offset+1;$line++}
    }
    # Raw physical LF offsets retain changed source-line effects. They do not
    # assert logical #line/continuation/encoding or actual __LINE__ expansion.
    $owner.physicalLineMapReturned=$true
    $names=@('_WIN64','_WIN32','_M_X64','_M_AMD64','_CHAR_UNSIGNED','_MSC_VER','_MSC_FULL_VER',
      '_MSVC_TRADITIONAL','_MSC_EXTENSIONS','_MT','_DLL','_DEBUG','__STDC__','__cplusplus','UNICODE','_UNICODE','_WIN32_WINNT')
    $owner.phasesOriginal=[object[]]::new(2)
    for($phase=0;$phase -lt 2;$phase++) {
      $owner.phasesOriginal[$phase]=@{ordinalOriginal=$phase;phaseOriginal=if($phase -eq 0){'tu-entry'}else{'after-headers'};
        rowsOriginal=$null;sourceDirectivesOriginal=$null;sourceLineEffectsOriginal=$owner;rawCandidatesOriginal=$null;
        selectedCompilerReadOriginal=$null;completeHeaderConditionsOriginal=$null;nativeAuthority='UNKNOWN'}
    }
    foreach($phase in $owner.phasesOriginal) {
      $owner.pendingOriginal=$phase;$phase.rowsOriginal=[object[]]::new($names.Length)
      for($index=0;$index -lt $names.Length;$index++) {
        $phase.rowsOriginal[$index]=@{ordinalOriginal=$index;nameOriginal=$names[$index];phaseOriginal=$phase;
          sourceDirectiveOriginal=$null;rawOccurrencesOriginal=$null;selectedOccurrenceOriginal=$null;
          valueOriginal=$null;statusOriginal='UNINTERPRETED';nativeAuthority='UNKNOWN'}
      }
    }
    $owner.rosterReturned=$true
    return $owner
  } catch {$owner.exception=$_;$owner.failed=$true;throw}
}

function Read-CoreManagedCompilerInputs {
  param($HostOwnerOriginal,$InvocationOriginal)
  $p=$HostOwnerOriginal;$c=$p.inputRead.capture;$invocation=$InvocationOriginal
  if(-not [object]::ReferenceEquals($p.managedCompilerOriginal,$invocation) -or
    -not [object]::ReferenceEquals($invocation.hostOwnerOriginal,$p) -or
    -not $c.structuralReturned -or $c.disposalVisited -or $null -ne $invocation.inputAcquisitionOriginal){throw 'SAME once-only retained managed compiler invocation required.'}
  $owner=@{invocationOriginal=$invocation;rows=$null;pendingOriginal=$null;resolutionReturned=$false;
    returned=$false;failed=$false;exception=$null;referenceResolutionOriginal=$null;runtimeProviderOriginal=$null;nativeAuthority='UNKNOWN'}
  $invocation.inputAcquisitionOriginal=$owner
  try {
    # Only the actual selected compiler determines the default-response locator.
    # This does not assert that its CLR system directory equals this directory.
    $responsePath=Join-Path ([IO.Path]::GetDirectoryName($invocation.compilerPathOriginal)) 'csc.rsp'
    # Row backing is allocated once after the closed source selection.
    # Adjacency supplies a candidate locator only. Its acquired bytes do not
    # establish that this compiler consumed this configuration or selected CLR.
    $configurationPath=$invocation.compilerPathOriginal+'.config'
    $selection=@(@('compiler',$invocation.compilerPathOriginal),@('source',$invocation.sourcePathOriginal),@('default-response',$responsePath),
      @('application-config-candidate',$configurationPath))
    if($invocation.compilationKindOriginal -ceq 'qualification-library') {
      $repository=$c.repositoryRoot
      if($invocation.sourcePathOriginal -cne (Join-Path $repository 'scripts/native/core1681-acquisition.cs')){throw 'Fixed qualification library first source differs.'}
      foreach($relative in @('scripts/native/core1681-msi.cs','scripts/native/core1681-trust.cs',
        'scripts/native/core1681-opc.cs','scripts/native/core1681-vsix-bytes.cs',
        'scripts/native/core1681-qualification-dispatcher.cs')) {
        $selection+=,@('qualification-library-source',(Join-Path $repository $relative))
      }
    }
    $owner.rows=[object[]]::new($selection.Length)
    for($index=0;$index -lt $selection.Length;$index++) {
      $owner.rows[$index]=@{ordinalOriginal=$index;roleOriginal=$selection[$index][0];pathOriginal=$selection[$index][1];
        attempted=$false;returned=$false;subjectOriginal=$null;exactCandidatesOriginal=$null;caseCandidatesOriginal=$null;
        payloadOriginal=$null;bodyRoleOriginal=$null;bodyAttempted=$false;bodyReturned=$false;
        bodyBorrowed=$false;bodyFailed=$false;bodyExceptionOriginal=$null;failed=$false;exception=$null}
    }
    # Resolve the entire roster before any new body acquisition, retaining later
    # pending rows when an earlier original locator cannot be resolved.
    foreach($row in $owner.rows) {
      $owner.pendingOriginal=$row;$row.attempted=$true
      try {
        $row.exactCandidatesOriginal=[Collections.Generic.List[object]]::new()
        $row.caseCandidatesOriginal=[Collections.Generic.List[object]]::new()
        foreach($subject in $c.subjects) {
          if($subject.role -cne 'input-member'){continue}
          if($subject.path -ceq $row.pathOriginal){$row.exactCandidatesOriginal.Add($subject)}
          elseif($subject.path -ieq $row.pathOriginal){$row.caseCandidatesOriginal.Add($subject)}
        }
        if($row.exactCandidatesOriginal.Count -ne 1 -or $row.caseCandidatesOriginal.Count -ne 0){throw 'Managed compiler input locator is absent, ambiguous or has unresolved case correspondence.'}
        $row.subjectOriginal=$row.exactCandidatesOriginal[0];$row.returned=$true
      } catch {$row.exception=$_;$row.failed=$true;throw}
    }
    $owner.resolutionReturned=$true
    [decimal]$phaseCount=[decimal]$c.managedPhaseCount+$owner.rows.Length
    [decimal]$copyCount=[decimal]$c.payloadCopies.Count+$owner.rows.Length
    if($phaseCount -gt [int]::MaxValue -or $copyCount -gt [int]::MaxValue){throw 'Managed compiler body phase/copy geometry cannot be represented.'}
    $c.managedPhases.Capacity=[int]$phaseCount;$c.managedPhaseCount=[int]$phaseCount
    $c.payloadCopies.Capacity=[int]$copyCount
    foreach($row in $owner.rows) {
      $owner.pendingOriginal=$row
      $row.bodyAttempted=$true
      try {
      # Existing body custody is borrowed by SAME subject identity, never by
      # matching hash/name or by reopening a reported compiler pathname.
      foreach($copy in $c.payloadCopies) {
        if([object]::ReferenceEquals($copy.sourceSubjectOriginal,$row.subjectOriginal) -and $copy.returned){$row.payloadOriginal=$copy;$row.bodyBorrowed=$true;break}
      }
      if($null -eq $row.payloadOriginal){
        $row.bodyRoleOriginal='managed-compiler:'+$row.ordinalOriginal+':'+$row.roleOriginal
        $row.payloadOriginal=Read-CoreNativeHeldSourceBody $p $row.subjectOriginal $row.bodyRoleOriginal
      }
      $row.bodyReturned=$true
      } catch {
        $row.bodyExceptionOriginal=$_;$row.bodyFailed=$true
        if($null -ne $row.bodyRoleOriginal -and $c.payloadCopyByRole.ContainsKey($row.bodyRoleOriginal)) {
          $pendingCopy=$c.payloadCopyByRole[$row.bodyRoleOriginal]
          if([object]::ReferenceEquals($pendingCopy.sourceSubjectOriginal,$row.subjectOriginal)){$row.payloadOriginal=$pendingCopy}
        }
        throw
      }
    }
    $owner.returned=$true
    return $owner
  } catch {$owner.exception=$_;$owner.failed=$true;throw}
}

function Read-CoreManagedCompilerResponseOccurrences {
  param($HostOwnerOriginal,$InvocationOriginal)
  $p=$HostOwnerOriginal;$invocation=$InvocationOriginal;$inputs=$invocation.inputAcquisitionOriginal
  if(-not [object]::ReferenceEquals($p.managedCompilerOriginal,$invocation) -or
    -not $inputs.returned -or $null -ne $invocation.responseOccurrencesOriginal){throw 'SAME once-only acquired managed response owner required.'}
  $owner=@{inputOriginal=$inputs;payloadOriginal=$inputs.rows[2].payloadOriginal;rawOriginal=$null;linesOriginal=$null;
    referencesOriginal=$null;explicitReferencesOriginal=$null;
    pendingOriginal=$null;standardLibraryOriginal=$null;returned=$false;failed=$false;exception=$null;
    selectedCompilerReadOriginal=$null;referenceResolutionOriginal=$null;nativeAuthority='UNKNOWN'}
  $invocation.responseOccurrencesOriginal=$owner
  try {
    $owner.referencesOriginal=[Collections.Generic.List[object]]::new()
    $owner.explicitReferencesOriginal=[Collections.Generic.List[object]]::new()
    $owner.rawOriginal=$owner.payloadOriginal.exactBytesOriginal
    $raw=$owner.rawOriginal
    # This selected source subprofile is explicitly ASCII. No guessed decoder
    # can erase a non-ASCII input or convert it into a selected compiler read.
    [long]$lineCount=1
    for($index=0;$index -lt $raw.Length;$index++) {
      if($raw[$index] -eq 10){$lineCount++}
    }
    if($lineCount -gt [int]::MaxValue){throw 'Managed response line geometry cannot be represented.'}
    $owner.linesOriginal=[object[]]::new([int]$lineCount)
    for($index=0;$index -lt $owner.linesOriginal.Length;$index++) {
      $owner.linesOriginal[$index]=@{ordinalOriginal=$index;offsetOriginal=0;lengthOriginal=0;textOriginal=$null;
        attempted=$false;returned=$false;referenceOriginal=$null;matchOriginal=$null;trimmedOriginal=$null;failed=$false;exception=$null}
    }
    $lineIndex=0;$start=0
    for($index=0;$index -le $raw.Length;$index++) {
      if($index -lt $raw.Length -and $raw[$index] -ne 10){continue}
      $line=$owner.linesOriginal[$lineIndex];$owner.pendingOriginal=$line
      $line.offsetOriginal=$start;$line.lengthOriginal=$index-$start;$line.attempted=$true
      try {
        for($byte=$start;$byte -lt $index;$byte++){if($raw[$byte] -gt 127){throw 'Managed response encoding requires its genuine compiler-selected decoder.'}}
        $line.textOriginal=[Text.Encoding]::ASCII.GetString($raw,$start,$index-$start)
        $line.trimmedOriginal=$line.textOriginal.Trim([char[]]@(' ',"`t","`r"));$text=$line.trimmedOriginal
        if($text.Length -ne 0 -and -not $text.StartsWith('#')) {
          $line.matchOriginal=[Text.RegularExpressions.Regex]::Match($text,'^/r:([A-Za-z0-9_.-]+)$',[Text.RegularExpressions.RegexOptions]::CultureInvariant);$match=$line.matchOriginal
          if(-not $match.Success){throw 'Managed response option/source/quote grammar requires its complete original implementation.'}
          $reference=@{lineOriginal=$line;spellingOriginal=$match.Groups[1].Value;optionOriginal=$text;
            resolverOriginal=$null;memberOriginal=$null;providerOriginal=$null;nativeAuthority='UNKNOWN'}
          $line.referenceOriginal=$reference;$owner.referencesOriginal.Add($reference)
        }
        $line.returned=$true
      } catch {$line.exception=$_;$line.failed=$true;throw}
      $lineIndex++;$start=$index+1
    }
    # These are the actual later command option occurrences, not a union that
    # loses duplicate/default response references or their original order.
    for($index=0;$index -lt $invocation.compilerOptionsOriginal.Length;$index++) {
      $option=$invocation.compilerOptionsOriginal[$index]
      if($option.StartsWith('/reference:',[StringComparison]::Ordinal)) {
        $reference=@{optionOrdinalOriginal=$index;optionOriginal=$option;spellingOriginal=$option.Substring(11);
          resolverOriginal=$null;memberOriginal=$null;providerOriginal=$null;nativeAuthority='UNKNOWN'}
        $owner.pendingOriginal=$reference;$owner.explicitReferencesOriginal.Add($reference)
      }
      if($option.StartsWith('/noconfig',[StringComparison]::OrdinalIgnoreCase) -or
        $option.StartsWith('/nostdlib',[StringComparison]::OrdinalIgnoreCase)){throw 'Changed managed compiler defaults require their original dependency derivation.'}
    }
    $owner.standardLibraryOriginal=@{kind='implicit-framework-standard-library';spellingOriginal='mscorlib.dll';
      compilerOptionsOriginal=$invocation.compilerOptionsOriginal;responseOriginal=$owner;
      resolverOriginal=$null;memberOriginal=$null;runtimeProviderOriginal=$null;nativeAuthority='UNKNOWN'}
    $owner.returned=$true
    return $owner
  } catch {$owner.exception=$_;$owner.failed=$true;throw}
}

function Read-CoreManagedCompilerFirstSearch {
  param($HostOwnerOriginal,$AbiOriginal,$InvocationOriginal)
  $p=$HostOwnerOriginal;$c=$p.inputRead.capture;$invocation=$InvocationOriginal;$response=$invocation.responseOccurrencesOriginal
  if(-not [object]::ReferenceEquals($p.managedCompilerOriginal,$invocation) -or -not $response.returned -or
    $null -ne $invocation.firstSearchOriginal -or $c.disposalVisited){throw 'SAME once-only managed reference occurrence owner required.'}
  $owner=@{invocationOriginal=$invocation;responseOriginal=$response;workingDirectoryOriginal=$invocation.workingDirectoryOriginal;
    rowsOriginal=$null;pendingOriginal=$null;rosterReturned=$false;observationsReturned=$false;returned=$false;failed=$false;exception=$null;
    actualCompilerResolverOriginal=$null;runtimeProviderOriginal=$null;nativeAuthority='UNKNOWN'}
  $invocation.firstSearchOriginal=$owner
  try {
    if(-not (Test-CoreFullyQualifiedWindowsPath $owner.workingDirectoryOriginal)){throw 'Actual absolute managed compiler working directory required.'}
    [decimal]$count=[decimal]$response.referencesOriginal.Count+$response.explicitReferencesOriginal.Count
    [decimal]$phases=[decimal]$c.managedPhaseCount+4*$count
    if($count -gt [int]::MaxValue -or $phases -gt [int]::MaxValue -or
      [decimal]$c.payloadCopies.Count+$count -gt [int]::MaxValue){throw 'Managed reference first-search geometry cannot be represented.'}
    $owner.rowsOriginal=[object[]]::new([int]$count)
    for($index=0;$index -lt $owner.rowsOriginal.Length;$index++) {
      $reference=if($index -lt $response.referencesOriginal.Count){$response.referencesOriginal[$index]}else{$response.explicitReferencesOriginal[$index-$response.referencesOriginal.Count]}
      $owner.rowsOriginal[$index]=@{ordinalOriginal=$index;referenceOriginal=$reference;pathOriginal=$null;holdOriginal=$null;
        pathOwnerOriginal=$null;constructionAttempted=$false;constructionReturned=$false;constructionFailed=$false;constructionException=$null;
        attempted=$false;returned=$false;statusOriginal=$null;subjectOriginal=$null;payloadOriginal=$null;
        bodyRoleOriginal=$null;bodyAttempted=$false;bodyReturned=$false;bodyBorrowed=$false;bodyFailed=$false;bodyExceptionOriginal=$null;
        failed=$false;exception=$null;compilerReadOriginal=$null;namespaceAbsenceOriginal=$null;nativeAuthority='UNKNOWN'}
    }
    $c.managedPhases.Capacity=[int]$phases;$c.managedPhaseCount=[int]$phases
    $c.payloadCopies.Capacity=$c.payloadCopies.Count+[int]$count
    foreach($row in $owner.rowsOriginal) {
      $owner.pendingOriginal=$row
      $row.constructionAttempted=$true
      try {
      if($row.referenceOriginal.spellingOriginal -cnotmatch '^[A-Za-z0-9_.-]+$'){throw 'Managed reference path/alias syntax requires its complete selected resolver.'}
      $pathOwner=@{sourceOriginal=$row;workingDirectoryOriginal=$owner.workingDirectoryOriginal;
        spellingOriginal=$row.referenceOriginal.spellingOriginal;originalPath=$null;
        constructionAttempted=$false;constructionReturned=$false;namespaceOriginal=$null;
        namespaceJoinAttempted=$false;joinReturned=$false;nativeAuthority='UNKNOWN'}
      $row.pathOwnerOriginal=$pathOwner;$pathOwner.constructionAttempted=$true
      $row.pathOriginal=Join-Path $owner.workingDirectoryOriginal $row.referenceOriginal.spellingOriginal
      $pathOwner.originalPath=$row.pathOriginal;$pathOwner.constructionReturned=$true
      $hold=@{captureOriginal=$c;pathOwnerOriginal=$pathOwner;sourceOriginal=$row;path=$row.pathOriginal;role='leaf';directoryExpected=$false;
        openOriginal=$null;metadataOriginal=$null;disposalOriginal=$null;pointerCellsOriginal=$null;
        pendingEffectOriginal=$null;
        disposalEligible=$false;disposalAttempted=$false;disposalReturned=$false;metadataReturned=$false;identityJoined=$false;
        reservationOriginal=$p.inputRead.value.budget.heldMetadataReservationBytes;nativeAuthority='UNKNOWN'}
      $row.holdOriginal=$hold;$c.nativeSubjectHolds.Add($hold)
      foreach($phase in @('native-subject-open','native-subject-metadata','native-subject-dispose')) {
        $name=switch($phase){'native-subject-open'{'CreateFileW'}'native-subject-metadata'{'GetFileInformationByHandleEx'}'native-subject-dispose'{'CloseHandle'}}
        $effect=@{captureOriginal=$c;holdOriginal=$hold;abiOriginal=$AbiOriginal;nativeTypeOriginal=$p.inputRecipes[$phase].nativeTypeOriginal;
          delegateOriginal=$AbiOriginal.delegates[$name];phaseWorkerOriginal=$null;buffersOriginal=$null;effectReturned=$false;
          rosterAllocationAttempted=$false;rosterAllocationReturned=$false;firstAllocationAttempted=$false;firstAllocationReturned=$false;
          secondAllocationAttempted=$false;secondAllocationReturned=$false}
        $hold.pendingEffectOriginal=$effect
        switch($phase){'native-subject-open'{$hold.openOriginal=$effect}'native-subject-metadata'{$hold.metadataOriginal=$effect}'native-subject-dispose'{$hold.disposalOriginal=$effect}}
        $c.nativeSubjectEffects.Add($effect)
      }
      $query=$hold.metadataOriginal
      $query.rosterAllocationAttempted=$true;$query.buffersOriginal=[object[]]::new(2);$query.rosterAllocationReturned=$true
      $query.firstAllocationAttempted=$true;$query.buffersOriginal[0]=[byte[]]::new(8);$query.firstAllocationReturned=$true
      $query.secondAllocationAttempted=$true;$query.buffersOriginal[1]=[byte[]]::new(24);$query.secondAllocationReturned=$true
      $row.constructionReturned=$true
      } catch {$row.constructionException=$_;$row.constructionFailed=$true;throw}
    }
    $owner.rosterReturned=$true
    foreach($row in $owner.rowsOriginal) {
      $owner.pendingOriginal=$row;$row.attempted=$true;$hold=$row.holdOriginal
      try {
        $null=Invoke-CoreInputPhase $p 'native-subject-open' $hold.openOriginal
        $open=$hold.openOriginal;$pointer=$hold.pointerCellsOriginal[1]
        if($pointer -eq [IntPtr]::new(-1)) {
          if(-not $open.nativeReturned -or -not $open.errorReturned -or $open.nativeErrorOriginal -notin @(2,3)){throw 'Managed first-search native open failed; exact original error is retained.'}
          $row.statusOriginal='NATIVE_NOT_FOUND_OBSERVATION';$row.returned=$true;continue
        }
        if($pointer -eq [IntPtr]::Zero){throw 'Managed first-search native open returned an invalid zero handle.'}
        $null=Invoke-CoreInputPhase $p 'native-subject-metadata' $hold.metadataOriginal
        $query=$hold.metadataOriginal
        if($query.resultCellsOriginal[20] -eq 0 -or $query.resultCellsOriginal[21] -eq 0){throw 'Managed first-search held metadata failed; original outputs retained.'}
        $hold.metadataReturned=$true
        if(([BitConverter]::ToUInt32($query.buffersOriginal[0],0) -band 0x410) -ne 0){throw 'Managed first-search reference is redirected or nonregular.'}
        $row.exactSubjectsOriginal=[Collections.Generic.List[object]]::new()
        foreach($subject in $c.subjects){if($subject.role -ceq 'input-member' -and $subject.path -ceq $row.pathOriginal){$row.exactSubjectsOriginal.Add($subject)}}
        if($row.exactSubjectsOriginal.Count -ne 1){$row.statusOriginal='EXISTING_UNRESOLVED_MEMBER';$row.returned=$true;continue}
        $row.subjectOriginal=$row.exactSubjectsOriginal[0];$row.metadataOriginal=$null
        foreach($candidate in $c.heldMetadataQueries){if([object]::ReferenceEquals($candidate.sourceSubjectOriginal,$row.subjectOriginal)){$row.metadataOriginal=$candidate;break}}
        if($null -eq $row.metadataOriginal -or -not $row.metadataOriginal.metadataReturned){throw 'SAME enrolled managed-held reference metadata is absent.'}
        for($byte=0;$byte -lt 24;$byte++){if($row.metadataOriginal.buffersOriginal[1][$byte] -ne $query.buffersOriginal[1][$byte]){throw 'Managed first-search opened member differs from the actual enrolled held FileId.'}}
        # Join this separately opened leaf to the complete namespace already
        # held for the SAME enrolled source. Equal path/FileId alone does not
        # establish the ancestor roster or its continued ownership.
        $row.pathOwnerOriginal.namespaceJoinAttempted=$true
        foreach($namespace in $c.nativePathOwners) {
          if([object]::ReferenceEquals($namespace.sourceOriginal,$row.subjectOriginal)) {
            if($null -ne $row.pathOwnerOriginal.namespaceOriginal){throw 'Managed first-search source has ambiguous original namespace custody.'}
            $row.pathOwnerOriginal.namespaceOriginal=$namespace
          }
        }
        $namespace=$row.pathOwnerOriginal.namespaceOriginal
        if($null -eq $namespace -or -not $namespace.rosterReturned -or -not $namespace.joinReturned -or
          $namespace.originalPath -cne $row.pathOriginal -or $namespace.holds.Count -eq 0){throw 'Managed first-search requires complete SAME source namespace custody.'}
        foreach($component in $namespace.holds) {
          if(-not [object]::ReferenceEquals($component.pathOwnerOriginal,$namespace) -or
            -not [object]::ReferenceEquals($component.sourceOriginal,$row.subjectOriginal) -or
            -not $component.identityJoined -or -not $component.metadataReturned -or $component.disposalAttempted -or
            $null -ne $component.disposalOriginal.phaseWorkerOriginal){throw 'Managed first-search source namespace component is incomplete or released.'}
        }
        $hold.identityJoined=$true
        $row.pathOwnerOriginal.joinReturned=$true
        $row.statusOriginal='SAME_HELD_MEMBER_OBSERVATION';$row.returned=$true
      } catch {$row.exception=$_;$row.failed=$true;throw}
    }
    $owner.observationsReturned=$true
    foreach($row in $owner.rowsOriginal) {
      if($row.statusOriginal -cne 'SAME_HELD_MEMBER_OBSERVATION'){continue}
      $owner.pendingOriginal=$row
      $row.bodyAttempted=$true
      try {
        foreach($copy in $c.payloadCopies){if([object]::ReferenceEquals($copy.sourceSubjectOriginal,$row.subjectOriginal) -and $copy.returned){$row.payloadOriginal=$copy;$row.bodyBorrowed=$true;break}}
        if($null -eq $row.payloadOriginal){
          $row.bodyRoleOriginal='managed-reference-cwd:'+$row.ordinalOriginal
          $row.payloadOriginal=Read-CoreNativeHeldSourceBody $p $row.subjectOriginal $row.bodyRoleOriginal
        }
        $row.bodyReturned=$true
      } catch {
        $row.bodyExceptionOriginal=$_;$row.bodyFailed=$true
        if($null -ne $row.bodyRoleOriginal -and $c.payloadCopyByRole.ContainsKey($row.bodyRoleOriginal)) {
          $pendingCopy=$c.payloadCopyByRole[$row.bodyRoleOriginal]
          if([object]::ReferenceEquals($pendingCopy.sourceSubjectOriginal,$row.subjectOriginal)){$row.payloadOriginal=$pendingCopy}
        }
        throw
      }
    }
    $owner.returned=$true
    return $owner
  } catch {$owner.exception=$_;$owner.failed=$true;throw}
}

function Get-CoreNativeInitializedEnvironmentDigest {
  param($HostOwnerOriginal)
  $p=$HostOwnerOriginal;$c=$p.inputRead.capture
  if($c.Contains('initializedEnvironmentHashOriginal') -or $null -eq $p.initializedEnvironmentOriginal -or
    -not $p.initializedEnvironmentOriginal.copyReturned -or $null -eq $c.subjects[0].hashOriginal -or
    -not $c.subjects[0].readWorkerOriginal.terminalJoined){throw 'SAME once-only initializer copy and terminal root hash required.'}
  $effect=@{captureOriginal=$c;sourceSubjectOriginal=$c.subjects[0];hashOriginal=$c.subjects[0].hashOriginal;
    bytes=$p.initializedEnvironmentOriginal.bytesOriginal;digestOriginal=$null}
  $c.initializedEnvironmentHashOriginal=$effect
  $null=Invoke-CoreInputPhase $p 'buffer-hash' $effect
  if(-not $effect.digestCallReturned -or $p.deadlineReported){throw 'Initializer digest did not complete before original deadline.'}
  return $effect
}

function Initialize-CoreNativeHeldToolPreparation {
  param($HostOwnerOriginal,$Preparation,[ValidateSet('initialize','compile','compile-managed','compile-library')][string]$Role)
  $p=$HostOwnerOriginal;$c=$p.inputRead.capture;$consumer=$Preparation.consumerOriginal
  if(-not [object]::ReferenceEquals($Preparation.receiver,$p.receiver) -or
    -not $p.receiver.frames.ContainsKey($Preparation.key) -or -not [object]::ReferenceEquals($p.receiver.frames[$Preparation.key],$Preparation) -or
    $Preparation.nativeIssued -or $null -ne $Preparation.preparationOriginal -or $consumer.slot -cne 'core.native-producer-tool.v1'){throw 'SAME once-only fixed tool preparation required.'}
  $prepared=@{hostOwnerOriginal=$p;role=$Role;commandOriginal=$consumer;pendingSubjectOriginal=$consumer.pendingSubject;
    subjectHoldsOriginal=$consumer.subjectHolds;nativeSubjectHoldsOriginal=$consumer.nativeSubjectHolds;toolSubjectOriginal=$null;returned=$false;original=$null;nativeAssociationOriginal=$c.nativeAssociationOriginals}
  $Preparation.preparationOriginal=$prepared
  try {
    Observe-OwnedPrerequisiteDeadline $Preparation
    if($Preparation.deadlineReported -or $c.disposalVisited -or -not $c.structuralReturned -or $consumer.subjectHolds.Length -ne $c.memberCount){throw 'Complete live original input roster/deadline required.'}
    if($consumer.nativeSubjectHolds -isnot [object[]] -or $consumer.nativeSubjectHolds.Length -ne $c.nativeSubjectHolds.Count){throw 'Actual complete native-held subject snapshot required.'}
    for($index=0;$index -lt $c.nativeSubjectHolds.Count;$index++) {
      $hold=$c.nativeSubjectHolds[$index]
      if(-not [object]::ReferenceEquals($consumer.nativeSubjectHolds[$index],$hold) -or -not $hold.identityJoined -or
        -not $hold.metadataReturned -or $hold.disposalAttempted -or $null -ne $hold.disposalOriginal.phaseWorkerOriginal -or -not $hold.pathOwnerOriginal.joinReturned){throw 'Actual completed original namespace joins required before tool association.'}
    }
    $expected=if($Role -ceq 'initialize'){$p.inputRead.value.cmdPath}else{$p.inputRead.value.compilerPath}
    $expectedCwd=if($Role -cin @('compile-managed','compile-library')){$p.inputRead.value.hostWorkingDirectory}else{$p.inputRead.value.outputRoot}
    if($Role -ceq 'compile-library' -and ($p.inputRead.value.schema -cne 'service-lasso.qualification-library-input.v1' -or
      -not [object]::ReferenceEquals($p.managedCompilerOriginal.commandOriginal,$consumer))){throw 'SAME selected qualification library command required.'}
    if($Role -ceq 'compile-managed' -and ($p.inputRead.value.schema -cne 'service-lasso.managed-producer-input.v2' -or
      -not [object]::ReferenceEquals($p.managedCompilerOriginal.commandOriginal,$consumer))){throw 'SAME selected managed compiler command required.'}
    if($consumer.file -cne $expected -or $consumer.cwd -cne $expectedCwd -or
      $consumer.outputPrefix -cne (Join-Path $p.inputRead.value.outputRoot $Role)){throw 'Fixed tool command identity differs.'}
    for($index=0;$index -lt $c.memberCount;$index++) {
      Observe-OwnedPrerequisiteDeadline $Preparation
      if($Preparation.deadlineReported){throw 'Original deadline expired during fixed tool association.'}
      $subject=$c.subjects[$index+1]
      $consumer.pendingSubject.currentOriginal=$subject
      if($subject.role -cne 'input-member' -or $null -eq $subject.stream -or $null -eq $subject.hashOriginal -or
        -not $subject.readWorkerOriginal.terminalJoined -or $subject.stream.SafeFileHandle.IsClosed -or
        -not $subject.digestCallReturned -or -not $subject.eofProbeReturned -or $subject.eofProbeOriginal -ne -1){throw 'Actual terminal held member original required.'}
      $consumer.subjectHolds[$index]=$subject
      if($subject.path -ieq $expected){$prepared.toolSubjectOriginal=$subject}
    }
    if($null -eq $prepared.toolSubjectOriginal){throw 'Fixed tool lacks its SAME held member.'}
    $consumer.pendingSubject.returned=$true;$prepared.returned=$true
  } catch {$prepared.original=$_;throw}
  return $prepared
}

function Read-CoreNativeGeneratedImage {
  param($HostOwnerOriginal,$CompilerOwnerOriginal,
    [ValidateSet('windows-managed-launcher-native.exe','windows-managed-launcher-managed.exe','windows-process-inspector.exe','windows-directory-sync-helper.exe','windows-held-exit-probe.exe','service-lasso-acquisition-verifier.dll')][string]$ImageName='windows-managed-launcher-native.exe')
  $p=$HostOwnerOriginal;$c=$p.inputRead.capture
  if(-not $c.structuralReturned -or $c.Contains('generatedCandidateOriginal') -or
    -not [object]::ReferenceEquals($CompilerOwnerOriginal.abi.originalOwner.hostOwnerOriginal,$p) -or
    -not $CompilerOwnerOriginal.rootObserved -or -not $CompilerOwnerOriginal.treeObserved -or
    -not $CompilerOwnerOriginal.released -or $CompilerOwnerOriginal.unknown -or $CompilerOwnerOriginal.exitCode -ne 0){throw 'SAME actually completed compiler owner required.'}
  if($ImageName -ceq 'service-lasso-acquisition-verifier.dll') {
    if($p.inputRead.value.schema -cne 'service-lasso.qualification-library-input.v1' -or
      -not [object]::ReferenceEquals($p.managedCompilerOriginal.toolOwnerOriginal,$CompilerOwnerOriginal)){throw 'SAME completed qualification library compiler required.'}
  } elseif($ImageName -cne 'windows-managed-launcher-native.exe') {
    $names=@{'process-inspector'='windows-process-inspector.exe';'managed-launcher'='windows-managed-launcher-managed.exe';
      'directory-sync'='windows-directory-sync-helper.exe';'held-exit'='windows-held-exit-probe.exe'}
    if($p.inputRead.value.schema -cne 'service-lasso.managed-producer-input.v2' -or
      $names[$p.inputRead.value.managedCompilerFixture] -cne $ImageName -or
      -not [object]::ReferenceEquals($p.managedCompilerOriginal.toolOwnerOriginal,$CompilerOwnerOriginal)){throw 'SAME actually returned selected managed compiler image required.'}
  }
  $candidate=@{captureOriginal=$c;role='generated-candidate';path=(Join-Path $p.inputRead.value.outputRoot $ImageName);
    compilerOwnerOriginal=$CompilerOwnerOriginal;resourceOffset=(8+2*$c.memberCount);bytes=$null;stream=$null;hashOriginal=$null;
    normalizedBytesOriginal=$null;normalizationAttempted=$false;normalizationReturned=$false;declaredOriginal=$null}
  $c.generatedCandidateOriginal=$candidate;$c.subjects.Add($candidate)
  $c.resources[$candidate.resourceOffset].sourceOriginal=$candidate
  $c.resources[$candidate.resourceOffset+1].sourceOriginal=$candidate
  $null=Invoke-CoreInputPhase $p 'generated-open-length' $candidate
  $extent=$candidate.actualLength
  $candidate.reservationOriginal=$p.inputRead.value.budget.compilerImageReservationBytes
  if(-not $candidate.lengthReturned -or $extent -le 0 -or $extent -ge [int]::MaxValue -or
    7*[decimal]$extent+5 -ge $candidate.reservationOriginal){throw 'Generated image extent lacks its genuine complete reservation before payload allocation.'}
  $candidate.declaredOriginal=@{byteLength=$extent}
  $copy=@{captureOriginal=$c;role='generated-candidate-copy';sourceSubjectOriginal=$candidate;streamOriginal=$candidate.stream;stream=$candidate.stream;
    hashOriginal=$candidate.hashOriginal;bytes=$null;exactBytesOriginal=$null;readCountsOriginal=$null;digestOriginal=$null}
  $candidate.copyOriginal=$copy;$c.payloadCopies.Add($copy)
  $copy.rawAllocationAttempted=$true;$copy.bytes=[byte[]]::new([int]($extent+1));$copy.rawAllocationReturned=$true
  $copy.exactAllocationAttempted=$true;$copy.exactBytesOriginal=[byte[]]::new([int]$extent);$copy.exactAllocationReturned=$true
  $copy.transcriptAllocationAttempted=$true;$copy.readCountsOriginal=[int[]]::new([int]($extent+1));$copy.transcriptAllocationReturned=$true
  $null=Invoke-CoreInputPhase $p 'held-payload-copy' $copy
  if(-not $copy.eof -or $copy.used -ne $extent -or $copy.actualLength -ne $extent -or
    -not $copy.seekReturned -or $copy.seekPositionOriginal -ne 0 -or -not $copy.endPositionReturned -or
    $copy.endPositionOriginal -ne $extent -or -not $copy.exactCopyReturned -or
    $copy.readCallAttemptedCount -ne $copy.readCallReturnedCount -or $copy.readCallReturnedCount -le 0){throw 'Generated image held copy is incomplete.'}
  $sum=0L
  for($index=0;$index -lt $copy.readCallReturnedCount;$index++) {
    Observe-OwnedPrerequisiteDeadline $p
    $count=$copy.readCountsOriginal[$index]
    if(($index -eq $copy.readCallReturnedCount-1 -and $count -ne 0) -or ($index -lt $copy.readCallReturnedCount-1 -and $count -le 0)){throw 'Generated image read transcript lacks actual EOF.'}
    $sum+=$count
  }
  if($sum -ne $extent -or $p.deadlineReported){throw 'Generated image extent/deadline differs.'}
  $candidate.rawDigestOriginal=$copy.digestOriginal
  $candidate.normalizedAllocationAttempted=$true
  $candidate.normalizedBytesOriginal=[byte[]]::new([int]$extent)
  $candidate.normalizedAllocationReturned=$true
  [Array]::Copy($copy.exactBytesOriginal,$candidate.normalizedBytesOriginal,[int]$extent)
  return $candidate
}

function Get-CoreNativeGeneratedNormalizedDigest {
  param($HostOwnerOriginal,$CandidateOriginal)
  $p=$HostOwnerOriginal;$c=$p.inputRead.capture
  if(-not [object]::ReferenceEquals($CandidateOriginal,$c.generatedCandidateOriginal) -or -not $CandidateOriginal.normalizationReturned -or
    $c.Contains('generatedNormalizedHashOriginal')){throw 'SAME once-only normalized image required.'}
  $effect=@{captureOriginal=$c;sourceSubjectOriginal=$CandidateOriginal;hashOriginal=$CandidateOriginal.hashOriginal;bytes=$CandidateOriginal.normalizedBytesOriginal;digestOriginal=$null}
  $c.generatedNormalizedHashOriginal=$effect
  $null=Invoke-CoreInputPhase $p 'buffer-hash' $effect
  if(-not $effect.digestCallReturned -or $p.deadlineReported){throw 'Normalized digest did not return before original deadline.'}
  return $effect
}

function Invoke-CoreNativeInputDisposal {
  param($HostOwnerOriginal)
  $p=$HostOwnerOriginal;$c=$p.inputRead.capture
  if($null -eq $c){return}
  if($c.disposalVisited){return}
  $c.disposalVisited=$true
  # Native handle cleanup owns its separate source-derived roster; it never
  # borrows the process owner's eleven emergency roles or managed resources.
  foreach($hold in $c.nativeSubjectHolds) {
    if($null -eq $hold.openOriginal -or $null -eq $hold.disposalOriginal){continue}
    $open=$hold.openOriginal.phaseWorkerOriginal
    if($null -eq $open -or -not $open.terminalJoined -or $open.results[6] -ne 1 -or $hold.disposalAttempted){continue}
    if($null -eq $hold.pointerCellsOriginal -or $hold.pointerCellsOriginal[1] -eq [IntPtr]::Zero -or $hold.pointerCellsOriginal[1] -eq [IntPtr]::new(-1)){continue}
    $borrower=$null;$query=if($null -ne $hold.metadataOriginal){$hold.metadataOriginal.phaseWorkerOriginal}else{$null}
    if($null -ne $query -and ($query.startAttempted -and (-not $query.terminalJoined -or
      ($query.results[8] -eq 1 -and $query.results[9] -ne 1) -or ($query.results[12] -eq 1 -and $query.results[13] -ne 1)))){$borrower=$query}
    foreach($preparation in $p.receiver.frames.Values) {
      if($null -eq $preparation.consumerOriginal -or $preparation.consumerOriginal.slot -cne 'core.native-producer-tool.v1' -or
        -not $preparation.nativeIssued -or ($null -ne $preparation.nativeState -and $preparation.nativeState.released)){continue}
      foreach($held in $preparation.consumerOriginal.nativeSubjectHolds){if([object]::ReferenceEquals($held,$hold)){$borrower=$preparation;break}}
      if($null -ne $borrower){break}
    }
    if($null -ne $borrower){$hold.deferredBorrowerOriginal=$borrower;continue}
    $hold.disposalEligible=$true
    try{$worker=New-CoreNativeInputPhase $p 'native-subject-dispose' $hold.disposalOriginal;$null=Start-CoreNativeInputPhase $worker}
    catch{$hold.disposalOriginal.constructionOriginal=$_}
  }
  # Visit each independently eligible resource before joining any disposer.
  foreach($resource in $c.resources) {
    if($resource.disposalAttempted){continue}
    if($null -eq $resource.objectOriginal){continue}
    if($resource.kind -ceq 'managed-json-backing'){
      $resource.retainedBackingOriginal=$resource.objectOriginal
      $resource.retentionVisited=$true
      continue
    }
    $borrower=$null
    foreach($query in $c.heldMetadataQueries) {
      if(-not [object]::ReferenceEquals($query.sourceSubjectOriginal,$resource.sourceOriginal) -or $null -eq $query.phaseWorkerOriginal){continue}
      $q=$query.phaseWorkerOriginal
      if(($q.borrow[0] -and $q.results[19] -ne 1) -or ($q.results[1] -eq 1 -and $q.results[2] -ne 1) -or
        ($q.results[8] -eq 1 -and $q.results[9] -ne 1) -or ($q.results[12] -eq 1 -and $q.results[13] -ne 1)){$borrower=$q;break}
    }
    foreach($phase in $c.managedPhases) {
      if($phase.phase -ceq 'resource-dispose' -or -not $phase.startAttempted -or $phase.terminalJoined){continue}
      $effect=$phase.effectOriginal
      if([object]::ReferenceEquals($effect,$resource.sourceOriginal) -or
        ($phase.phase -cin @('held-payload-copy','buffer-hash','held-metadata') -and [object]::ReferenceEquals($effect.sourceSubjectOriginal,$resource.sourceOriginal))){$borrower=$phase;break}
    }
    if($null -eq $borrower) {
      foreach($preparation in $p.receiver.frames.Values) {
        if(-not $preparation.nativeIssued -or
          ($null -ne $preparation.nativeState -and $preparation.nativeState.released) -or
          $null -eq $preparation.consumerOriginal -or $preparation.consumerOriginal.slot -cne 'core.native-producer-tool.v1'){continue}
        foreach($heldSubject in $preparation.consumerOriginal.subjectHolds) {
          if([object]::ReferenceEquals($heldSubject,$resource.sourceOriginal)){$borrower=$preparation;break}
        }
        if($null -ne $borrower){break}
      }
    }
    if($null -ne $borrower){$resource.deferredBorrowerOriginal=$borrower;continue}
    try {
      $worker=New-CoreNativeInputPhase $p 'resource-dispose' $resource
      $null=Start-CoreNativeInputPhase $worker
    } catch {$resource.disposalOriginal=$_}
  }
  $pending=$true
  while($pending) {
    $pending=$false
    foreach($hold in $c.nativeSubjectHolds) {
      if($null -eq $hold.disposalOriginal){continue}
      $worker=$hold.disposalOriginal.phaseWorkerOriginal
      if($null -eq $worker -or -not $worker.startReturned -or $worker.completionAttempted){continue}
      try {
        if(-not $worker.terminalJoined){$null=Observe-CoreNativeInputPhase $worker}
        if($worker.terminalJoined){$null=Complete-CoreNativeInputPhase $worker}else{$pending=$true}
      }catch{$hold.disposalOriginal.completionOriginal=$_}
    }
    foreach($resource in $c.resources) {
      $worker=$resource.phaseWorkerOriginal
      if($null -eq $worker -or -not $worker.startReturned -or $worker.completionAttempted){continue}
      try {
        if(-not $worker.terminalJoined){$null=Observe-CoreNativeInputPhase $worker}
        if($worker.terminalJoined){$null=Complete-CoreNativeInputPhase $worker}else{$pending=$true}
      } catch {$resource.disposalOriginal=$_}
    }
    if($pending){$null=[Threading.Thread]::Yield()}
  }
}

function Test-CoreNativeInputClosure {
  param($HostOwnerOriginal)
  $c=$HostOwnerOriginal.inputRead.capture
  if($null -eq $c){return (-not $HostOwnerOriginal.inputRead.attempted)}
  if(-not $c.disposalVisited){return $false}
  if($c.nativePathSources.Count -gt 0) {
    if(-not $c.Contains('nativePathOwners') -or $c.nativePathOwners.Count -ne $c.nativePathSources.Count){return $false}
    foreach($pathOwner in $c.nativePathOwners){if(-not $pathOwner.rosterReturned){return $false}}
  }
  foreach($effect in $c.nativeSubjectEffects) {
    foreach($prefix in @('roster','first','second')){if($effect[$prefix+'AllocationAttempted'] -and -not $effect[$prefix+'AllocationReturned']){return $false}}
  }
  foreach($hold in $c.nativeSubjectHolds) {
    if($null -eq $hold.openOriginal -or $null -eq $hold.metadataOriginal -or $null -eq $hold.disposalOriginal){return $false}
    $open=$hold.openOriginal.phaseWorkerOriginal
    if($null -eq $open){continue}
    if($open.startAttempted -and (-not $open.terminalJoined -or ($open.results[5] -eq 1 -and $open.results[6] -ne 1))){return $false}
    if($null -ne $hold.pointerCellsOriginal -and $open.results[6] -eq 1 -and $hold.pointerCellsOriginal[1] -ne [IntPtr]::Zero -and $hold.pointerCellsOriginal[1] -ne [IntPtr]::new(-1) -and -not $hold.disposalReturned){return $false}
  }
  foreach($query in $c.heldMetadataQueries) {
    foreach($prefix in @('roster','first','second')){if($query[$prefix+'AllocationAttempted'] -and -not $query[$prefix+'AllocationReturned']){return $false}}
  }
  if($c.Contains('generatedCandidateOriginal')) {
    $candidate=$c.generatedCandidateOriginal
    if($candidate.normalizedAllocationAttempted -and -not $candidate.normalizedAllocationReturned){return $false}
    if($candidate.Contains('copyOriginal')) {
      foreach($prefix in @('raw','exact','transcript')) {
        if($candidate.copyOriginal[$prefix+'AllocationAttempted'] -and -not $candidate.copyOriginal[$prefix+'AllocationReturned']){return $false}
      }
    }
  }
  foreach($worker in $c.managedPhases) {
    if($worker.pointerAllocationAttempted -and -not $worker.pointerAllocationReturned){return $false}
    if($worker.deadlineRefused -and -not $worker.startAttempted){continue}
    if(-not $worker.terminalJoined -or $worker.thread.IsAlive -or -not $worker.completionAttempted){return $false}
    if($worker.phase -cin @('subject-read-hash','member-hash','generated-open-length') -and $worker.results[1] -eq 1 -and $worker.results[2] -ne 1){return $false}
    if($worker.phase -cin @('subject-read-hash','member-hash','generated-open-length') -and $worker.results[5] -eq 1 -and $worker.results[6] -ne 1){return $false}
    if($worker.phase -ceq 'build-file-write' -and $worker.results[1] -eq 1 -and $worker.results[2] -ne 1){return $false}
    if($worker.phase -ceq 'build-directory') {
      if($worker.results[1] -eq 1 -and $worker.results[2] -ne 1){return $false}
      if($worker.results[2] -eq 1 -and $worker.results[10] -ne 1){return $false}
      if($worker.results[5] -eq 1 -and $worker.results[6] -ne 1){return $false}
    }
    if($worker.phase -ceq 'native-subject-open') {
      if($worker.results[1] -eq 1 -and $worker.results[2] -ne 1){return $false}
      if($worker.results[2] -eq 1 -and $worker.results[10] -ne 1){return $false}
      if($worker.results[5] -eq 1 -and $worker.results[6] -ne 1){return $false}
    }
    if($worker.phase -ceq 'native-subject-dispose' -and ($worker.results[5] -ne 1 -or $worker.results[6] -ne 1 -or $worker.results[12] -eq 0)){return $false}
    if($worker.phase -cin @('held-metadata','native-subject-metadata')) {
      if(($worker.pinAllocationAttempted -and -not $worker.pinAllocationReturned) -or ($worker.borrowAllocationAttempted -and -not $worker.borrowAllocationReturned)){return $false}
      foreach($pair in @(@(1,2),@(3,4),@(5,6),@(10,11),@(8,9),@(12,13))){if($worker.results[$pair[0]] -eq 1 -and $worker.results[$pair[1]] -ne 1){return $false}}
      if($worker.phase -ceq 'held-metadata' -and $worker.borrow[0] -and $worker.results[19] -ne 1){return $false}
      if($worker.results[6] -eq 1 -and $worker.results[15] -ne 1){return $false}
      if($worker.results[11] -eq 1 -and $worker.results[17] -ne 1){return $false}
      foreach($slot in 0..2){if($null -ne $worker.outputs[$slot]){return $false}}
    }
    if($worker.phase -ceq 'root-json-parse'){
      # Exact partial graph is retained even on grammar/decode refusal. Actual
      # terminal join/completion above remains mandatory before this disposition.
      if(-not [object]::ReferenceEquals($worker.effectOriginal,$c.parseOriginal) -or
        -not [object]::ReferenceEquals($c.resources[2].objectOriginal,$c.parseOriginal) -or
        -not $c.parseOriginal.backingAllocationReturned){return $false}
    }
  }
  foreach($resource in $c.resources) {
    if($null -eq $resource.objectOriginal){continue}
    if($resource.kind -ceq 'managed-json-backing'){
      if(-not $resource.retentionVisited -or $resource.lifetime -cne 'host-process' -or
        -not [object]::ReferenceEquals($resource,$c.resources[2]) -or
        -not [object]::ReferenceEquals($resource.objectOriginal,$c.parseOriginal) -or
        -not [object]::ReferenceEquals($resource.retainedBackingOriginal,$c.parseOriginal) -or
        $resource.disposalAttempted -or $null -ne $resource.phaseWorkerOriginal){return $false}
      foreach($borrower in $c.managedPhases){
        if($borrower.phase -ceq 'root-json-parse' -and $borrower.startAttempted -and
          (-not $borrower.terminalJoined -or $borrower.thread.IsAlive)){return $false}
      }
      continue
    }
    if(-not $resource.disposalAttempted -or -not $resource.disposalReturned){return $false}
    if($resource.objectOriginal -is [IO.FileStream] -and -not $resource.objectOriginal.SafeFileHandle.IsClosed){return $false}
  }
  return $true
}
