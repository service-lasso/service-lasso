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
