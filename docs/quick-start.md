---
title: Quick Start
---

# Quick Start

Use this page when you want to clone Service Lasso and run the checked-in baseline services.

## Requirements

- Node.js `>=22`
- npm
- Git
- Network access to GitHub releases

## 1. Clone the Repo

```powershell
git clone https://github.com/service-lasso/service-lasso.git
cd service-lasso
```

## 2. Install and Build

```powershell
npm ci
npm run build
```

## 3. Start Service Lasso

```powershell
node dist/cli.js start --services-root ./services --workspace-root ./workspace --port 18080 --json
```

This starts the Service Lasso API and runs the baseline service set from `services/`.

Keep this terminal open while you test. Stop it later with `Ctrl+C`.

## 4. Open the Useful URLs

| URL | Purpose |
| --- | --- |
| `http://127.0.0.1:18080/api/health` | Service Lasso API health |
| `http://127.0.0.1:18080/api/services` | discovered services and lifecycle state |
| `http://127.0.0.1:17700/` | Service Admin UI |
| `http://127.0.0.1:4010/` | Echo Service UI/API |
| `http://127.0.0.1:19081/dashboard/` | Traefik dashboard |

## 5. Stop Services

Before closing the runtime, stop managed services:

```powershell
Invoke-RestMethod -Method Post http://127.0.0.1:18080/api/runtime/actions/stopAll
```

Then press `Ctrl+C` in the terminal running Service Lasso.

## Reset Local Runtime Data

If you want to run from a clean local workspace again:

```powershell
Remove-Item -Recurse -Force .\workspace
```
