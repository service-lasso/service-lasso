# Readiness Gate CLI

`service-lasso readiness gate --json` emits a non-mutating readiness report for local automation.

The report includes:

- baseline start possibility for the selected `servicesRoot`
- required provider manifests and any missing providers
- unresolved blockers and warning-only partial states
- current git branch/status hints
- one recommended next action

The command does not render secret values, provider credentials, tokens, private keys, cookies, passwords, raw environment values, or recovery material. Paths, service ids, provider ids, manifest metadata, and git status counts are safe to include in logs and support bundles.

Example:

```bash
service-lasso readiness gate --services-root ./services --workspace-root ./workspace --json
```

Top-level statuses:

- `ready`: no blockers or warnings were found.
- `partial`: baseline start is possible, but the workspace has warning-only conditions such as disabled service manifests or a dirty git tree.
- `blocked`: baseline start cannot proceed until reported blockers are fixed.
