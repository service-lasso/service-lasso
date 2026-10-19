# SPEC-013: Linux suite prerequisites and scoped start confirmation

Owner: Core #1736. Active Development scope: the nine failures from the closed
1,966-test Ubuntu run. Eight need genuine host test tools; one is a false stale
confirmation caused by an unrelated service's lifecycle changing its executable
revision. Bind product behavior to SPEC-006 AC-6E/AC-6F.

- LQ-1: Document PowerShell (`pwsh`), `lsof`, and Python 3 available as `python`
  for the existing full-suite script/port/ConPTY tests. These are test tools,
  not secret-file runtime prerequisites. Use private process-local tools for
  qualification; do not install globally or skip affected tests. Preserve the
  actual foreign-owner fixture input and Broker executable input for native cases.
- LQ-2: A service-specific start plan binds executable revisions to its actual
  mutation targets, retaining definition/artifact/launch/template bindings and
  the stable dependency-closure context. Starting an independent service must
  not invalidate another actor's confirmation solely because that unrelated
  service becomes installed/configured. Runtime-wide actions and restart binding
  remain unchanged. No permission, actor, replay, or confirmation bypass.
- LQ-3: Preserve all original concurrent replay, cross-actor same-key isolation,
  changed-request rejection, cross-process replay, changed-manifest and dependency
  executable-tamper assertions. Confirm changed relevant inputs still fail closed.
- LQ-4: Run the existing durable HTTP and guarded-action regression files, the
  eight prerequisite-sensitive cases, then the configured full Ubuntu suite from
  a pushed immutable candidate with private state. Retain natural closed receipts
  and original failures; report every failure rather than claiming partial green.
  Push each commit and deliver through a develop PR. No release/deployment.
