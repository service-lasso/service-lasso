param(
    [Parameter(Mandatory=$true)]
    [ValidateSet('create-directory', 'verify-directory', 'verify-file', 'prepare-empty-file')]
    [string]$Mode,
    [Parameter(Mandatory=$true)]
    [string]$Target
)
# Disposable ordinary test setup only. No runtime/native authority is issued.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
try {
    if (-not [IO.Path]::IsPathRooted($Target) -or $Target.StartsWith('\\')) {
        throw 'Local absolute path required'
    }
    $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
    $system = [Security.Principal.SecurityIdentifier]::new('S-1-5-18')
    if ($Mode -eq 'create-directory') {
        if ([IO.Directory]::Exists($Target) -or [IO.File]::Exists($Target)) {
            throw 'Private directory already exists'
        }
        $acl = [Security.AccessControl.DirectorySecurity]::new()
        $acl.SetOwner($sid)
        $acl.SetAccessRuleProtection($true, $false)
        $inherit = [Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit'
        foreach ($principal in (@($sid, $system) | Sort-Object Value -Unique)) {
            $rule = [Security.AccessControl.FileSystemAccessRule]::new(
                $principal, [Security.AccessControl.FileSystemRights]::FullControl,
                $inherit, [Security.AccessControl.PropagationFlags]::None,
                [Security.AccessControl.AccessControlType]::Allow)
            [void]$acl.AddAccessRule($rule)
        }
        [void][IO.Directory]::CreateDirectory($Target, $acl)
    }
    $item = Get-Item -LiteralPath $Target -Force -ErrorAction Stop
    $fileMode = $Mode -in @('verify-file', 'prepare-empty-file')
    if ($fileMode -eq [bool]$item.PSIsContainer) {
        throw 'Private object kind mismatch'
    }
    $cursor = $item
    while ($null -ne $cursor) {
        if (($cursor.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw 'Redirected private path'
        }
        if ($cursor -is [IO.FileInfo]) { $cursor = $cursor.Directory }
        else { $cursor = $cursor.Parent }
    }
    if ($Mode -eq 'prepare-empty-file') {
        if ($item.Length -ne 0) { throw 'Private file must be empty before ownership setup' }
        $emptyAcl = $item.GetAccessControl()
        $emptyAcl.SetOwner($sid)
        $item.SetAccessControl($emptyAcl)
    }
    $actual = $item.GetAccessControl()
    $owner = $actual.GetOwner([Security.Principal.SecurityIdentifier]).Value
    if ($owner -ne $sid.Value) { throw 'Private owner mismatch' }
    if (-not $fileMode -and -not $actual.AreAccessRulesProtected) {
        throw 'Private directory inheritance is not protected'
    }
    $rules = @($actual.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]))
    $allowed = @($sid.Value, $system.Value) | Select-Object -Unique
    if ($rules.Count -ne $allowed.Count) { throw 'Unexpected private ACE roster' }
    foreach ($principal in $allowed) {
        $match = @($rules | Where-Object { $_.IdentityReference.Value -eq $principal })
        if ($match.Count -ne 1 -or
            $match[0].AccessControlType -ne [Security.AccessControl.AccessControlType]::Allow -or
            $match[0].FileSystemRights -ne [Security.AccessControl.FileSystemRights]::FullControl) {
            throw 'Unexpected private ACE rights'
        }
        if (-not $fileMode -and
            $match[0].InheritanceFlags -ne [Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit') {
            throw 'Private directory ACE inheritance mismatch'
        }
    }
    [ordered]@{
        platform = 'win32'; policy = 'current-owner-and-system'; ownerSid = $owner
        currentSid = $sid.Value; protected = [bool]$actual.AreAccessRulesProtected
        rules = @($rules | ForEach-Object {
            [ordered]@{sid=$_.IdentityReference.Value; rights=[int64]$_.FileSystemRights;
                type=[string]$_.AccessControlType; inherited=[bool]$_.IsInherited}
        })
        verified = $true
    } | ConvertTo-Json -Depth 5 -Compress
} catch {
    [Console]::Error.WriteLine('Ordinary fixture private path verification failed.')
    exit 1
}
