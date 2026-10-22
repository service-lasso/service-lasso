import { execFile } from "node:child_process";
import path from "node:path";

// Names only (no paths, ids or command lines) of processes whose executable
// image lives under an owned temp root. Used to explain a Windows EBUSY cleanup.
export async function windowsTempRootHolderNames(root) {
  if (process.platform !== "win32" || !process.env.SystemRoot) return [];
  const powershell = path.join(process.env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  const script = "$r=$env:SL_HOLDER_ROOT.TrimEnd('\\')+'\\'; Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($r,[StringComparison]::OrdinalIgnoreCase) } | ForEach-Object { [IO.Path]::GetFileName($_.ExecutablePath) }";
  return await new Promise((resolve) => {
    execFile(powershell, ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script], {
      env: { ...process.env, SL_HOLDER_ROOT: root },
      timeout: 30_000,
      windowsHide: true,
    }, (error, stdout) => {
      if (error) return resolve(["unavailable"]);
      const names = String(stdout).split(/\r?\n/u).map((line) => line.trim())
        .filter((line) => /^[A-Za-z0-9._-]{1,80}$/u.test(line));
      resolve([...new Set(names)].sort());
    });
  });
}
