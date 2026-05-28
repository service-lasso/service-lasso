# Template Upgrade Compatibility

`service-lasso template check-upgrade <targetServicesRoot>` compares an app or
template service inventory with the current core provider inventory.

The check is read-only. It does not write manifests, runtime state, logs,
lockfiles, or provider artifacts. The report includes service ids, provider
source repos, release tags, versions, platform keys, and upgrade hints only; it
does not include environment values, provider credentials, tokens, passwords,
cookies, private keys, or broker secret material.

Use JSON output for automation:

```powershell
service-lasso template check-upgrade C:\path\to\app\services --json
```

Use `--core-services-root <path>` when comparing against a checked-out core
inventory other than `./services`:

```powershell
service-lasso template check-upgrade C:\path\to\app\services --core-services-root C:\projects\service-lasso\service-lasso\services --json
```

The top-level status is:

- `compatible`: no findings.
- `upgrade-advised`: warnings only, such as missing optional providers or stale
  provider pins.
- `blocked`: at least one error, such as a required provider that is missing or
  a provider manifest that no longer matches the core provider role/source
  contract.

Findings are machine-readable by `kind`, `severity`, and `serviceId`.
