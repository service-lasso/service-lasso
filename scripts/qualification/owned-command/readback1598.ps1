param(
 [Parameter(Mandatory)][ValidateSet('install','build','typecheck','product','diagnostics')][string]$Stage,
 [Parameter(Mandatory)][string]$EvidenceDirectory,
 [Parameter(Mandatory)][ValidateRange(1,2147483647)][int]$SessionId,
 [Parameter(Mandatory)][int]$OuterDriverExitCode,
 [Parameter(Mandatory)][ValidateSet('external-session-native-exit')][string]$OuterObservationSource
)
$ErrorActionPreference='Stop';$e=$EvidenceDirectory
$readbackPath="$e/$Stage.full-independent-readback.json"
$readbackStream=[IO.File]::Open($readbackPath,[IO.FileMode]::CreateNew,[IO.FileAccess]::ReadWrite,[IO.FileShare]::Read)
$fail=[Collections.Generic.List[string]]::new();$r=$null;$i=$null;$p=$null;$driver=$null;$nested=$null;$terminalHash=$null;$driverHash=$null;$nestedHash=$null;$allNativeChecksCompleted=$false
try {
 try {
$terminal="$e/$Stage.terminal-custody.json";$terminalHash=(Get-FileHash $terminal).Hash;$r=Get-Content $terminal -Raw|ConvertFrom-Json -DateKind String;$i=Get-Content $r.initialReceipt -Raw|ConvertFrom-Json -DateKind String;$p=Get-Content "$e/$Stage.preflight.json" -Raw|ConvertFrom-Json -DateKind String


if((Get-FileHash $r.initialReceipt).Hash -ine $r.initialReceiptSha256){$fail.Add('initial-raw-hash')}
foreach($prop in $r.logs.PSObject.Properties){$v=$prop.Value;if((Get-FileHash $v.path).Hash -ine $v.sha256 -or (Get-Item $v.path).Length -ne $v.byteLength){$fail.Add('raw-log-hash-size-'+$prop.Name)}}
if((Get-FileHash $i.rootPreflight.path).Hash -ine $i.rootPreflight.sha256){$fail.Add('preflight-raw-hash')}
foreach($field in @('native','caller','parentCandidate')){if(($i.$field|ConvertTo-Json -Compress -Depth 10) -cne ($r.$field|ConvertTo-Json -Compress -Depth 10)){$fail.Add('initial-terminal-'+$field)};if($r.$field.gaps.Count -ne 0 -or [long]$r.$field.birthFileTimeUtc -le 0 -or !$r.$field.retainedHandle){$fail.Add('native-completeness-'+$field)}}
if(($i.command|ConvertTo-Json -Compress -Depth 10) -cne ($p.command|ConvertTo-Json -Compress -Depth 10)){$fail.Add('literal-command-object')}
foreach($prop in $p.environment.PSObject.Properties){if($i.environment.($prop.Name) -cne $prop.Value){$fail.Add('literal-env-'+$prop.Name)}}
function Normalize($x){$x=$x -replace '^\\\\\?\\','';[IO.Path]::GetFullPath($x).Replace('/','\')}
if($r.native.tokenUserSid -cne $p.expected.tokenUserSid -or (Normalize $r.native.physicalImagePath) -ine (Normalize $p.expected.imagePath) -or $r.native.physicalImageSha256 -ine $p.expected.imageSha256 -or $r.caller.tokenUserSid -cne $p.expected.tokenUserSid -or (Normalize $r.caller.physicalImagePath) -ine (Normalize $p.expected.callerImagePath) -or $r.caller.physicalImageSha256 -ine $p.expected.callerImageSha256){$fail.Add('admitted-token-image-binding')}
if($r.native.parentPid -ne $r.caller.pid -or $r.caller.parentPid -ne $r.parentCandidate.pid -or [long]$r.native.birthFileTimeUtc -lt [long]$r.caller.birthFileTimeUtc -or [long]$r.parentCandidate.birthFileTimeUtc -gt [long]$r.caller.birthFileTimeUtc -or [long]$r.parentCandidate.exitFileTimeUtc -ne 0){$fail.Add('parent-birth-live-binding')}
if(!$r.initialDurable -or !$r.naturalWaitForExit -or $r.exitCode -ne 0 -or !$r.stdoutEof -or !$r.stderrEof -or $r.observerErrors.Count -or $r.identityFailures.Count -or @($r.discardDrain|Where-Object used).Count -or $r.terminalNative.birthFileTimeUtc -cne $r.native.birthFileTimeUtc -or [long]$r.terminalNative.exitFileTimeUtc -le [long]$r.native.birthFileTimeUtc){$fail.Add('natural-samehandle-exit-eof-zero-error')}
if($r.supportingObservations.cim){$c=$r.supportingObservations.cim;$ft=[DateTime]::Parse($c.creationUtc,[Globalization.CultureInfo]::InvariantCulture,[Globalization.DateTimeStyles]::RoundtripKind).ToFileTimeUtc();$difference=[long]$r.native.birthFileTimeUtc-$ft;if($c.pid -ne $r.native.pid -or $c.parentPid -ne $r.native.parentPid -or $difference -lt 0 -or $difference -gt 9 -or ($c.executablePath -and (Normalize $c.executablePath) -ine (Normalize $r.native.osImagePath))){$fail.Add('supporting-cim-contradiction')}}
if((Get-FileHash $terminal).Hash -cne $terminalHash){$fail.Add('terminal-stability')}

  # Inspect the whole retained preflight audit and all row-file digests; do not
  # convert a historical admitted count or a missing row set into a pass.
  $auditPath="$e/$Stage.audit.json"
  if($p.audit.path -cne $auditPath -or (Get-FileHash -LiteralPath $auditPath).Hash -ine $p.audit.sha256){throw 'Complete preflight audit binding failed'}
  $audit=Get-Content -LiteralPath $auditPath -Raw|ConvertFrom-Json -DateKind String
  foreach($rowFile in @(@{leaf='tracked-rows.json';sha=$p.audit.trackedRowsSha256},@{leaf='sealed-rows.json';sha=$p.audit.sealedRowsSha256},@{leaf='full-acl-rows.jsonl';sha=$p.audit.aclRowsSha256})){if((Get-FileHash -LiteralPath "$e/$Stage.$($rowFile.leaf)").Hash -ine $rowFile.sha){throw 'Complete preflight row digest mismatch'}}
  $admission=Get-Content -LiteralPath $p.authority.admission -Raw|ConvertFrom-Json -DateKind String
  if((Get-FileHash -LiteralPath $p.authority.admission).Hash -ine $p.authority.sha256 -or $admission.schema -cne 'issue1598-root-admission-v2' -or $audit.head -cne $admission.head -or $audit.tree -cne $admission.tree -or $audit.trackedCount -ne $admission.trackedCount -or $audit.sealedCount -ne $admission.sealedCount -or $audit.failures.Count -ne 0 -or $audit.status.Count -ne 0){throw 'Complete fresh-candidate preflight audit failed'}
  $admittedCommand=$admission.commands.$Stage
  foreach($observedCommand in @($admittedCommand,$audit.command)){
   if(!$observedCommand -or $observedCommand.fileName -cne $p.command.fileName -or $observedCommand.workingDirectory -cne $p.command.workingDirectory -or $observedCommand.arguments -isnot [array] -or $observedCommand.arguments.Count -ne $p.command.arguments.Count){throw 'Fresh admitted/preflight/audit literal command mismatch'}
   for($j=0;$j -lt $p.command.arguments.Count;$j++){if($observedCommand.arguments[$j] -cne $p.command.arguments[$j]){throw 'Fresh admitted/preflight/audit argv mismatch'}}
  }
  if(($audit.admittedStageCommands|ConvertTo-Json -Compress -Depth 10) -cne ($admission.commands|ConvertTo-Json -Compress -Depth 10)){throw 'Complete admitted stage command map mismatch'}
  $allNativeChecksCompleted=$true

  $driverPath="$e/$Stage.driver-completion.json";$driverHash=(Get-FileHash -LiteralPath $driverPath).Hash
  $driver=Get-Content -LiteralPath $driverPath -Raw|ConvertFrom-Json -DateKind String
  if($driver.schema -cne 'issue1598-driver-completion-v1' -or $driver.stage -cne $Stage -or $driver.invocationId -notmatch '^[a-f0-9]{32}$'){throw 'Driver completion invalid'}
  if(!$driver.command -or ($driver.command|ConvertTo-Json -Compress -Depth 10) -cne ($p.command|ConvertTo-Json -Compress -Depth 10)){throw 'Driver status literal command binding failed'}
  if($driver.driverFailure -or !$driver.nestedCompletion){throw 'Driver/nested completion absent or failed'}
  if($driver.propagatedExitCode -isnot [int] -or $OuterDriverExitCode -ne $driver.propagatedExitCode){$fail.Add('outer-driver-observation-mismatch')}
  if($OuterDriverExitCode -ne 0){$fail.Add('outer-driver-nonzero')}
  $nestedPath="$e/$Stage.wrapper-completion.json";$nestedHash=(Get-FileHash -LiteralPath $nestedPath).Hash
  if($driver.nestedCompletion.path -cne $nestedPath -or $nestedHash -ine $driver.nestedCompletion.sha256){throw 'Nested completion digest/binding failed'}
  $nested=Get-Content -LiteralPath $nestedPath -Raw|ConvertFrom-Json -DateKind String
  if($nested.schema -cne 'issue1598-wrapper-completion-v1' -or $nested.invocationId -cne $driver.invocationId -or $nested.label -cne $Stage -or $nested.rootPreflightPath -cne $driver.preflight.path -or $nested.rootPreflightSha256 -ine $driver.preflight.sha256){throw 'Nested completion identity failed'}
  if(($nested.outcome|ConvertTo-Json -Compress -Depth 30) -cne ($driver.nestedCompletion.outcome|ConvertTo-Json -Compress -Depth 30)){throw 'Driver and wrapper completion differ'}
  if((Get-FileHash -LiteralPath $driver.wrapper.path).Hash -ine $driver.wrapper.sha256){$fail.Add('wrapper-source-digest')}
  if($nested.outcome.status -cne 'success' -or $nested.outcome.completionExitCode -ne 0 -or $nested.outcome.nativeChildExitCode -ne 0 -or $nested.outcome.qualified -ne $true -or $nested.outcome.terminalDurable -ne $true -or $nested.outcome.observerErrors.Count){$fail.Add('nested-wrapper-completion-failed')}
  if($nested.outcome.nativeChildExitCode -ne $r.exitCode -or $nested.outcome.terminalPath -cne $terminal){$fail.Add('nested-native-receipt-binding')}
  if((Get-FileHash -LiteralPath $nestedPath).Hash -cne $nestedHash -or (Get-FileHash -LiteralPath $driverPath).Hash -cne $driverHash){$fail.Add('completion-stability')}
  if($r.qualificationPassed -isnot [bool] -or $r.qualificationPassed -ne $true){$fail.Add('native-qualification-failed')}
  $allNativeChecksCompleted=$true
 }catch{$fail.Add('readback-observer-failed: '+$_.Exception.Message)}
 $record=[ordered]@{schema='issue1598-independent-readback-v1';stage=$Stage;command=if($p){$p.command}else{$null};outerDriver=@{exitCode=$OuterDriverExitCode;sessionId=$SessionId;observationSource=$OuterObservationSource};nestedWrapperCompletion=if($nested){@{sha256=$nestedHash;outcome=$nested.outcome}}else{$null};driverCompletion=if($driver){@{sha256=$driverHash;propagatedExitCode=$driver.propagatedExitCode;failure=$driver.driverFailure}}else{$null};nativeChild=if($r){@{exitCode=$r.exitCode;native=$r.native;terminalNative=$r.terminalNative;logs=$r.logs}}else{$null};readbackAtUtc=[DateTime]::UtcNow.ToString('o');terminalSha256=$terminalHash;checks=@{fullNativeChecksCompleted=$allNativeChecksCompleted;allChecksPassed=($allNativeChecksCompleted -and $fail.Count -eq 0)};failures=$fail.ToArray();passed=($allNativeChecksCompleted -and $fail.Count -eq 0);limits='Top-level custody only; external outer status remains separately sourced; no independent compiler/descendant/native product acceptance. Supporting CIM argv absent is not decoded argv evidence.'}
 $bytes=[Text.UTF8Encoding]::new($false).GetBytes(($record|ConvertTo-Json -Depth 40)+[Environment]::NewLine)
 $readbackStream.Write($bytes);$readbackStream.Flush($true)
}finally{$readbackStream.Dispose()}
if($fail.Count){throw ($fail -join '; ')}
Write-Output "$Stage independent readback passed"
