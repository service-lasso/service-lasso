# Config Apply Preflight

`service-lasso config-apply preflight` is a dry-run-only operator gate for applying service configuration.

The preflight reports:

- lifecycle and policy gates that would allow, warn, or block config apply
- whether a running service may need restart after materialized config changes
- unsupported manifest fields for this bounded slice
- secret references used by config materialization by ref name and status only
- expected operator impact without writing manifests, state, logs, config files, or runtime data

The report does not include raw secret values, provider credentials, tokens, cookies, private keys, environment values, or generated file content.

```bash
service-lasso config-apply preflight [serviceId] --services-root ./services --workspace-root ./workspace --json
```

The command is non-mutating. A blocked report means operators should resolve the reported policy gate before any later apply implementation is allowed to mutate configuration.
