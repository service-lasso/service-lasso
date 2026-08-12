# Requires: Windows PowerShell or PowerShell 7 running as Administrator.
# Adds/removes narrow inbound firewall allow rules for local Service Lasso dev/test ports.
#
# Usage from repo root:
#   pwsh -ExecutionPolicy Bypass -File .\scripts\windows\allow-service-lasso-firewall.ps1
#
# Rollback:
#   pwsh -ExecutionPolicy Bypass -File .\scripts\windows\allow-service-lasso-firewall.ps1 -Remove

[CmdletBinding()]
param(
  [string] $ServiceLassoPortRange = "17880-17980",
  [string] $FrontendDevPortRange = "5173-5273",
  [ValidateSet("Domain", "Private", "Public", "Any")]
  [string[]] $Profile = @("Domain", "Private"),
  [switch] $IncludeFrontendDevRange,
  [switch] $Remove
)

$ErrorActionPreference = "Stop"

function Assert-Administrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = [Security.Principal.WindowsPrincipal]::new($identity)
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "Run this script from an elevated Administrator PowerShell window."
  }
}

function Upsert-FirewallRule {
  param(
    [Parameter(Mandatory)] [string] $Name,
    [Parameter(Mandatory)] [string] $DisplayName,
    [Parameter(Mandatory)] [string] $PortRange,
    [Parameter(Mandatory)] [string[]] $RuleProfile
  )

  $existing = Get-NetFirewallRule -Name $Name -ErrorAction SilentlyContinue
  if ($existing) {
    Set-NetFirewallRule -Name $Name -Enabled True -Direction Inbound -Action Allow -Profile $RuleProfile | Out-Null
    Set-NetFirewallPortFilter -AssociatedNetFirewallRule $existing -Protocol TCP -LocalPort $PortRange | Out-Null
    Write-Host "Updated firewall rule: $DisplayName ($PortRange/TCP; profiles: $($RuleProfile -join ', '))"
    return
  }

  New-NetFirewallRule `
    -Name $Name `
    -DisplayName $DisplayName `
    -Description "Allows local Service Lasso development/test listeners without repeated Windows Defender Firewall prompts." `
    -Direction Inbound `
    -Action Allow `
    -Protocol TCP `
    -LocalPort $PortRange `
    -Profile $RuleProfile `
    -Enabled True | Out-Null

  Write-Host "Created firewall rule: $DisplayName ($PortRange/TCP; profiles: $($RuleProfile -join ', '))"
}

function Remove-FirewallRuleIfPresent {
  param(
    [Parameter(Mandatory)] [string] $Name,
    [Parameter(Mandatory)] [string] $DisplayName
  )

  $existing = Get-NetFirewallRule -Name $Name -ErrorAction SilentlyContinue
  if ($existing) {
    Remove-NetFirewallRule -Name $Name
    Write-Host "Removed firewall rule: $DisplayName"
  } else {
    Write-Host "Firewall rule already absent: $DisplayName"
  }
}

Assert-Administrator

$profileValue = if ($Profile -contains "Any") { @("Any") } else { $Profile }

$rules = @(
  [pscustomobject]@{
    Name = "ServiceLasso-Local-Dev-Test-TCP"
    DisplayName = "Service Lasso local dev/test ports"
    PortRange = $ServiceLassoPortRange
  }
)

if ($IncludeFrontendDevRange) {
  $rules += [pscustomobject]@{
    Name = "ServiceLasso-Frontend-Dev-TCP"
    DisplayName = "Service Lasso frontend dev ports"
    PortRange = $FrontendDevPortRange
  }
}

foreach ($rule in $rules) {
  if ($Remove) {
    Remove-FirewallRuleIfPresent -Name $rule.Name -DisplayName $rule.DisplayName
  } else {
    Upsert-FirewallRule -Name $rule.Name -DisplayName $rule.DisplayName -PortRange $rule.PortRange -RuleProfile $profileValue
  }
}

Write-Host "Done."
