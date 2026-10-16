# Fixed trusted witness invocation only; supplied target source is never invoked.
$global:Core1562F25Infrastructure = @{ Recorded=$false; Operation=$null; Original=$null; Originals=[Collections.Generic.List[object]]::new() }
function Same-F25Original([System.Management.Automation.ErrorRecord]$left, [System.Management.Automation.ErrorRecord]$right) {
    if ([object]::ReferenceEquals($left,$right)) { return $true }
    $leftException=$left.Exception; $rightException=$right.Exception
    return $null -ne $leftException -and [object]::ReferenceEquals($leftException,$rightException)
}
function Fail-F25Infrastructure($operation, [System.Management.Automation.ErrorRecord]$original) {
    $owner=$global:Core1562F25Infrastructure
    $owner.Originals.Add($original)
    if (-not $owner.Recorded) { $owner.Original=$original; $owner.Operation=$operation; $owner.Recorded=$true }
    elseif (-not (Same-F25Original $owner.Original $original)) { $owner.Operation='unavailable' }
    try { [Console]::Out.Write('F25I1|'+$owner.Operation+"`n"); [Console]::Out.Flush() }
    catch { $owner.Originals.Add($_) }
    exit 3
}
try {
    $ErrorActionPreference='Stop'
    $ProgressPreference='SilentlyContinue'
    $PSModuleAutoLoadingPreference='None'
    $fixedWitness=[IO.Path]::Combine($PSScriptRoot,'core1562-powershell-retention-ast.ps1')
} catch { Fail-F25Infrastructure 'bootstrap_setup' $_ }
try {
    $global:LASTEXITCODE=$null
    & $fixedWitness
    $forwarded=$global:LASTEXITCODE
} catch { Fail-F25Infrastructure 'witness_invocation' $_ }
try {
    if ($forwarded -isnot [int] -or $forwarded -notin @(0,2,3)) { throw 'Fixed witness exit unavailable' }
} catch { Fail-F25Infrastructure 'witness_exit' $_ }
exit $forwarded
