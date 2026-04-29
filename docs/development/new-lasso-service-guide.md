# Create a New Lasso Service

This is the canonical handoff for creating a new release-backed [`service-lasso/lasso-*`](https://github.com/service-lasso?q=lasso-&type=repositories) service repo.

For the recommended step-by-step authoring order, start with [Service Authoring Overview](../service-authoring/overview.md). This page is the detailed implementation handoff for step 3, creating the release-backed service repo.

Use this guide when an agent or contributor needs to create a service from scratch, update an existing service repo, or decide how a consuming app should pin a service manifest.

## Outcome

A complete service delivery produces:

- a dedicated GitHub repo in the [`service-lasso`](https://github.com/service-lasso) org, such as `lasso-foo`
- a released `service.json`
- platform archives attached to a timestamped GitHub release
- `SHA256SUMS.txt` when practical
- local and CI validation that proves the archive can be installed and, where applicable, started by Service Lasso
- a pinned `services/<service-id>/service.json` committed into each consuming app or into core when it is a core baseline service

## Naming Rules

Repo names and service IDs are related, but they are not the same field.

| Thing | Rule | Example |
| --- | --- | --- |
| GitHub repo | [`service-lasso/lasso-<name>`](https://github.com/service-lasso?q=lasso-&type=repositories) | [`service-lasso/lasso-nginx`](https://github.com/service-lasso/lasso-nginx) |
| Core-owned service ID | `@<name>` | `@nginx` |
| Non-core app/service ID | no `@` prefix unless the app owns that convention | `echo-service` |
| Service folder | must match the service ID | `services/@nginx/service.json` |
| Release tag | `yyyy.m.d-<shortsha>` from protected branch release workflow | `2026.4.28-b9cc74a` |

Use the `@` prefix only for core-owned Service Lasso services and providers such as `@node`, `@python`, `@java`, `@localcert`, `@nginx`, `@traefik`, and `@serviceadmin`.

Do not use `@` for ordinary app services or test harnesses. `echo-service` is intentionally unprefixed.

## Service Types

Choose the closest pattern before writing files.

| Type | When to use | Manifest shape |
| --- | --- | --- |
| Provider | The service supplies a runtime/tool to other services and should not run as a daemon. | `role: "provider"` plus `artifact` and `globalenv` |
| Managed binary | The service owns and runs its executable. | `artifact`, platform `command`, `ports`, `healthcheck` |
| Provider-backed app | The service runs through another provider such as `@node`, `@python`, or `@java`. | `execservice`, `executable`, `args`, `depend_on` |
| Optional app service | Consumers opt in by copying its released manifest. | `enabled: false` when unsafe to start without app config |

## Required Repo Shape

Every `lasso-*` service repo should start with this shape:

```text
lasso-foo/
  .github/
    workflows/
      release.yml
  scripts/
    package.mjs
    verify-release.mjs
  service.json
  README.md
  LICENSE
  package.json
```

Add service-owned runtime source or assets only when the service repo builds its own wrapper. Provider repos often package upstream archives instead.

## `service.json` Minimum Contract

Every released service manifest must include:

- `id`
- `name`
- `description`
- `version`
- `enabled`
- `artifact.kind: "archive"`
- `artifact.source.type: "github-release"`
- `artifact.source.repo`
- `artifact.source.tag`
- `artifact.platforms.<platform>.assetName`
- `artifact.platforms.<platform>.archiveType`
- `artifact.platforms.<platform>.command` when the archive exposes an executable

Managed services should also declare:

- `ports`
- `urls`
- `healthcheck`
- `env` and `globalenv` where operator or dependent services need resolved values
- `install.files` or `config.files` when Service Lasso must materialize runtime config
- `depend_on` when startup requires another service first

Provider services should declare:

- `role: "provider"`
- `globalenv` entries that expose installed tool paths through `${SERVICE_ARTIFACT_COMMAND}` and `${SERVICE_ARTIFACT_ROOT}`
- a cheap version/probe command in platform `args`

## Managed Binary Example

```json
{
  "id": "@nginx",
  "name": "NGINX",
  "description": "Release-backed NGINX Open Source service.",
  "version": "1.30.0",
  "enabled": true,
  "ports": {
    "http": 18080
  },
  "artifact": {
    "kind": "archive",
    "source": {
      "type": "github-release",
      "repo": "service-lasso/lasso-nginx",
      "tag": "2026.4.27-712c75f"
    },
    "platforms": {
      "win32": {
        "assetName": "lasso-nginx-1.30.0-win32.zip",
        "archiveType": "zip",
        "command": ".\\nginx.exe"
      },
      "linux": {
        "assetName": "lasso-nginx-1.30.0-linux.tar.gz",
        "archiveType": "tar.gz",
        "command": "./sbin/nginx"
      }
    }
  },
  "healthcheck": {
    "type": "http",
    "url": "http://127.0.0.1:${HTTP_PORT}/health",
    "expected_status": 200
  }
}
```

## Provider Example

```json
{
  "id": "@node",
  "name": "Node Runtime",
  "description": "Release-backed Node.js runtime provider.",
  "version": "v24.15.0",
  "role": "provider",
  "enabled": true,
  "globalenv": {
    "NODE": "${SERVICE_ARTIFACT_COMMAND}",
    "NODE_HOME": "${SERVICE_ARTIFACT_ROOT}"
  },
  "artifact": {
    "kind": "archive",
    "source": {
      "type": "github-release",
      "repo": "service-lasso/lasso-node",
      "tag": "2026.4.27-eca215a"
    },
    "platforms": {
      "win32": {
        "assetName": "lasso-node-v24.15.0-win32.zip",
        "archiveType": "zip",
        "command": ".\\node.exe",
        "args": ["--version"]
      }
    }
  }
}
```

## Artifact Naming

Artifact names must be predictable and must include the packaged upstream version when the service wraps third-party software.

Use:

- `lasso-node-v24.15.0-win32.zip`
- `lasso-java-17.0.18+8-linux.tar.gz`
- `lasso-python-3.11.5-win32.zip`
- `lasso-nginx-1.30.0-darwin.tar.gz`

Do not use vague names such as:

- `node-win32.zip`
- `lasso-node-24-win32.zip`
- `latest.zip`

When the service is your own app and the upstream/tool version is the service release itself, use a stable service asset name such as `echo-service-win32.zip` and rely on the GitHub release tag for the package release version.

## Release Workflow Rules

Service repos should release on protected-branch pushes, not manual tags.

Release tags must use:

```text
yyyy.m.d-<shortsha>
```

Each release should attach:

- one archive per supported platform
- the exact released `service.json`
- `SHA256SUMS.txt` when practical

If a platform is not supported, omit that platform from `artifact.platforms` and document the unsupported state in the repo README.

## Local Validation

Before opening the service repo PR, prove:

1. The package script creates every documented archive.
2. The archive contains the command path declared in `service.json`.
3. The command runs with the declared version/probe args.
4. `service.json` points at the intended repo, release tag, artifact names, and archive types.
5. `npm test` or the repo's equivalent validation passes.

For a managed service, also prove:

1. Service Lasso can install/acquire the archive.
2. Service Lasso can config/start/stop the service.
3. The declared healthcheck becomes healthy.
4. Logs/state/network surfaces are visible when the service claims them.

## Core Integration

Only update core `services/` after the service repo has a verified release.

Core integration steps:

1. Copy or adapt the released manifest into `services/<service-id>/service.json`.
2. Pin `artifact.source.tag` to the verified release tag.
3. Keep `version` as the service or upstream runtime version, not the Service Lasso release tag, unless they are intentionally the same.
4. Add or update manifest discovery tests if the service is part of core inventory.
5. Add live verifier coverage when the service is part of the baseline or a critical provider path.
6. Run `npm run build`.
7. Run targeted tests for manifest/provider/lifecycle behavior.
8. Run `npm run verify:baseline-start` when the service is part of the default baseline.
9. Run `npm test` before claiming the core change is complete.

Default baseline services currently are:

- `@localcert`
- `@nginx`
- `@traefik`
- `@node`
- `echo-service`
- `@serviceadmin`

Optional provider/service manifests such as `@python`, `@java`, `zitadel`, and `dagu` should not be added to default baseline start unless the app has the needed config and dependencies.

## Consumer Integration

Apps that use Service Lasso own their `services/` folder.

To add a service to an app:

1. Create `services/<service-id>/service.json`.
2. Copy the released manifest from the service repo.
3. Keep `artifact.source.repo`, `artifact.source.tag`, and platform `assetName` values pinned.
4. Adjust app-owned ports, env, URLs, and dependencies as needed.
5. Run the app's source/bootstrap artifact verification.
6. Run bundled/no-download artifact verification if the app publishes bundled outputs.

Bundled means Service Lasso packaging has already acquired the configured archives into the app artifact so the user does not download them on first start.

## Documentation Requirements

Each new service repo README must state:

- service ID
- repo/release relationship
- supported platforms
- artifact names
- upstream project and upstream version when applicable
- required app-owned environment variables
- ports and healthchecks
- install/config/start behavior
- validation commands
- known unsupported platforms or deferred behavior

Update core docs when the rule is general. Keep service-specific quirks in the service repo.

## Agent Checklist

Use this checklist before handing off:

- GitHub issue exists with spec binding and acceptance criteria.
- Branch starts from the correct target branch.
- Repo name follows the [`service-lasso/lasso-<name>`](https://github.com/service-lasso?q=lasso-&type=repositories) pattern.
- Service ID follows the prefix rule.
- `service.json` has artifact download metadata in the manifest itself.
- Release workflow creates `yyyy.m.d-<shortsha>` releases from protected-branch pushes.
- Artifact names include exact upstream versions when applicable.
- Released archive paths match platform `command` values.
- Local verification passes.
- CI release workflow passes.
- Core/reference manifests are updated only after release proof exists.
- PR is merged into the correct target branch.
- Work branch is archived as `archived/<issue-and-slug>`.
- Local checkout returns to the clean target branch.

## Related Docs

- [Service Authoring Overview](../service-authoring/overview.md)
- [service.json Reference](../reference/service-json-reference.md)
