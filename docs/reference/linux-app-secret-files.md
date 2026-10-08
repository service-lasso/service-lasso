# Linux app secret files

Service Lasso normally supplies resolved Secrets Broker values through a fresh
process environment on every launch. Keep using that mechanism when the app
supports it. For an app that expects a file, Core can create a disposable file
in its own secrets directory and pass its absolute path through a declared
environment variable. The app must actually support that variable; `_FILE` is
a convention, not automatic conversion by Core.

## Service manifest

```json
{
  "broker": {
    "imports": [
      { "namespace": "shared/database", "ref": "database.PASSWORD", "required": true }
    ]
  },
  "config": {
    "files": [
      { "path": "db-password", "content": "${database.PASSWORD}", "ephemeral": true }
    ],
    "templates": [
      { "source": "templates/credentials.conf", "target": "credentials.conf", "ephemeral": true }
    ]
  },
  "env": {
    "DB_PASSWORD_FILE": "${SERVICE_LASSO_SECRETS_DIR}/db-password",
    "APP_CREDENTIALS_FILE": "${SERVICE_LASSO_SECRETS_DIR}/credentials.conf"
  }
}
```

This is a fragment to add to the app's existing manifest. Declare every Broker
ref used in template contents in `broker.imports` as required. Keep template
sources secret-free in the service package. Literal file contents are written
exactly as rendered; Core does not add a newline.

`ephemeral: true` applies only to config files/templates on Linux. Its relative
output path is beneath a Core-owned directory, **not** the app's service root.
Core derives the directory name from the service ID and resolved service root,
so separate folder instances do not share secret files. Use the supplied
`${SERVICE_LASSO_SECRETS_DIR}` selector rather than constructing the name.
Do not override that reserved variable in service/global environment settings.

Install/config actions persist ordinary configuration and mark the service
configured. Ephemeral outputs are prepared immediately before a fresh process
launch, including restart and automatic restart. Core fetches current Broker
values, recreates missing directories/files, and replaces existing outputs.
An adopted or already-running process keeps its existing files. Clearing a
directory is not a request to regenerate the secret in the Broker vault.

## Deploy the secrets filesystem

Provision a dedicated Linux service account, for example `service-lasso`, and a
private, bounded tmpfs before starting Core. Example commands for an operator to
adapt and run during deployment (these are not run by Core):

```sh
sudo install -d -o root -g root -m 0755 /run/service-lasso
sudo install -d -o service-lasso -g service-lasso -m 0700 /run/service-lasso/secrets
sudo mount -t tmpfs \
  -o size=16M,mode=0700,uid="$(id -u service-lasso)",gid="$(id -g service-lasso)",noswap,nodev,nosuid,noexec \
  tmpfs /run/service-lasso/secrets
findmnt -T /run/service-lasso/secrets -o TARGET,FSTYPE,OPTIONS
```

`noswap` requires a supporting kernel (Linux 6.4 or newer). Do not silently
remove it if the kernel rejects it: upgrade the kernel or explicitly assess
the deployment's swap policy. Core checks that the configured root and output
directories really use tmpfs, are owned by its UID, have no group/other access,
and have no symlink redirects. It does not mount filesystems or verify the
`noswap` option. Mount and swap policy belong to deployment.

For boot persistence, use a systemd mount unit named
`run-service\x2dlasso-secrets.mount` (confirm with
`systemd-escape --path --suffix=mount /run/service-lasso/secrets`):

```ini
[Unit]
Description=Service Lasso disposable app secrets

[Mount]
What=tmpfs
Where=/run/service-lasso/secrets
Type=tmpfs
Options=size=16M,mode=0700,uid=1001,gid=1001,noswap,nodev,nosuid,noexec

[Install]
WantedBy=multi-user.target
```

Replace `1001` with the actual service account UID/GID. Order the Core systemd
service after this mount and require it:

```ini
[Unit]
RequiresMountsFor=/run/service-lasso/secrets

[Service]
User=service-lasso
Group=service-lasso
Environment=SERVICE_LASSO_SECRETS_ROOT=/run/service-lasso/secrets
```

The root must already exist on tmpfs; Core never falls back to creating it on
disk. A custom `SERVICE_LASSO_SECRETS_ROOT` must be absolute and private. Core
creates per-service/output directories with mode 0700 and files with mode 0600,
rejecting linked/aliased targets. Use a dedicated runtime UID: this does not
isolate mutually hostile apps that share the same UID. Direct apps must run as
an identity allowed to read these files; do not solve access by making the
secrets world-readable.

For containers, expose the appropriate Core directory read-only in the app's
mount namespace, with matching UID access and a path matching its `_FILE` env
value. Mount namespace mapping is deployment/provider configuration; setting an
environment variable alone does not make a host path accessible in a container.
Do not use secret paths as executables or guarded command-line input artifacts.

## Restart and storage boundaries

The mount begins empty after reboot or replacement. With Broker available and
unlocked, starting the app recreates declared secret files before spawning it,
even when persisted lifecycle state says configured. Missing/denied refs,
unresolved selectors, insufficient tmpfs space, redirected paths or an absent
mount block launch without logging plaintext. Restore the prerequisite and
retry the normal start.

Keep the encrypted Broker vault, workspace recovery journal, app data and
ordinary durable configuration on their intended persistent storage. Ephemeral
plaintext is excluded from Core transaction preimages, config drift/snapshots
and lifecycle artifact lists. Files remain for the running app and may remain
until replacement or mount destruction; Core does not promise wiping on process
exit. A Core process restart alone does not destroy tmpfs. Disappearance on
unmount/reboot is not protection against a privileged administrator, app-created
copies, logs, dumps or a compromised consuming app. Those app/deployment policies
remain outside this feature.

References: [Linux tmpfs documentation](https://docs.kernel.org/6.5/filesystems/tmpfs.html),
[systemd mount documentation](https://www.freedesktop.org/software/systemd/man/latest/systemd.mount.html),
[startup Broker resolution](startup-broker-resolution.md). Governed contract:
`SPEC-011 ESM-1..6`, issue #1730.

For the separately proposed Windows/local UNC alternative, see the
[RAM WebDAV security review](ram-webdav-secret-files-review.md). Its server-side
memory support does not prove Windows client access leaves no disk copies.
