# Installed operator clients (#1994)

Development prerequisite to #1992 and SPEC-002 AC-4CG.1977. The operator
clients are release-backed service providers. Each owning repository maintains
its root service manifest and publishes the stamped manifest and native
archives. Core imports the exact published manifests through its existing
service catalog model. This supersedes the source-build distribution decision
when those exact production inputs are admitted.

- AC-1994-1: Core CLI `service-lasso cli` and `service-lasso tui` run the
  installed, configured, release-backed `@cli` and `@tui` executable respectively.
  They require an exact GitHub release tag, the matching native architecture
  artifact, a manifest-pinned SHA-256, and matching install receipt. They
  decline absent, stale, unverified and unsupported artifacts. They do not
  acquire source, compile, assume a language toolchain or run a daemon.
- AC-1994-2: Invocation uses the caller's working directory and inherited
  terminal/streams, preserves literal client arguments and the child exit
  status, and does not use a shell. The executable resolves inside the
  provider's acquired artifact root. Release files, receipts and credentials
  are not emitted by the launcher.
- AC-1994-3: An implicit runtime target is the live owned Core loopback
  generation selected by the same services/workspace roots. Explicit client
  URL/profile/environment configuration stays authoritative. An implicit TUI
  starts its existing connection screen when Core cannot select a local
  generation. Offline CLI commands remain usable. No secret is transferred
  except the existing caller-scoped credential environment inherited by the
  actual client. Existing authentication and remote target validation apply.
- AC-1994-4: Verify installed native-command forwarding with a manifest-backed
  release archive fixture and a real disposable Core, negative receipt/path/host
  cases, and actual PTY streaming. Real @tui/@cli binaries, default baseline
  import/preparation, removal of npm source-build launchers and the combined
  postmerge consumer run remain gated by the exact approved published
  inputs in #1992. No temporary artifact or movable tag becomes a catalog pin.

- AC-1994-5 (#1999): Core checks in discoverable, disabled service definitions
  for @cli and @tui with their owning repository metadata. Until #1992 binds
  exact published artifacts, these entries have no artifact locator or command
  and are excluded from default startup preparation.
- AC-1994-6 (#2002): The Core service inventory reflects both operator client
  definitions in `/api/services`. Source inventory verification uses a
  disposable copy of the checked-in manifests and never clears checkout state.
- AC-1994-7 (#1992, TUI cutover): Replace the inactive @tui declaration with
  the actual published protected manifest after verifying its exact tag,
  source SHA, all archive digests and Linux executable. Add @tui as a default
  prepared provider. The direct Core command and npm convenience both use the
  installed artifact, and checkout TUI startup needs no Go toolchain or
  locally built client. Linux local sign-in uses SPEC-2001 after secure
  onboarding. Keep the CLI release cutover independent. Do not merge the TUI
  cutover before the real publication input and combined default-stack proof.
- AC-1994-8 (#2009, CLI cutover): Verify and import the exact published `@cli`
  manifest and immutable Windows x64 and Linux x64 archives. Prepare `@cli`
  as a default provider and invoke it on demand through `service-lasso cli`
  and `npm run cli`. Retire the checkout's client source builds and cache.
  Smoke the real installed clients and the managed daemons in the same live
  default stack. CLI candidate macOS qualification is deferred.
- AC-1994-9 (#2009, CLI local session): For an implicitly selected Linux Core
  generation, reuse the existing private local operator handoff and deliver
  its short-lived session through the installed CLI's existing Bearer token
  environment. The same onboarding and acknowledgement gates apply. Explicit
  connection and credential selections retain precedence. No handoff takes
  place for offline commands or other operating systems.
- AC-1994-10 (#2013, TUI Stack update): Adopt the exact immutable TUI release
  containing the green Ready state, blank uptime for non-running services,
  and selected-service Actions shortcut. Verify the released Windows x64 and
  Linux x64 archives and import their published `service.json` byte for byte.
  macOS publication and qualification are deferred for this candidate. Exercise
  the installed TUI from the checkout with real Core inventory and lifecycle
  availability, using the acknowledged Linux private session from SPEC-2001.
  Keep existing Core generations and first-run credential acknowledgement intact.
- AC-1994-11 (#2015): Running Core exposes an explicit check and confirmed
  install for the pinned `@tui` and `@cli` providers. Check the canonical
  producer for a newer compatible immutable release. Bind its exact tag,
  released manifest, host executable and archive checksum. The install accepts
  an exact candidate tag and uses the existing service-update permission with
  confirmation. It publishes a local installation receipt only after successful
  preparation. The next invocation uses the receipt without editing the source
  manifest or restarting Core. A changed source manifest supersedes that local
  selection. No other service or moving-update policy is changed.

- AC-1994-12 (#2016): Durable update E2E harnesses use a fresh private workspace
  with the checked-in default providers and real published artifacts. Successful
  secure bootstrap must resume every supported default daemon in the original
  Core generation. TUI and Service Admin checks, cancellation and confirmed
  installation consume the same real API; validate the resulting executable
  and preserved source pin and generation. The helper supplies a private local
  operator session after test-only acknowledgement and owns its complete
  teardown. Release credentials and service tokens are excluded from output.

- AC-1994-13 (#2019): Operator/v2 service logs expose bounded real current
  runtime output to the TUI. Capture actual UTC time on new combined NDJSON
  records. Preserve legacy readers; unclocked-only output is explicitly
  unavailable, while mixed skipped history marks the typed page truncated.
  Read permission, safe redaction and no source paths apply. Combined/stdout/
  stderr filters, byte-bounded search and source-bound cursors reject invalid
  queries or stale continuation. Declared sources remain explicitly unsupported
  until the v2 selector identifies an admitted source.

- AC-1994-14 (#2023, TUI Details and Logs pin): Import byte-for-byte the
  immutable published Windows/Linux `service.json` for TUI source
  `1173a15fe2d7c31a7ad8e403a8dcd16f2300d226`, release
  `candidate-2026.11.29-1173a15`. Verify the public exact tag/source, all
  archived asset hashes and executable VCS identity; keep catalog/docs aligned.
  Exercise `node dist/cli.js tui` from the actual checkout at 120×32 and 80×24
  against a real private default stack with no manual token input, selected
  service live details and captured runtime logs. Preserve Cabinet and foreign
  state, retain evidence and shut down only owned resources. macOS is deferred.
