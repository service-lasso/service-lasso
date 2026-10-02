param(
 [Parameter(Mandatory)][ValidateSet('install','build','typecheck','product','diagnostics','postflight')][string]$Stage,
 [Parameter(Mandatory)][string]$EvidenceDirectory,
 [Parameter(Mandatory)][string]$InputRoot,
 [Parameter(Mandatory)][string]$AdmissionPath,
 [Parameter(Mandatory)][ValidatePattern('^[a-fA-F0-9]{64}$')][string]$AdmissionSha256,
 [Parameter(Mandatory)][string]$WrapperPath,
 [Parameter(Mandatory)][ValidatePattern('^[a-fA-F0-9]{64}$')][string]$WrapperSha256,
 [Parameter(Mandatory)][string]$ReviewPath,
 [Parameter(Mandatory)][ValidatePattern('^[a-fA-F0-9]{64}$')][string]$ReviewSha256
)
$ErrorActionPreference='Stop'
# SOURCE-ONLY: new ROOT admission is mandatory. Historical authority is not executable input.
if(!$InputRoot -or !$AdmissionPath -or !$AdmissionSha256 -or !$WrapperPath -or !$WrapperSha256 -or !$ReviewPath -or !$ReviewSha256){throw 'Fresh exact-candidate ROOT pins required; no launch'}
$root=$InputRoot;$s="$root/source";$e=$EvidenceDirectory
$admission=$AdmissionPath;$wrapper=$WrapperPath
function Save($name,$v){[IO.File]::WriteAllText("$e/$name",($v|ConvertTo-Json -Depth 40),[Text.UTF8Encoding]::new($false))}
$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User
if(!(Test-Path -LiteralPath $e)){[void][IO.Directory]::CreateDirectory($e);$acl=[Security.AccessControl.DirectorySecurity]::new();$acl.SetOwner($sid);$acl.SetAccessRuleProtection($true,$false);foreach($id in @($sid,[Security.Principal.SecurityIdentifier]::new('S-1-5-18'))){$acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($id,'FullControl','ContainerInherit,ObjectInherit','None','Allow'))};[IO.FileSystemAclExtensions]::SetAccessControl((Get-Item -LiteralPath $e),$acl)}
# Reserve durable driver status before any actual preflight or nested work.
$invocation=[Guid]::NewGuid().ToString('N')
$driverPath="$e/$Stage.driver-completion.json"
$driverStream=[IO.File]::Open($driverPath,[IO.FileMode]::CreateNew,[IO.FileAccess]::ReadWrite,[IO.FileShare]::Read)
function InvokeQualificationStage {
$fail=[Collections.Generic.List[string]]::new();$chains=[Collections.Generic.Dictionary[string,object]]::new([StringComparer]::OrdinalIgnoreCase)
$kernel=[IO.File].Assembly.GetType('Interop+Kernel32');$create=@($kernel.GetMethods([Reflection.BindingFlags]'Static,Public,NonPublic')|Where-Object {$_.Name -eq 'CreateFile' -and $_.GetParameters().Count -eq 5});$final=@([IO.File].Assembly.GetType('System.IO.FileSystem').GetMethods([Reflection.BindingFlags]'Static,Public,NonPublic')|Where-Object {$_.Name -like '*GetFinalPathNameByHandle*'})
if($create.Count -ne 1 -or $final.Count -ne 1){throw 'Physical method ambiguity; no launch'}
function Normalize($p){if($p.StartsWith('\\?\')){$p=$p.Substring(4)};[IO.Path]::GetFullPath($p).TrimEnd('\','/')}
function Physical($path){$h=$create[0].Invoke($null,@([string]$path,0,[IO.FileShare]::ReadWrite,[IO.FileMode]::Open,33554432));try{if($h.IsInvalid){throw 'Invalid physical handle'};$b=[char[]]::new(32768);$n=$final[0].Invoke($null,@($h,$b));if($n -le 0 -or $n -ge $b.Length){throw 'Physical path invalid'};return @{path=[string]::new($b,0,[int]$n);heldHandle=$h.DangerousGetHandle().ToInt64();atUtc=[DateTime]::UtcNow.ToString('o')}}finally{$h.Dispose()}}
function CheckChain($p){$cur=Get-Item -LiteralPath $p -Force;while($cur){if(!$chains.ContainsKey($cur.FullName)){$a=Get-Acl -LiteralPath $cur.FullName;$ph=Physical $cur.FullName;$ok=([StringComparer]::OrdinalIgnoreCase.Equals((Normalize $ph.path),(Normalize $cur.FullName)) -and !($cur.Attributes -band [IO.FileAttributes]::ReparsePoint));$chains[$cur.FullName]=@{path=$cur.FullName;attributes=$cur.Attributes.ToString();physical=$ph;sddl=$a.Sddl;owner=$a.GetOwner([Security.Principal.SecurityIdentifier]).Value;matched=$ok};if(!$ok){$fail.Add("Chain mismatch: $($cur.FullName)")}};if($cur -is [IO.FileInfo]){$cur=$cur.Directory}else{$cur=$cur.Parent}}}
$pins=@(@{path=$admission;sha=$AdmissionSha256},@{path=$wrapper;sha=$WrapperSha256},@{path=$ReviewPath;sha=$ReviewSha256})
foreach($pin in $pins){CheckChain $pin.path;if((Get-FileHash -LiteralPath $pin.path).Hash -ine $pin.sha){throw 'Authority pin mismatch; no launch'}}
$a=Get-Content -LiteralPath $admission -Raw|ConvertFrom-Json -DateKind String
if($a.schema -cne 'issue1598-root-admission-v2' -or $a.state -cne 'ROOT_FINAL_COMPLETE_INPUT_ADMITTED' -or !( [StringComparer]::OrdinalIgnoreCase.Equals((Normalize $a.inputRoot),(Normalize $root))) -or !( [StringComparer]::OrdinalIgnoreCase.Equals((Normalize $a.evidenceDirectory),(Normalize $e))) -or $a.trackedCount -isnot [int] -or $a.trackedCount -le 0 -or $a.sealedCount -isnot [int] -or $a.sealedCount -le 0){throw 'Fresh ROOT candidate/root/count/evidence binding absent; no launch'}
foreach($inputPin in @(@{path="$root/metadata/inventory.json";sha=$a.sourceInventorySha256},@{path="$root/seal-manifest.json";sha=$a.sealManifestSha256},@{path="$root/metadata/tools.json";sha=$a.toolsManifestSha256})){CheckChain $inputPin.path;if($inputPin.sha -notmatch '^[a-fA-F0-9]{64}$' -or (Get-FileHash -LiteralPath $inputPin.path).Hash -ine $inputPin.sha){throw 'Fresh complete-input inventory/tool/seal pin mismatch; no launch'}}
# Never reuse a historical stage: guard every destination BEFORE the first write.
foreach($leaf in @('tracked-rows.json','sealed-rows.json','full-acl-rows.jsonl','derived-links.json','audit.json','preflight.json','stdout.raw.log','stderr.raw.log','initial-native.json','terminal-custody.json','wrapper-completion.json','full-independent-readback.json')){if(Test-Path -LiteralPath "$e/$Stage.$leaf"){throw 'Existing stage evidence retained; no overwrite or launch'}}
$inv=Get-Content "$root/metadata/inventory.json" -Raw|ConvertFrom-Json -DateKind String
function GitOid($b){$h=[Text.Encoding]::UTF8.GetBytes('blob '+$b.Length+[char]0);$j=[byte[]]::new($h.Length+$b.Length);[Array]::Copy($h,$j,$h.Length);[Array]::Copy($b,0,$j,$h.Length,$b.Length);[Convert]::ToHexString([Security.Cryptography.SHA1]::HashData($j))}
$rows=[Collections.Generic.List[object]]::new();foreach($f in $inv){$p=Join-Path $s $f.path;CheckChain $p;CheckChain $f.rawBlobReference;$b=[IO.File]::ReadAllBytes($p);$raw=[IO.File]::ReadAllBytes($f.rawBlobReference);$sha=[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($b));$rsha=[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($raw));$oid=GitOid $b;$roid=GitOid $raw;$ok=($sha -ieq $f.workspaceSha256 -and $b.Length -eq $f.workspaceLength -and $rsha -ieq $f.batchSha256 -and $raw.Length -eq $f.batchLength -and $oid -ieq $f.treeOid -and $roid -ieq $f.treeOid);$rows.Add(@{path=$f.path;length=$b.Length;sha256=$sha;genuineNulGitBlobSha1=$oid;rawLength=$raw.Length;rawSha256=$rsha;rawGitOid=$roid;expected=$f;matched=$ok});if(!$ok){$fail.Add("Tracked mismatch: $($f.path)")}};Save "$Stage.tracked-rows.json" $rows.ToArray()
$sealed=[Collections.Generic.List[object]]::new();$seal=Get-Content "$root/seal-manifest.json" -Raw|ConvertFrom-Json -DateKind String;foreach($f in $seal){$p=Join-Path $root $f.relative;CheckChain $p;$i=Get-Item -LiteralPath $p;$hash=(Get-FileHash -LiteralPath $p).Hash;$sd=(Get-Acl -LiteralPath $p).Sddl;$ok=($i.Length -eq $f.length -and $hash -ieq $f.sha256 -and $sd -ceq $f.sddl);$sealed.Add(@{path=$p;length=$i.Length;sha256=$hash;sddl=$sd;expected=$f;matched=$ok});if(!$ok){$fail.Add("Seal mismatch: $($f.relative)")}};Save "$Stage.sealed-rows.json" $sealed.ToArray()
$ts=Get-Content "$root/metadata/tools.json" -Raw|ConvertFrom-Json -DateKind String;$tools=@();foreach($t in $ts){$p=Normalize $t.physical;CheckChain $p;$i=Get-Item -LiteralPath $p;$hash=(Get-FileHash -LiteralPath $p).Hash;$ok=($hash -ieq $t.sha256 -and $i.Length -eq $t.length);$tools+=@{name=$t.name;path=$p;sha256=$hash;length=$i.Length;expected=$t.sha256;matched=$ok};if(!$ok){$fail.Add("Tool mismatch: $($t.name)")}}
$git=($tools|Where-Object name -eq git).path;$head=(& $git -C $s rev-parse HEAD).Trim();$tree=(& $git -C $s rev-parse 'HEAD^{tree}').Trim();$idx=@(& $git -C $s ls-files --stage);$status=@(& $git -C $s status --porcelain=v1 --untracked-files=all);$want=@($inv|ForEach-Object {"$($_.mode) $($_.treeOid) 0`t$($_.path)"})
if($head -cne $a.head -or $tree -cne $a.tree -or (Compare-Object $idx $want) -or $status.Count -ne 0 -or $rows.Count -ne $a.trackedCount -or $sealed.Count -ne $a.sealedCount){$fail.Add('Head/tree/fullindex/status/count failed')}
CheckChain "$s/.git/index"
$aclRows=[Collections.Generic.List[object]]::new();$links=[Collections.Generic.List[object]]::new();$aclCount=0
function AclRow($item,$protected){$ac=Get-Acl -LiteralPath $item.FullName;$owner=$ac.GetOwner([Security.Principal.SecurityIdentifier]).Value;$aces=@($ac.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])|ForEach-Object {@{sid=$_.IdentityReference.Value;type=$_.AccessControlType.ToString();rights=[int]$_.FileSystemRights;inherited=$_.IsInherited}});$ok=($owner -ceq $sid.Value -and (!$protected -or $ac.AreAccessRulesProtected) -and @($aces|Where-Object {$_.sid -notin @($sid.Value,'S-1-5-18') -or $_.type -ne 'Allow'}).Count -eq 0 -and @($aces|Where-Object sid -eq $sid.Value).Count -gt 0 -and @($aces|Where-Object sid -eq 'S-1-5-18').Count -gt 0);if(!$ok){$fail.Add("ACL mismatch: $($item.FullName)")};return @{path=$item.FullName;ownerSid=$owner;protected=$ac.AreAccessRulesProtected;sddl=$ac.Sddl;aces=$aces;matched=$ok}}
$stream=[IO.StreamWriter]::new("$e/$Stage.full-acl-rows.jsonl",$false,[Text.UTF8Encoding]::new($false));try{foreach($owned in @($s,"$root/session-runtime",$e)){CheckChain $owned;$aclRows.Add((AclRow (Get-Item -LiteralPath $owned) $true));foreach($item in Get-ChildItem -LiteralPath $owned -Force -Recurse){if($item.Attributes -band [IO.FileAttributes]::ReparsePoint){$target=$item.ResolveLinkTarget($true).FullName;$inside=$target.StartsWith(((Normalize $s)+'\'),[StringComparison]::OrdinalIgnoreCase);$links.Add(@{path=$item.FullName;target=$target;insideAdmittedSource=$inside});if(!$inside){$fail.Add("Derived link escape: $($item.FullName)")}};$stream.WriteLine(((AclRow $item $false)|ConvertTo-Json -Compress -Depth 8));$aclCount++}}}finally{$stream.Dispose()};Save "$Stage.derived-links.json" $links.ToArray()
$envRows=@();foreach($name in $a.environment.PSObject.Properties.Name){[Environment]::SetEnvironmentVariable($name,$a.environment.$name,'Process');$v=[Environment]::GetEnvironmentVariable($name,'Process');$exists=Test-Path -LiteralPath $v;$ok=$v -ceq $a.environment.$name;if($Stage -eq 'install' -and $exists){$ok=$false};if($exists){CheckChain $v};$envRows+=@{name=$name;literal=$v;expected=$a.environment.$name;exists=$exists;matched=$ok};if(!$ok){$fail.Add("ENV mismatch: $name")}}
if($Stage -eq 'install'){foreach($p in @("$s/node_modules","$s/dist")){if(Test-Path -LiteralPath $p){$fail.Add("Unexpected firstinput derived leaf: $p")}}}
$node=($tools|Where-Object name -eq node).path;$npm=($tools|Where-Object name -eq 'npm-cli').path;$pwsh=($tools|Where-Object name -eq pwsh).path
[string[]]$argv=@(switch($Stage){'install'{@($npm,'ci')};'build'{@($npm,'run','build')};'typecheck'{@($npm,'run','typecheck')};'product'{@($npm,'run','test:mcp:product')};'diagnostics'{@('--test','--test-concurrency=1','tests/packaged-verification-diagnostics.test.js')};'postflight'{@()}})
# ROOT v2 admits the complete literal command map, including the separate
# diagnostics regression gate. Product argv/package script remain unchanged.
$command=@{fileName=$node;arguments=$argv;workingDirectory=$s}
$requiredStages=@('install','build','typecheck','product','diagnostics','postflight')
if(!$a.commands -or (Compare-Object @($a.commands.PSObject.Properties.Name) $requiredStages)){throw 'Fresh ROOT complete literal stage command map absent; no launch'}
foreach($name in $requiredStages){
 [string[]]$expectedArgv=@(switch($name){'install'{@($npm,'ci')};'build'{@($npm,'run','build')};'typecheck'{@($npm,'run','typecheck')};'product'{@($npm,'run','test:mcp:product')};'diagnostics'{@('--test','--test-concurrency=1','tests/packaged-verification-diagnostics.test.js')};'postflight'{@()}})
 $admitted=$a.commands.$name
 if($admitted.fileName -cne $node -or $admitted.workingDirectory -cne $s -or $admitted.arguments -isnot [array] -or $admitted.arguments.Count -ne $expectedArgv.Count){throw 'Fresh ROOT literal command binding mismatch; no launch'}
 for($j=0;$j -lt $expectedArgv.Count;$j++){if($admitted.arguments[$j] -isnot [string] -or $admitted.arguments[$j] -cne $expectedArgv[$j]){throw 'Fresh ROOT literal argv mismatch; no launch'}}
}
Save "$Stage.audit.json" @{atUtc=[DateTime]::UtcNow.ToString('o');command=$command;admittedStageCommands=$a.commands;head=$head;tree=$tree;index=$idx;expectedIndex=$want;status=$status;trackedCount=$rows.Count;sealedCount=$sealed.Count;tools=$tools;chains=@($chains.Values);acl=$aclRows.ToArray();fullAclCount=$aclCount;environment=$envRows;failures=$fail.ToArray();derivedLinks=$links.ToArray();nativeCriterion='Exact fresh-admission tracked bytes unchanged; historical969source/2146seal remain preserved separately; original deadlines/retries/concurrency/skips/assertions preserved';limits=@('fastGit supporting/unqualified','SYSTEM ancestry denied not repaired','inheritedENV beyond3literals not fully audited','npm JS VersionInfo null not version proof','no descendant/compiler/operator acceptance')}
if($fail.Count){throw ('Preflight failed: '+($fail -join '; '))};if($Stage -eq 'postflight'){return [pscustomobject]@{schema='issue1598-driver-completion-v1';stage=$Stage;invocationId=$invocation;command=$command;driverFailure=$null;propagatedExitCode=0;postflightAuditPassed=$true;outerDriverExitObservation='UNOBSERVED_UNTIL_EXTERNAL_READBACK'}}
$pre="$e/$Stage.preflight.json";Save "$Stage.preflight.json" @{schema='issue1590-command-preflight-v1';state='ROOT_CURRENT_COMMAND_PREFLIGHT_PASSED';authority=@{admission=$admission;sha256=(Get-FileHash $admission).Hash;delegatedBy='ROOT'};checks=@{trackedRawSourceHeadTreeIndex=$true;physicalToolsDigests=$true;regularNoReparseChains=$true;exclusiveSourceRuntimeEvidenceAcl=$true;literalEnvironment=$true;nativeDeadlineCriterionUnchanged=$true};command=$command;environment=$a.environment;evidenceDirectory=$e;label=$Stage;expected=@{tokenUserSid=$sid.Value;imagePath=$node;imageSha256=($tools|Where-Object name -eq node).sha256;callerImagePath=$pwsh;callerImageSha256=($tools|Where-Object name -eq pwsh).sha256};audit=@{path="$e/$Stage.audit.json";sha256=(Get-FileHash "$e/$Stage.audit.json").Hash;trackedRowsSha256=(Get-FileHash "$e/$Stage.tracked-rows.json").Hash;sealedRowsSha256=(Get-FileHash "$e/$Stage.sealed-rows.json").Hash;aclRowsSha256=(Get-FileHash "$e/$Stage.full-acl-rows.jsonl").Hash}}

$completionPath="$e/$Stage.wrapper-completion.json"
$driverPath="$e/$Stage.driver-completion.json"
$returned=$null;$wrapperRecord=$null;$driverFailure=$null;$propagatedExitCode=1
try {
 try {
  $returned=@(& $wrapper -FileName $node -ArgumentList $argv -WorkingDirectory $s -EvidenceDirectory $e -Label $Stage -WorkspaceRoot $a.environment.SERVICE_LASSO_WORKSPACE_ROOT -InstanceRegistryPath $a.environment.SERVICE_LASSO_INSTANCE_REGISTRY_PATH -HostPortRegistryPath $a.environment.SERVICE_LASSO_HOST_PORT_REGISTRY_PATH -ExpectedTokenUserSid $sid.Value -ExpectedPhysicalImagePath $node -ExpectedImageSha256 ($tools|Where-Object name -eq node).sha256 -ExpectedCallerImagePath $pwsh -ExpectedCallerImageSha256 ($tools|Where-Object name -eq pwsh).sha256 -RootPreflightPath $pre -RootPreflightSha256 (Get-FileHash $pre).Hash -CompletionPath $completionPath -InvocationId $invocation)
  if($returned.Count -ne 1 -or $returned[0].schema -cne 'issue1598-wrapper-return-v1' -or $returned[0].invocationId -cne $invocation -or $returned[0].completionPath -cne $completionPath){throw 'Missing or ambiguous explicit nested completion'}
  $returnValue=$returned[0]
  $completionHash=(Get-FileHash -LiteralPath $completionPath).Hash
  if($completionHash -ine $returnValue.completionSha256){throw 'Nested completion digest mismatch'}
  $wrapperRecord=Get-Content -LiteralPath $completionPath -Raw|ConvertFrom-Json -DateKind String
  if($wrapperRecord.schema -cne 'issue1598-wrapper-completion-v1' -or $wrapperRecord.invocationId -cne $invocation -or $wrapperRecord.label -cne $Stage -or $wrapperRecord.rootPreflightPath -cne $pre -or $wrapperRecord.rootPreflightSha256 -ine (Get-FileHash -LiteralPath $pre).Hash){throw 'Nested completion binding mismatch'}
  if(($wrapperRecord.outcome|ConvertTo-Json -Compress -Depth 30) -cne ($returnValue.outcome|ConvertTo-Json -Compress -Depth 30)){throw 'Returned and durable nested outcomes differ'}
  $o=$wrapperRecord.outcome
  if($o.status -notin @('success','nonzero','unqualified','exception') -or $o.completionExitCode -isnot [int]){throw 'Invalid typed nested completion'}
  if($o.status -ceq 'success'){
   if($o.completionExitCode -ne 0 -or $o.nativeChildExitCode -ne 0 -or $o.qualified -ne $true -or $o.terminalDurable -ne $true -or $o.observerErrors.Count -ne 0){throw 'Contradictory success completion'}
   $propagatedExitCode=0
  }else{
   if($o.completionExitCode -eq 0){throw 'Failing nested completion returned zero'}
   $propagatedExitCode=$o.completionExitCode
  }
 } catch {$driverFailure=$_.Exception.Message;$propagatedExitCode=1}
 $driverRecord=[ordered]@{schema='issue1598-driver-completion-v1';stage=$Stage;invocationId=$invocation;command=$command;wrapper=@{path=$wrapper;sha256=$WrapperSha256};preflight=@{path=$pre;sha256=(Get-FileHash -LiteralPath $pre).Hash};nestedCompletion=if($wrapperRecord){@{path=$completionPath;sha256=$completionHash;outcome=$wrapperRecord.outcome}}else{$null};driverFailure=$driverFailure;propagatedExitCode=$propagatedExitCode;atUtc=[DateTime]::UtcNow.ToString('o');outerDriverExitObservation='UNOBSERVED_UNTIL_EXTERNAL_READBACK';meaning='Durable driver decision followed by explicit exit; this record does not observe its own outer native exit'}
 return [pscustomobject]$driverRecord
} catch { throw }
}
$propagatedExitCode=1
try {
 try {$record=InvokeQualificationStage}
 catch {$record=[pscustomobject]@{schema='issue1598-driver-completion-v1';stage=$Stage;invocationId=$invocation;nestedCompletion=$null;driverFailure=$_.Exception.Message;propagatedExitCode=1;phase='preflight-or-driver-exception';outerDriverExitObservation='UNOBSERVED_UNTIL_EXTERNAL_READBACK';meaning='Exception observed; no nested or native completion inferred'}}
 if($record.propagatedExitCode -isnot [int]){throw 'Driver returned no typed propagation decision'}
 $propagatedExitCode=$record.propagatedExitCode
 $bytes=[Text.UTF8Encoding]::new($false).GetBytes(($record|ConvertTo-Json -Depth 40)+[Environment]::NewLine)
 $driverStream.Write($bytes);$driverStream.Flush($true)
} catch {$propagatedExitCode=1;[Console]::Error.WriteLine('Driver completion write/binding failed: '+$_.Exception.Message)}
finally {try{$driverStream.Dispose()}catch{$propagatedExitCode=1}}
exit $propagatedExitCode
