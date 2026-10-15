param(
  [Parameter(Mandatory)][string]$ServicesRoot,
  [Parameter(Mandatory)][string]$WorkspaceRoot,
  [Parameter(Mandatory)][string]$ApiOrigin
)
$ErrorActionPreference = 'Stop'
$taskCore = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$taskPassword = Read-Host 'Private initial identity admin password (save it in your password manager)' -AsSecureString
$taskPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($taskPassword)
try {
  $taskPayload = @{ bootstrapPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($taskPointer) } | ConvertTo-Json -Compress
  $taskStart = [Diagnostics.ProcessStartInfo]::new()
  $taskStart.FileName = (Get-Command node -CommandType Application | Select-Object -First 1).Source
  $taskStart.UseShellExecute = $false
  $taskStart.CreateNoWindow = $true
  $taskStart.RedirectStandardInput = $true
  foreach ($taskArgument in @((Join-Path $PSScriptRoot 'provision-identity.mjs'), $taskCore, (Resolve-Path $ServicesRoot).Path, (Resolve-Path $WorkspaceRoot).Path, $ApiOrigin)) { $taskStart.ArgumentList.Add($taskArgument) }
  $taskProcess = [Diagnostics.Process]::Start($taskStart)
  $taskProcess.StandardInput.WriteLine($taskPayload)
  $taskProcess.StandardInput.Close()
  $taskProcess.WaitForExit()
  if ($taskProcess.ExitCode -ne 0) { throw 'Identity secret provisioning failed; existing state retained.' }
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($taskPointer)
  $taskPayload = $null
  $taskPassword.Dispose()
}
