$ErrorActionPreference = "Stop"

function Invoke-NormalHeldExitVerifier([string]$ShellPath, [string]$ShellLabel) {
  $verifierPath = Join-Path $PSScriptRoot "..\scripts\verify-windows-process-inspector.ps1"
  $process = New-Object Diagnostics.Process
  try {
    $process.StartInfo.FileName = $ShellPath
    $process.StartInfo.Arguments = "-NoProfile -NonInteractive -File `"$verifierPath`" -HeldExitFixture"
    $process.StartInfo.UseShellExecute = $false
    $process.StartInfo.CreateNoWindow = $true
    $process.StartInfo.RedirectStandardOutput = $true
    $process.StartInfo.RedirectStandardError = $true
    if (-not $process.Start()) {
      throw "$ShellLabel could not start the normal held-exit verifier."
    }
    if (-not $process.WaitForExit(30000)) {
      $process.Kill()
      [void]$process.WaitForExit(1000)
      throw "$ShellLabel did not finish the normal held-exit verifier within its test bound."
    }
    $stdout = $process.StandardOutput.ReadToEnd()
    $stderr = $process.StandardError.ReadToEnd()
    if ($process.ExitCode -ne 0 -or $stdout -notmatch '"result":"passed"' -or $stderr.Length -ne 0) {
      throw "$ShellLabel failed the normal held-exit verifier."
    }
  } finally {
    $process.Dispose()
  }
}

Invoke-NormalHeldExitVerifier $env:WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe "Windows PowerShell 5"
Invoke-NormalHeldExitVerifier (Get-Command pwsh.exe -ErrorAction Stop).Source "PowerShell"
Write-Output "windows_process_inspector_powershell_compatibility_cases_passed"
