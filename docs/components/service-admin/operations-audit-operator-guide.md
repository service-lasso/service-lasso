# Operations Audit Operator Guide

Status: metadata-only with runtime-backed events where exposed. The **Audit**
page, formerly labelled **Audit Logging** in some routes and older docs, helps
operators inspect safe audit metadata for Service Lasso and Secrets Broker
activity. It does not by itself prove that every mutating UI action is durably
persisted.

Use this guide with [Service Actions](service-actions.md),
[Operations Telemetry](operations-telemetry-operator-guide.md),
[Variables and Secrets Broker Safety](variables-and-secrets-broker-safety-guide.md).

## What Audit Shows

Audit rows are safe summaries of events returned by the current audit source.
When the runtime audit API is available, the page shows live runtime audit
metadata. When the source is unavailable, the page shows an unavailable state
instead of inventing history. When explicit Service Admin stub mode is enabled,
rows are fixture preview data only.

Rows may include:

- event: the action or broker event label
- source: Service Lasso or Secrets Broker
- actor: the safe operator or system actor identifier
- outcome: success, failure, granted, denied, or another safe result class
- policy: reason, route template, status class, or decision metadata
- chain: tamper-evidence state for the event when available
- recorded time: the event timestamp from the audit source
- safe summary: a redacted explanation suitable for operator handoff

Treat those fields as audit metadata. They can help answer what happened, which
source reported it, who or what initiated it, and what outcome or policy state
was recorded. They do not prove complete append-only persistence unless the
runtime or backend audit sink exposes that contract and tests cover it.

## Chain And Tamper Evidence

The chain field describes the tamper-evidence posture reported with an event:

| State | Meaning |
| --- | --- |
| verified | The event reports a valid chain or equivalent tamper-evidence state. |
| broken | The event reports a failed chain check. Treat the row as incident evidence and avoid normal operator assumptions until investigated. |
| unavailable | No chain proof is available for the row or source. Use the row as metadata only. |

A mixed summary means visible rows disagree about chain state. Investigate the
affected source before treating the audit trail as coherent.

## What Audit Must Exclude

Audit rows, summaries, tickets, screenshots, and handoff notes must not include:

- secret values
- provider credentials
- API tokens, bearer tokens, cookies, or session tokens
- passwords or private keys
- raw request bodies or response bodies
- recovery material
- unredacted environment values or provider configuration values

If an event needs sensitive material to explain itself, the safe UI behavior is
to show a redacted summary, operation id, policy reason, or next action.

## Metadata Display Versus Durable Persistence

The Audit page is a display surface. It can prove that Service Admin received
and rendered a metadata-safe audit response for the current source. It cannot
alone prove that every mutating Service Admin action has been written to a
durable append-only backend.

Use this distinction when writing docs, issue comments, support notes, or
release notes:

- It is safe to say the Audit page shows metadata-only audit rows when the
  runtime exposes them.
- It is safe to say unavailable or fixture states are not durable audit proof.
- Do not claim every mutating UI action is durably recorded until runtime and
  backend evidence proves that append-only contract.
- Do not treat a visible row count as retention, immutability, or completeness
  evidence unless the backend contract explicitly says so.

## Future Durable UI Action Contract

When a mutating Service Admin UI action becomes durably logged, the event should
include safe fields that let operators reconstruct the action without exposing
private material:

- actor
- action
- target service or resource
- timestamp
- outcome
- reason where required
- request id or correlation id where safe
- tamper-evidence state where available

Examples include service start, stop, restart, install, uninstall, reload,
configuration save, broker reveal approval, provider source change, and secret
write-back. The event must describe intent and
outcome, not raw secrets, credentials, request bodies, or exported payloads.

## Operator Workflow

1. Open **Audit** when you need action, policy, broker decision, operation, or
   receipt metadata.
2. Check the data source summary before relying on rows. Live runtime audit,
   unavailable, and fixture preview mean different things.
3. Inspect event, source, actor, outcome, policy, chain, recorded time, and safe
   summary together.
4. Use correlation ids or operation ids to connect Audit with Telemetry, Logs,
   Runtime, Services, and Variables evidence.
5. Escalate broken chain, unavailable source, or missing durable action evidence
   as a backend/runtime contract gap rather than filling the gap in docs.

## Related Checks

- Use [Service Actions](service-actions.md) to decide which UI actions are
  mutating and which follow-up checks are required.
- Use [Operations Telemetry](operations-telemetry-operator-guide.md) for signal
  posture, request summaries, trace context, and correlation ids.
- Use [Variables and Secrets Broker Safety](variables-and-secrets-broker-safety-guide.md)
  before interpreting secret refs, broker policy outcomes, reveal actions, or
  write-back events.

---

[Component guides](../README.md) · Imported from [lasso-serviceadmin](https://github.com/service-lasso/lasso-serviceadmin/blob/d018767c715c92719b8df69f64ebf5484ee0ba11/docs/help/operations-audit-operator-guide.md). The [migration inventory](../documentation-migration.md) records ownership and remaining work.
