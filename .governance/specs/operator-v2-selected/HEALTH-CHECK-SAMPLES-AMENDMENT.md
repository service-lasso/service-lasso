# Selected bounded HTTP check samples — Core #1973 graph slice

Architect-Conductor approval: parent delivery coordinator selected this additive
read contract on 2026-11-27. Existing selected closed DTOs retain their bytes.
Development only; no release, deployment or broad #1973 completion authority.

- AC-HCS-1: GET `/api/operator/v2/health-check-samples` requires authenticated
  runtime identity and registered `read_overview` equivalent `workspace:read`.
  Exactly 1..25 distinct valid known `serviceId` query parameters are accepted;
  extra parameters, duplicate IDs and invalid/unknown IDs fail generically.
- AC-HCS-2: Existing v2 envelope data is exactly `{observedAt,windowSeconds,rows}`;
  observedAt is RFC3339, windowSeconds is 900. Each requested ID has exactly
  `{serviceId,state,samples}`; state is configured/not_configured and each sample
  exactly `{at,passed,durationMs}` (RFC3339, boolean, nonnegative integer).
  Retain at most 60 samples per service, chronological, within the current window.
  Fixed 60 bounds fit the selected 8192-value and 256KiB response limits for 25 IDs.
- AC-HCS-3: Source is the first effective HTTP check in manifest evaluation order,
  not aggregate health, process health or mixed HTTP configurations. Duration uses
  a monotonic clock around the existing HTTP evaluator. Reads never run probes.
- AC-HCS-4: Recorder is runtime-owned, in-memory and bounded; new runtimes do not
  inherit samples. Readers project current configuration without mutating the
  active recorder: removed IDs fail generically, disabled services expose no
  samples, and changed resolved HTTP configuration exposes no stale series. The
  existing boot-registry monitor snapshot/admission is preserved; a changed
  check remains configured/empty until an existing admitted source observes that
  same resolved configuration (normally after runtime restart). Returning to the
  identical configuration may show its genuine retained observations. Configured with
  zero samples is honest. No probe schedule or recovery policy is broadened.
  The ordinary product entrypoint forwards explicit monitor/interval options and
  enables the existing opt-in monitor with `SERVICE_LASSO_MONITOR=1` only when no
  explicit monitor option is supplied; false overrides the environment. Default
  behavior and all existing per-service/restart-policy admission remain unchanged.
- AC-HCS-5: Responses never contain URLs, cookies, configuration, diagnostic detail,
  response bodies or host paths. Recording preserves existing health APIs.
- AC-HCS-6: Prove real success/failure/delay probes through the ordinary runtime
  monitor with a controlled disposable HTTP service, repeated passive reads,
  isolation, configuration reset, expiry/cap and denied/invalid requests. Existing
  v2 contract/route and recovery-monitor gates remain required.

Uptime, restart counts, incident summaries and other #1973 work remain tracked.
