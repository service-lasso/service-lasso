# Service Lasso isolated WSL runner pool

The repository can provision one dedicated WSL 2 distribution per self-hosted
GitHub Actions runner. Every member has its own bounded VHDX, Docker daemon,
Linux account, workspace, cleanup timer, registration, and Windows autostart
task.

The installer does not alter workflow `runs-on` selectors. Provision and verify
capacity before selecting the new labels in a separate reviewed change.

## Prerequisites

- Current WSL 2 (`wsl --update`).
- PowerShell 5.1 or newer.
- GitHub CLI authenticated with repository runner-administration access:
  `gh auth status`.
- Physical drive capacity for each 60 GB virtual ceiling plus 15 GB Windows
  headroom. The VHD ceiling is not preallocated.

Use a SecureString prompt for the Linux password. Do not put passwords or
registration tokens in command history; the default flow asks `gh` for a fresh
short-lived registration token for every new member.

## Review a three-runner plan

```powershell
$password = Read-Host "Linux runner password" -AsSecureString
.\scripts\github-actions-runner\install-wsl-runner.ps1 `
  -LinuxPassword $password `
  -RunnerCount 3 `
  -WhatIf
```

| Member | WSL distribution | VHD location | Linux user | Unique label |
| --- | --- | --- | --- | --- |
| 1 | `service-lasso` | `C:\WSL\service-lasso` | `service-lasso` | base labels |
| 2 | `service-lasso-02` | `C:\WSL\service-lasso-02` | `service-lasso-02` | `service-lasso-runner-02` |
| 3 | `service-lasso-03` | `C:\WSL\service-lasso-03` | `service-lasso-03` | `service-lasso-runner-03` |

Use `-InstallLocation D:\WSL\service-lasso` to place the pool on another drive.

## Create or scale the pool

```powershell
$password = Read-Host "Linux runner password" -AsSecureString
.\scripts\github-actions-runner\install-wsl-runner.ps1 `
  -LinuxPassword $password `
  -RunnerCount 3
```

`RunnerCount` is total desired capacity. Repeating the command skips members
that already have an Actions runner systemd service and creates only missing
members. Each new member receives a fresh single-use token from `gh`.

The distro includes Docker Engine with `overlay2` and bounded `json-file` logs,
Node.js 22, PowerShell, and official GitHub Actions runner dependencies.

## Inspect status and storage

```powershell
wsl --list --verbose
wsl -d service-lasso -- systemctl status 'actions.runner.*'
wsl -d service-lasso -- docker info
wsl -d service-lasso -- node --version
wsl -d service-lasso -- systemctl list-timers service-lasso-runner-reaper.timer
Get-ScheduledTask -TaskName "WSL Runner Autostart - service-lasso*"
```

Read-only storage checks:

```powershell
wsl -d service-lasso -- df -h /
wsl -d service-lasso -- docker system df -v
wsl -d service-lasso -- sudo du -xhd1 /var /home 2>/dev/null
wsl -d service-lasso -- journalctl --disk-usage
```

Job hooks lock maintenance, mark active jobs, remove completed workspaces, and
prune unused Docker resources. The recurring reaper also checks
`Runner.Worker`, limits journal/cache growth, and runs `fstrim /` at most daily.

Run the idle-aware reaper immediately:

```powershell
wsl -d service-lasso -- sudo systemctl start service-lasso-runner-reaper.service
wsl -d service-lasso -- sudo journalctl -u service-lasso-runner-reaper.service -n 100 --no-pager
```

## Remove a pool member

First confirm that the member is idle and remove it from GitHub repository
runner settings. Then remove only that dedicated distribution:

```powershell
wsl --terminate service-lasso-03
wsl --unregister service-lasso-03
Unregister-ScheduledTask -TaskName "WSL Runner Autostart - service-lasso-03" -Confirm:$false
```

`wsl --unregister` permanently deletes that distribution and its VHDX. Never
run it against a general-purpose distro.

## Reclaim Windows VHDX space

Deleting Linux files does not immediately reduce the host VHDX file. Once every
runner is idle:

1. Run the reaper and `fstrim /` inside each target distro.
2. Run `wsl --shutdown`.
3. Use the reviewed `wsl-compact.ps1` procedure in the Windows dev-setup repo to
   compact the unmounted VHDX files.

Never compact a VHDX while its distribution or another process is using it.
