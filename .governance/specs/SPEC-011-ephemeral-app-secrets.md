# SPEC-011: Ephemeral app secret files

- **ESM-11 (#1738):** authenticated workspace-read management exposes Broker
  RAM WebDAV metadata at `operations/webdav`: listener state, RAM usage, active
  grants and paginated filenames, service/workspace ownership, sizes and read
  counters. Only GET is allowed; bounded numeric limit/cursor are forwarded.
  Secret values, capability tokens and URLs remain excluded. Service Admin
  supplies a usage dashboard; Echo supplies an opt-in file consumer example.
  Verify allowlists, permission mapping, query bounds, real Broker IPC and
  positive/negative file consumption without durable secret disclosure.

Status: Active development. Owner request: 2026-10-08. Issues: #1730 (landed), #1732.

Service Lasso owns declared plaintext app secret files and passes their paths to
apps. Existing environment-variable secret delivery remains supported. The app
does not own the output directory. The Broker vault and startup recovery state
remain durable; app-owned configuration/data and test-harness cleanup are out of
scope. This is not selection of the #1724 Option B custody proposal.

Broker RAM WebDAV is the default provider (ESM-7..10 below). The original Linux
requirements ESM-1..6 apply to the explicitly selected tmpfs alternative only.

- **ESM-1:** `config.files[]` and `config.templates[]` may declare boolean
  `ephemeral: true`. Their relative output paths resolve beneath a Core-owned
  per-service directory, derived from service identity and resolved service root,
  under `SERVICE_LASSO_SECRETS_ROOT` (default `/run/service-lasso/secrets`).
  `${SERVICE_LASSO_SECRETS_DIR}` supplies that directory to declared app env
  variables, such as `DB_PASSWORD_FILE`. This Linux-only profile rejects use on
  other platforms and in install materialization. Ordinary artifacts are unchanged.
- **ESM-2:** Before every fresh managed launch, recreate every declared ephemeral
  output with the launch's current scoped Broker resolution, even with persisted
  installed/configured flags or an empty secrets directory. Do not rewrite files
  for an already-running/adopted process. Do not generate/rotate Broker values
  merely because an output file disappeared.
- **ESM-3:** Unresolved/denied content or path selectors, unavailable required
  imports, unsafe output paths, missing mount or non-tmpfs storage prevent launch.
  Core validates a private, current-user-owned secrets root and output directories,
  rejects symlinks/aliased files, and publishes regular files with mode 0600.
  Parent directories use 0700. The deployment administrator is trusted to maintain
  mount/ancestor integrity; no hostile same-UID writer exclusion claim is made.
- **ESM-4:** Ephemeral output contents never enter persistent materialization
  preimages, config drift/snapshots or lifecycle metadata. Only ordinary generated
  artifact metadata is persisted. Current env delivery remains unchanged.
- **ESM-5:** Deployment provisions a private, bounded tmpfs with `noswap`, orders
  it before Core starts and exposes Core's paths read-only into containers when
  needed. Document UID compatibility, empty-mount restart, memory limits and
  continued durable Broker/recovery storage. Core verifies tmpfs; deployment owns
  noswap, mounts, namespace mapping and app access policy.
- **ESM-6:** Verify actual child consumption before/after deleting the disposable
  output directory, current Broker values on replacement launch, env compatibility,
  failure before spawn for unresolved inputs/disk storage, manifest validation,
  private permissions and redirected/aliased targets on native Ubuntu. Record
  build limitations independently; no full-suite/release/deployment claim.

Verification maps ESM-1/3 to discovery and file safety checks; ESM-2/4 to real
managed child launch and transaction-hook/privacy assertions; ESM-5 to deployment
examples and official Linux/systemd docs; ESM-6 to recorded exact-source checks.

## Default RAM WebDAV delivery (issue #1732)

Owner approved default Broker-owned RAM WebDAV for all extracted secret files.
ESM-7: WebDAV is the default on every platform. Core sends freshly rendered
outputs over authenticated Broker IPC with a distinct scoped resolve lease.
Broker returns a fresh per-instance capability and loopback endpoint. Core passes
its URL/Windows UNC directory through SERVICE_LASSO_SECRETS_DIR before spawn.
No plaintext file or token enters lifecycle snapshots, drift or durable state.
ESM-8: Broker enforces RAM-only, strict 127.0.0.1, read-only grant isolation,
256-bit token rotation and bounded requests/storage. Core revokes the exact grant
on stop, ordinary exit or failed launch; replacement cannot be revoked by an old
exit callback. No fallback to disk or tmpfs when Broker is unavailable.
ESM-9: Linux tmpfs remains explicitly selectable with
SERVICE_LASSO_SECRET_FILES_TRANSPORT=tmpfs. Existing ESM-1/3/5 Linux mount rules
apply only to that alternative. Default WebDAV needs no administrator mount.
ESM-10: Preserve environment-secret delivery; verify managed child HTTP reads,
replacement launch and revocation, native Broker HTTP isolation/denial/bounds,
and safe errors/state. URL clients and native Windows WebClient are distinct
consumption mechanisms; Linux DAV URLs are not POSIX filesystem paths. App
behaviour after receiving secrets and harness cleanup remain outside acceptance.
