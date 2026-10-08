# SPEC-011: Ephemeral app secret files on Linux

Status: Active development. Owner request: 2026-10-08. Issue: #1730.

Service Lasso owns optional plaintext app secret files and passes their paths to
apps. Existing environment-variable secret delivery remains supported. The app
does not own the output directory. The Broker vault and startup recovery state
remain durable; app-owned configuration/data and test-harness cleanup are out of
scope. This is not selection of the #1724 Option B custody proposal.

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
