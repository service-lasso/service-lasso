[CmdletBinding()]
param([Parameter(Mandatory)]$ProducerHostContext)
$ErrorActionPreference='Stop'
$p=$ProducerHostContext.hostOwnerOriginal
$root=$ProducerHostContext.inputRootOriginal
if($null -eq $p -or -not [object]::ReferenceEquals($p.inputRead.value,$root) -or -not $p.inputRead.returned -or
  $root.schema -cne 'service-lasso.qualification-library-input.v1' -or $p.Contains('managedCompilerOriginal')){throw 'SAME once-only qualification library host input required.'}
$invocation=@{hostOwnerOriginal=$p;compilationKindOriginal='qualification-library';compilerPathOriginal=$root.compilerPath;
  sourcePathOriginal=$null;compilerOptionsOriginal=$null;inputAcquisitionOriginal=$null;responseOccurrencesOriginal=$null;
  referenceResolutionOriginal=$null;runtimeProviderOriginal=$null;commandOriginal=$null;toolOwnerOriginal=$null;
  sourcePathsOriginal=$null;argumentsOriginal=$null;preparationOriginal=$null;heldToolOriginal=$null;
  toolAttempted=$false;toolReturned=$false;failed=$false;exception=$null;generatedOriginal=$null;
  nativeVerifierConsumerOriginal=$null;nativeAuthority='UNKNOWN'}
$p.managedCompilerOriginal=$invocation
try {
  $repository=$p.inputRead.capture.repositoryRoot
  $invocation.sourcePathsOriginal=[string[]]@((Join-Path $repository 'scripts/native/core1681-acquisition.cs'),
    (Join-Path $repository 'scripts/native/core1681-msi.cs'),(Join-Path $repository 'scripts/native/core1681-trust.cs'),
    (Join-Path $repository 'scripts/native/core1681-opc.cs'),(Join-Path $repository 'scripts/native/core1681-vsix-bytes.cs'),
    (Join-Path $repository 'scripts/native/core1681-qualification-dispatcher.cs'))
  $invocation.sourcePathOriginal=$invocation.sourcePathsOriginal[0]
  $invocation.compilerOptionsOriginal=[string[]]@('/nologo','/target:library','/platform:anycpu','/optimize+')
  $null=Read-CoreManagedCompilerInputs $p $invocation
  $null=Read-CoreManagedCompilerResponseOccurrences $p $invocation
  $invocation.abiOriginal=New-NativeProducerAbi $root.kernel32Path $ProducerHostContext.receiver $p
  foreach($subject in $p.inputRead.capture.subjects){
    $null=Read-CoreNativeHeldMetadata $p $invocation.abiOriginal $subject
    $null=Read-CoreNativeSubjectNamespace $p $invocation.abiOriginal $subject
  }
  $invocation.outputDirectoryOriginal=New-CoreNativeBuildDirectory $p $invocation.abiOriginal 'output-root'
  $null=Read-CoreNativeSubjectNamespace $p $invocation.abiOriginal $invocation.outputDirectoryOriginal
  $invocation.outputPathOriginal=Join-Path $root.outputRoot 'service-lasso-acquisition-verifier.dll'
  $invocation.argumentsOriginal=[string[]](@($invocation.compilerOptionsOriginal)+@('/out:'+$invocation.outputPathOriginal)+@($invocation.sourcePathsOriginal))
  $invocation.environmentSnapshotOriginal=[Environment]::GetEnvironmentVariables()
  $invocation.environmentOriginal=[Collections.Generic.Dictionary[string,string]]::new([StringComparer]::OrdinalIgnoreCase)
  foreach($pair in $invocation.environmentSnapshotOriginal.GetEnumerator()){$invocation.environmentOriginal.Add([string]$pair.Key,[string]$pair.Value)}
  $invocation.workingDirectoryOriginal=(Get-Location).ProviderPath
  $null=Read-CoreManagedCompilerFirstSearch $p $invocation.abiOriginal $invocation
  # Every search attempt remains in the owned native roster. A returned lookup
  # or held FileId comparison cannot substitute for its complete namespace or
  # absence disposition, even if a future resolver/runtime acquisition returns.
  foreach($row in $invocation.firstSearchOriginal.rowsOriginal) {
    $invocation.firstSearchOriginal.pendingOriginal=$row
    if(-not $row.holdOriginal.metadataReturned -or -not $row.holdOriginal.identityJoined -or
      -not $row.pathOwnerOriginal.joinReturned) {
      throw 'Qualification library reference search namespace/absence/held-candidate relation remains unimplemented; complete original roster retained.'
    }
  }
  $invocation.reservationOriginal=@{inputRoot=$root.rootHash;sourceDisposition=$root.sourceReviewEvidence;
    receiverCharge=$root.budget.receiverChargeBytes;attributeListBytes=$root.budget.attributeListBytes;
    budget=$root.budget;outputLimitBytes=2097152}
  $invocation.commandOriginal=@{slot='core.native-producer-tool.v1';file=$invocation.compilerPathOriginal;
    arguments=$invocation.argumentsOriginal;nativeArguments=$null;environment=$invocation.environmentOriginal;
    cwd=$invocation.workingDirectoryOriginal;outputPrefix=(Join-Path $root.outputRoot 'compile-library');inputRoot=$root;
    pendingSubject=@{role='compile-library';path=$invocation.compilerPathOriginal;currentOriginal=$null;returned=$false};
    subjectHolds=[object[]]::new($p.inputRead.capture.memberCount);nativeSubjectHolds=$p.inputRead.capture.nativeSubjectHolds.ToArray()}
  # Source-owned originals must be supplied by their actual acquisition path;
  # neither held source/path equality nor this recipe can construct them.
  if($null -eq $invocation.referenceResolutionOriginal -or $null -eq $invocation.runtimeProviderOriginal){throw 'Qualification library compiler reference/runtime provider acquisition remains unimplemented.'}
  $invocation.preparationOriginal=New-OwnedPrerequisitePreparation $ProducerHostContext.receiver $invocation.reservationOriginal $invocation.commandOriginal -AbsoluteDeadlineTicks $p.originalDeadlineTicks -DeadlineResponse $ProducerHostContext.deadlineResponse
  $invocation.heldToolOriginal=Initialize-CoreNativeHeldToolPreparation $p $invocation.preparationOriginal 'compile-library'
  $invocation.toolAttempted=$true
  try {
    $invocation.toolOwnerOriginal=Invoke-OwnedNativeProducerTool -Abi $invocation.abiOriginal -Receiver $ProducerHostContext.receiver -File $invocation.compilerPathOriginal -Arguments $invocation.argumentsOriginal -Environment $invocation.environmentOriginal -WorkingDirectory $invocation.workingDirectoryOriginal -OutputPrefix $invocation.commandOriginal.outputPrefix -AbsoluteDeadlineTicks $p.originalDeadlineTicks -Reservation $invocation.reservationOriginal -DeadlineResponse $ProducerHostContext.deadlineResponse -Preparation $invocation.preparationOriginal
    $invocation.toolReturned=$true
  } catch {
    if($null -eq $invocation.toolOwnerOriginal){$invocation.toolOwnerOriginal=$invocation.preparationOriginal.nativeState}
    throw
  }
  $invocation.generatedOriginal=Read-CoreNativeGeneratedImage $p $invocation.toolOwnerOriginal 'service-lasso-acquisition-verifier.dll'
  throw 'Qualification library loaded provider and genuine native verifier-currentness consumer remain unimplemented; generated original retained.'
} catch {$invocation.exception=$_;$invocation.failed=$true;throw}
