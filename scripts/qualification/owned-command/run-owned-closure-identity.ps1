param(
 [Parameter(Mandatory)][string]$FileName,[Parameter(Mandatory)][string[]]$ArgumentList,
 [Parameter(Mandatory)][string]$WorkingDirectory,[Parameter(Mandatory)][string]$EvidenceDirectory,
 [Parameter(Mandatory)][ValidatePattern('^[A-Za-z0-9_-]+$')][string]$Label,
 [Parameter(Mandatory)][string]$WorkspaceRoot,[Parameter(Mandatory)][string]$InstanceRegistryPath,
 [Parameter(Mandatory)][string]$HostPortRegistryPath,
 [Parameter(Mandatory)][string]$ExpectedTokenUserSid,
 [Parameter(Mandatory)][string]$ExpectedPhysicalImagePath,
 [Parameter(Mandatory)][ValidatePattern('^[a-fA-F0-9]{64}$')][string]$ExpectedImageSha256,
 [Parameter(Mandatory)][string]$ExpectedCallerImagePath,
 [Parameter(Mandatory)][ValidatePattern('^[a-fA-F0-9]{64}$')][string]$ExpectedCallerImageSha256,
 [Parameter(Mandatory)][string]$CompletionPath,
 [Parameter(Mandatory)][ValidatePattern('^[a-f0-9]{32}$')][string]$InvocationId,
 [Parameter(Mandatory)][string]$RootPreflightPath,
 [Parameter(Mandatory)][ValidatePattern('^[a-fA-F0-9]{64}$')][string]$RootPreflightSha256
)
$ErrorActionPreference='Stop'
function InvokeOwnedCommand {
# SOURCE-ONLY candidate: fresh cumulative review and ROOT SHA pin mandatory.
$flags=[Reflection.BindingFlags]'NonPublic,Public,Static'
function ExactMethod($type,[string]$name,$returnType,[type[]]$parameters) {
 $matches=@($type.GetMethods($flags)|Where-Object {
  $m=$_; $ps=$m.GetParameters(); $ok=($m.Name -ceq $name -and $m.ReturnType -eq $returnType -and $ps.Count -eq $parameters.Count)
  if($ok){for($i=0;$i -lt $parameters.Count;$i++){if($ps[$i].ParameterType -ne $parameters[$i]){$ok=$false}}}; $ok
 })
 if($matches.Count -ne 1){throw "Installed API unique exact signature unavailable: $name; no launch"}; return $matches[0]
}
$kernel=[Diagnostics.Process].Assembly.GetType('Interop+Kernel32',$true)
$times=ExactMethod $kernel 'GetProcessTimes' ([bool]) @([Microsoft.Win32.SafeHandles.SafeProcessHandle],[long].MakeByRefType(),[long].MakeByRefType(),[long].MakeByRefType(),[long].MakeByRefType())
$imageMethod=ExactMethod $kernel 'GetModuleFileNameEx' ([int]) @([Microsoft.Win32.SafeHandles.SafeProcessHandle],[IntPtr],[char[]],[int])
$parentProperties=@([Diagnostics.Process].GetProperties([Reflection.BindingFlags]'NonPublic,Instance')|Where-Object {$_.Name -ceq 'ParentProcessId' -and $_.PropertyType -eq [int] -and $_.GetIndexParameters().Count -eq 0 -and $_.GetMethod -and $_.GetMethod.GetParameters().Count -eq 0})
if($parentProperties.Count -ne 1){throw 'Exact ParentProcessId property unavailable; no launch'}; $parentProperty=$parentProperties[0]
$advapi=[Security.Principal.WindowsIdentity].Assembly.GetType('Interop+Advapi32',$true)
$tokenMethod=ExactMethod $advapi 'OpenProcessToken' ([bool]) @([IntPtr],[Security.Principal.TokenAccessLevels],[Microsoft.Win32.SafeHandles.SafeAccessTokenHandle].MakeByRefType())
$fsType=[IO.File].Assembly.GetType('System.IO.FileSystem',$true)
$finalNames=@($fsType.GetMethods($flags)|Where-Object {$_.Name -like '*GetFinalPathNameByHandle*'}|ForEach-Object {$_.Name}|Select-Object -Unique)
if($finalNames.Count -ne 1){throw 'Final path helper name ambiguous; no launch'}
$finalPathMethod=ExactMethod $fsType $finalNames[0] ([uint32]) @([Microsoft.Win32.SafeHandles.SafeFileHandle],[char[]])
function Birth($handle){$a=[object[]]@($handle,[long]0,[long]0,[long]0,[long]0);if(!$times.Invoke($null,$a)){throw 'GetProcessTimes failed'};return $a}
function Capture($process,$handle){
 $r=[ordered]@{pid=$process.Id;capturedAtUtc=[DateTime]::UtcNow.ToString('o');retainedHandle=$handle.DangerousGetHandle().ToInt64().ToString();gaps=@()}
 try{$t=Birth $handle;$r.birthFileTimeUtc=$t[1].ToString();$r.exitFileTimeUtc=$t[2].ToString();$r.birthUtc=[DateTime]::FromFileTimeUtc($t[1]).ToString('o')}catch{$r.gaps+=@{field='birth';error=$_.Exception.Message}}
 try{$ta=[object[]]@($handle.DangerousGetHandle(),[Security.Principal.TokenAccessLevels]::Query,$null);if(!$tokenMethod.Invoke($null,$ta)){throw 'OpenProcessToken failed'};$token=$ta[2];try{$identity=[Security.Principal.WindowsIdentity]::new($token.DangerousGetHandle());try{$r.tokenUserSid=$identity.User.Value;$r.tokenOwnerSid=$identity.Owner.Value;$r.tokenUserMeaning='TokenUser from the opened actual process token';$r.tokenOwnerMeaning='TokenOwner from the same token; distinct from TokenUser, not a user alias'}finally{$identity.Dispose()}}finally{$token.Dispose()}}catch{$r.gaps+=@{field='token';error=$_.Exception.Message}}
 try{$r.parentPid=[int]$parentProperty.GetValue($process)}catch{$r.gaps+=@{field='parentPid';error=$_.Exception.Message}}
 try{$chars=[char[]]::new(32768);$n=$imageMethod.Invoke($null,[object[]]@($handle,[IntPtr]::Zero,$chars,$chars.Length));if($n -le 0 -or $n -ge $chars.Length){throw 'Image path absent/truncated'};$r.osImagePath=[string]::new($chars,0,$n);$s=[IO.File]::Open($r.osImagePath,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read);try{$chars=[char[]]::new(32768);$n=$finalPathMethod.Invoke($null,[object[]]@($s.SafeFileHandle,$chars));if($n -le 0 -or $n -ge $chars.Length){throw 'Final path absent/truncated'};$r.physicalImagePath=[string]::new($chars,0,[int]$n);$r.physicalImageSha256=[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($s));$r.imageByteLength=$s.Length;$r.imageBinding='Retained process OS image name then held physical file path/hash; not loaded-memory digest'}finally{$s.Dispose()}}catch{$r.gaps+=@{field='physicalImage';error=$_.Exception.Message}}
 return $r
}
function ComparablePath([string]$path){if($path.StartsWith('\\?\')){$path=$path.Substring(4)};return [IO.Path]::GetFullPath($path).TrimEnd('\','/').Replace('/','\')}
function SamePath([string]$a,[string]$b){return [StringComparer]::OrdinalIgnoreCase.Equals((ComparablePath $a),(ComparablePath $b))}
# ROOT supplies a freshly revalidated, hash-pinned preflight, not a historical boolean.
# Its required contract is documented in the packet. It does not replace native observation below.
if((Get-FileHash -LiteralPath $RootPreflightPath).Hash -ine $RootPreflightSha256){throw 'ROOT preflight digest mismatch; no launch'}
$admit=Get-Content -LiteralPath $RootPreflightPath -Raw|ConvertFrom-Json -DateKind String
if($admit.schema -cne 'issue1590-command-preflight-v1' -or $admit.state -cne 'ROOT_CURRENT_COMMAND_PREFLIGHT_PASSED'){throw 'ROOT current command preflight absent; no launch'}
foreach($gate in @('trackedRawSourceHeadTreeIndex','physicalToolsDigests','regularNoReparseChains','exclusiveSourceRuntimeEvidenceAcl','literalEnvironment','nativeDeadlineCriterionUnchanged')){if($admit.checks.$gate -isnot [bool] -or $admit.checks.$gate -ne $true){throw "Mandatory ROOT preflight failed: $gate"}}
if(!(SamePath $admit.command.fileName $FileName) -or !(SamePath $admit.command.workingDirectory $WorkingDirectory) -or $admit.command.arguments.Count -ne $ArgumentList.Count){throw 'Preflight command mismatch'}
for($i=0;$i -lt $ArgumentList.Count;$i++){if($admit.command.arguments[$i] -cne $ArgumentList[$i]){throw 'Preflight argv mismatch'}}
if($admit.environment.SERVICE_LASSO_WORKSPACE_ROOT -cne $WorkspaceRoot -or $admit.environment.SERVICE_LASSO_INSTANCE_REGISTRY_PATH -cne $InstanceRegistryPath -or $admit.environment.SERVICE_LASSO_HOST_PORT_REGISTRY_PATH -cne $HostPortRegistryPath -or !(SamePath $admit.evidenceDirectory $EvidenceDirectory) -or $admit.label -cne $Label){throw 'Literal environment/evidence mismatch'}
if($admit.expected.tokenUserSid -cne $ExpectedTokenUserSid -or !(SamePath $admit.expected.imagePath $ExpectedPhysicalImagePath) -or $admit.expected.imageSha256 -ine $ExpectedImageSha256 -or !(SamePath $admit.expected.callerImagePath $ExpectedCallerImagePath) -or $admit.expected.callerImageSha256 -ine $ExpectedCallerImageSha256){throw 'Admitted identity mismatch'}
if(!(SamePath $FileName $ExpectedPhysicalImagePath) -or (Get-FileHash -LiteralPath $FileName).Hash -ine $ExpectedImageSha256){throw 'Executable prelaunch mismatch'}
$errors=[Collections.Generic.List[object]]::new()
function RecordError([string]$phase,$errorValue){$errors.Add(@{phase=$phase;error=[string]$errorValue;observedAtUtc=[DateTime]::UtcNow.ToString('o')})}
function WriteReserved($stream,$value){$bytes=[Text.UTF8Encoding]::new($false).GetBytes(($value|ConvertTo-Json -Depth 20)+[Environment]::NewLine);$stream.Write($bytes);$stream.Flush($true)}
function HashHeld($stream){$position=$stream.Position;try{$stream.Position=0;return [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($stream))}finally{$stream.Position=$position}}
$caller=$null;$parent=$null;$p=$null;$streams=[Collections.Generic.List[IO.FileStream]]::new();$started=$false;$naturalWait=$false;$exitCode=$null;$native=$null;$terminalTimes=$null;$initialDurable=$false;$terminalDurable=$false;$support=[ordered]@{cim=$null;cimGap=$null}
try{
 $caller=[Diagnostics.Process]::GetCurrentProcess();$callerHandle=$caller.SafeHandle;$callerNative=Capture $caller $callerHandle
 if($callerNative.gaps.Count -ne 0 -or [long]$callerNative.birthFileTimeUtc -le 0 -or $callerNative.pid -ne $PID -or $callerNative.tokenUserSid -cne $ExpectedTokenUserSid -or !(SamePath $callerNative.physicalImagePath $ExpectedCallerImagePath) -or $callerNative.physicalImageSha256 -ine $ExpectedCallerImageSha256){throw 'Concrete caller native binding failed; no launch'}
 # Numeric PID opens only a candidate. The retained lifetime bounds are mandatory.
 $parent=[Diagnostics.Process]::GetProcessById([int]$callerNative.parentPid);$parentHandle=$parent.SafeHandle;$parentNative=Capture $parent $parentHandle
 if($parentNative.gaps.Count -ne 0 -or [long]$parentNative.birthFileTimeUtc -le 0 -or $parentNative.pid -ne $callerNative.parentPid -or [long]$parentNative.birthFileTimeUtc -gt [long]$callerNative.birthFileTimeUtc -or [long]$parentNative.exitFileTimeUtc -ne 0){throw 'Caller ancestry candidate lacks live retained birth bound; no launch'}
 $out=Join-Path $EvidenceDirectory "$Label.stdout.raw.log";$err=Join-Path $EvidenceDirectory "$Label.stderr.raw.log";$initialPath=Join-Path $EvidenceDirectory "$Label.initial-native.json";$finalPath=Join-Path $EvidenceDirectory "$Label.terminal-custody.json"
 # Reserve ALL evidence destinations before child launch. Failed reservations dispose every earlier handle.
 foreach($path in @($out,$err,$initialPath,$finalPath)){$streams.Add([IO.File]::Open($path,[IO.FileMode]::CreateNew,[IO.FileAccess]::ReadWrite,[IO.FileShare]::Read))}
 $ofs=$streams[0];$efs=$streams[1];$ifs=$streams[2];$ffs=$streams[3]
 $psi=[Diagnostics.ProcessStartInfo]::new();$psi.FileName=$FileName;$psi.WorkingDirectory=$WorkingDirectory;$psi.UseShellExecute=$false;$psi.RedirectStandardOutput=$true;$psi.RedirectStandardError=$true;$psi.CreateNoWindow=$true
 $psi.Environment['SERVICE_LASSO_WORKSPACE_ROOT']=$WorkspaceRoot;$psi.Environment['SERVICE_LASSO_INSTANCE_REGISTRY_PATH']=$InstanceRegistryPath;$psi.Environment['SERVICE_LASSO_HOST_PORT_REGISTRY_PATH']=$HostPortRegistryPath;foreach($arg in $ArgumentList){[void]$psi.ArgumentList.Add($arg)}
 $p=[Diagnostics.Process]::new();$p.StartInfo=$psi
 $started=$p.Start()
 $childHandle=$p.SafeHandle
 if(!$started){throw 'Process.Start returned false'}
 $pumps=[Collections.Generic.List[object]]::new()
 foreach($item in @(@{name='stdout';writer=$ofs},@{name='stderr';writer=$efs})){
  $pump=[ordered]@{name=$item.name;reader=$null;task=$null;originalEof=$false;discardDrain=$false;drainEof=$false;finished=$false}
  try{if($item.name -ceq 'stdout'){$pump.reader=$p.StandardOutput.BaseStream}else{$pump.reader=$p.StandardError.BaseStream};$pump.task=$pump.reader.CopyToAsync($item.writer)}catch{RecordError ($item.name+'-copy-start') $_.Exception.Message;$pump.discardDrain=$true;try{if(!$pump.reader){throw 'Actual pipe reader unavailable'};$pump.task=$pump.reader.CopyToAsync([IO.Stream]::Null)}catch{RecordError ($item.name+'-discard-start') $_.Exception.Message;$pump.finished=$true}}
  $pumps.Add($pump)
 }
 try{
  $native=Capture $p $childHandle
  $initial=[ordered]@{schemaVersion=3;label=$Label;native=$native;caller=$callerNative;parentCandidate=$parentNative;rootPreflight=@{path=$RootPreflightPath;sha256=$RootPreflightSha256};command=@{fileName=$FileName;arguments=$ArgumentList;workingDirectory=$WorkingDirectory};environment=@{SERVICE_LASSO_WORKSPACE_ROOT=$WorkspaceRoot;SERVICE_LASSO_INSTANCE_REGISTRY_PATH=$InstanceRegistryPath;SERVICE_LASSO_HOST_PORT_REGISTRY_PATH=$HostPortRegistryPath}}
  try{WriteReserved $ifs $initial;$initialDurable=$true}catch{RecordError 'initial-receipt' $_.Exception.Message}
  try{$c=Get-CimInstance Win32_Process -Filter "ProcessId=$($p.Id)" -ErrorAction Stop;if(!$c){throw 'Supporting CIM absent'};$support.cim=@{pid=[int]$c.ProcessId;parentPid=[int]$c.ParentProcessId;creationUtc=$c.CreationDate.ToUniversalTime().ToString('o');executablePath=$c.ExecutablePath;commandLine=$c.CommandLine}}catch{$support.cimGap=$_.Exception.Message}
 }catch{RecordError 'capture-or-support' $_.Exception.Message}
}finally{
 if($started){
  # Always visit BOTH tasks. WhenAny detects a failed destination while the other pipe is still live.
  # Continue that reader to Stream.Null once; original EOF remains FALSE and qualification fails.
  if($pumps){
   while(@($pumps|Where-Object {!$_.finished}).Count -gt 0){
    $pending=@($pumps|Where-Object {!$_.finished -and $_.task}); if($pending.Count -eq 0){break}
    try{[void][Threading.Tasks.Task]::WhenAny([Threading.Tasks.Task[]]@($pending|ForEach-Object {$_.task})).GetAwaiter().GetResult()}catch{RecordError 'copy-monitor' $_.Exception.Message}
    foreach($pump in $pending){if($pump.task.IsCompleted){
     try{$pump.task.GetAwaiter().GetResult();if($pump.discardDrain){$pump.drainEof=$true}else{$pump.originalEof=$true};$pump.finished=$true}
     catch{RecordError ($pump.name+'-copy-completion') $_.Exception.Message;if(!$pump.discardDrain){$pump.discardDrain=$true;try{$pump.task=$pump.reader.CopyToAsync([IO.Stream]::Null)}catch{RecordError ($pump.name+'-discard-start') $_.Exception.Message;$pump.finished=$true}}else{$pump.finished=$true}}
    }}
   }
  }
  # No pipe/process dispose before observed natural wait. Failed wait is retried without a deadline,
  # termination or inference; an unrecoverable observer failure can leave this wrapper waiting forever.
  $waitErrorRecorded=$false
  while(!$naturalWait){try{$p.WaitForExit();$naturalWait=$true}catch{if(!$waitErrorRecorded){RecordError 'natural-wait' $_.Exception.Message;$waitErrorRecorded=$true}}}
  try{$exitCode=$p.ExitCode}catch{RecordError 'actual-child-exit' $_.Exception.Message}
  foreach($s in @($ofs,$efs)){if($s){try{$s.Flush($true)}catch{RecordError 'log-durable-flush' $_.Exception.Message}}}
  try{$terminalTimes=Birth $childHandle}catch{RecordError 'terminal-native-times' $_.Exception.Message}
  $identityFailures=[Collections.Generic.List[string]]::new()
  try{
   if(!$native -or $native.gaps.Count -ne 0 -or [long]$native.birthFileTimeUtc -le 0){$identityFailures.Add('child-native-incomplete')}
   if($native.tokenUserSid -cne $ExpectedTokenUserSid){$identityFailures.Add('TokenUser-mismatch')}
   if($native.parentPid -ne $callerNative.pid -or $callerNative.pid -ne $PID){$identityFailures.Add('child-caller-parent-mismatch')}
   if(!(SamePath $native.physicalImagePath $ExpectedPhysicalImagePath) -or $native.physicalImageSha256 -ine $ExpectedImageSha256){$identityFailures.Add('observed-image-mismatch')}
   if(!$terminalTimes -or $terminalTimes[1].ToString() -cne $native.birthFileTimeUtc -or $terminalTimes[2] -le 0){$identityFailures.Add('same-retained-birth-terminal-missing')}
   if([long]$native.birthFileTimeUtc -lt [long]$callerNative.birthFileTimeUtc){$identityFailures.Add('child-predates-caller')}
   $ct=Birth $callerHandle
   if($ct[1].ToString() -cne $callerNative.birthFileTimeUtc -or $ct[2] -ne 0){$identityFailures.Add('caller-retained-lifetime-mismatch')}
   $pt=Birth $parentHandle
   if($pt[1].ToString() -cne $parentNative.birthFileTimeUtc -or ($pt[2] -ne 0 -and $pt[2] -lt [long]$callerNative.birthFileTimeUtc)){$identityFailures.Add('parent-retained-lifetime-mismatch')}
   if($support.cim){
    if($support.cim.pid -ne $native.pid -or $support.cim.parentPid -ne $native.parentPid){$identityFailures.Add('supporting-CIM-identity-contradiction')}
    $cimBirth=[DateTime]::Parse($support.cim.creationUtc,[Globalization.CultureInfo]::InvariantCulture,[Globalization.DateTimeStyles]::RoundtripKind).ToFileTimeUtc()
    # CIM microsecond precision can truncate at most nine 100ns FILETIME ticks.
    $diff=[long]$native.birthFileTimeUtc-$cimBirth;if($diff -lt 0 -or $diff -gt 9){$identityFailures.Add('supporting-CIM-birth-contradiction')}
    if($support.cim.executablePath -and !(SamePath $support.cim.executablePath $native.osImagePath)){$identityFailures.Add('supporting-CIM-image-contradiction')}
   }
  }catch{RecordError 'identity-validation' $_.Exception.Message;$identityFailures.Add('identity-validation-error')}
  $logs=[ordered]@{}
  foreach($entry in @(@{name='stdout';path=$out;stream=$ofs},@{name='stderr';path=$err;stream=$efs})){
   try{$logs[$entry.name]=@{path=$entry.path;byteLength=$entry.stream.Length;sha256=(HashHeld $entry.stream)}}catch{RecordError ($entry.name+'-inventory') $_.Exception.Message}
  }
  $stdoutEof=($pumps -and $pumps[0].originalEof);$stderrEof=($pumps -and $pumps[1].originalEof)
  $initialHash=$null;try{if($initialDurable){$initialHash=HashHeld $ifs}}catch{RecordError 'initial-receipt-inventory' $_.Exception.Message}
  $qualified=($initialDurable -and $initialHash -and $naturalWait -and $exitCode -eq 0 -and $stdoutEof -and $stderrEof -and $errors.Count -eq 0 -and $identityFailures.Count -eq 0)
  $final=[ordered]@{schemaVersion=3;label=$Label;initialReceipt=$initialPath;initialReceiptSha256=$initialHash;initialDurable=$initialDurable;native=$native;caller=$callerNative;parentCandidate=$parentNative;ancestryMeaning='PID-selected candidate admitted only with retained native birth <= caller birth and observed live prelaunch; no general ancestry/control claim';supportingObservations=$support;naturalWaitForExit=$naturalWait;exitCode=$exitCode;stdoutEof=[bool]$stdoutEof;stderrEof=[bool]$stderrEof;discardDrain=@($pumps|ForEach-Object {@{stream=$_.name;used=$_.discardDrain;completedEof=$_.drainEof}});terminalNative=if($terminalTimes){@{birthFileTimeUtc=$terminalTimes[1].ToString();exitFileTimeUtc=$terminalTimes[2].ToString()}}else{$null};logs=$logs;observerErrors=@($errors.ToArray());identityFailures=@($identityFailures.ToArray());qualificationPassed=[bool]$qualified;endedAtUtc=[DateTime]::UtcNow.ToString('o');terminalReceiptMeaning='Candidate qualification decision; durable success exists only when the reserved terminal write and Flush(true) complete'}
  try{WriteReserved $ffs $final;$terminalDurable=$true}catch{RecordError 'terminal-receipt-write' $_.Exception.Message;[Console]::Error.WriteLine('Terminal receipt write failed after natural closure: '+$_.Exception.Message)}
 }
 foreach($s in $streams){try{$s.Dispose()}catch{RecordError 'reserved-stream-dispose' $_.Exception.Message}}
 foreach($obj in @($p,$parent,$caller)){if($obj){try{$obj.Dispose()}catch{RecordError 'handle-dispose' $_.Exception.Message}}}
}
# Native child status and observer failures remain independently represented.
$status=if(!$started){'unqualified'}elseif($null -ne $exitCode -and $exitCode -ne 0){'nonzero'}elseif(!$terminalDurable -or !$qualified -or $errors.Count -ne 0){'unqualified'}else{'success'}
$completionExitCode=if($status -ceq 'success'){0}elseif($null -ne $exitCode -and $exitCode -ne 0){[int]$exitCode}else{1}
return [pscustomobject]@{status=$status;completionExitCode=$completionExitCode;nativeChildExitCode=$exitCode;started=$started;terminalDurable=$terminalDurable;qualified=$qualified;observerErrors=@($errors.ToArray());terminalPath=$finalPath}
}
# No extra process: caller/parent remain the existing observed native boundary.
# Reserve separate completion before any preflight/native command. A missing,
# malformed or failed completion write is NEVER replaced by a guessed status.
$completionStream=[IO.File]::Open($CompletionPath,[IO.FileMode]::CreateNew,[IO.FileAccess]::ReadWrite,[IO.FileShare]::Read)
try {
  try {$outcome=InvokeOwnedCommand}
  catch {$outcome=[pscustomobject]@{status='exception';completionExitCode=1;nativeChildExitCode=$null;started=$null;terminalDurable=$false;qualified=$false;observerErrors=@(@{phase='wrapper-exception';error=$_.Exception.Message});terminalPath=$null}}
  $record=[ordered]@{schema='issue1598-wrapper-completion-v1';invocationId=$InvocationId;label=$Label;rootPreflightPath=$RootPreflightPath;rootPreflightSha256=$RootPreflightSha256;completedAtUtc=[DateTime]::UtcNow.ToString('o');outcome=$outcome;meaning='Explicit same-process nested wrapper completion; native child exit and outer driver exit are separate observations'}
  $bytes=[Text.UTF8Encoding]::new($false).GetBytes(($record|ConvertTo-Json -Depth 30)+[Environment]::NewLine)
  $completionStream.Write($bytes);$completionStream.Flush($true)
  $completionStream.Position=0
  $digest=[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($completionStream))
} finally {$completionStream.Dispose()}
# The sole output is emitted only after complete durable write and disposal.
[pscustomobject]@{schema='issue1598-wrapper-return-v1';invocationId=$InvocationId;completionPath=$CompletionPath;completionSha256=$digest;outcome=$outcome}
