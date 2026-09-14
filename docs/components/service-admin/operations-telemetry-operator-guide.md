# Operations Telemetry Operator Guide

Status: metadata-only. Operations / Telemetry reads Service Lasso runtime and
Secrets Broker telemetry status through runtime API boundaries. It helps
operators answer whether telemetry evidence is real, whether export is
configured, and which data is intentionally hidden.

Use this guide with [Runtime and Logs Operator Runbook](runtime-and-logs-operator-runbook.md)
and [Product status and safety](product-status-and-safety.md) when telemetry is
missing, degraded, or unclear.

## What Telemetry Shows

Telemetry is a review surface, not an exporter configuration page. It can show
runtime telemetry status from `/api/telemetry` and Secrets Broker telemetry
status through the runtime service route `/api/services/@secretsbroker/telemetry`.
The browser should stay behind the Service Admin same-origin runtime boundary
and should not call broker loopback endpoints directly.

Rows may include service id, version or tag, artifact asset, signal kind,
health or readiness, phase, outcome, trace id posture, span id posture,
`traceparent` posture, Service Lasso correlation id posture, and the response
header names used for trace propagation. Treat those fields as status metadata
only. They can prove that telemetry contracts are present or missing, but they
do not prove that raw payloads are exported.

## Runtime And Service Telemetry Preview

The runtime telemetry preview answers whether the core Service Lasso runtime can
report telemetry status. A healthy row means the runtime endpoint responded with
the expected telemetry metadata contract. An unavailable or degraded row means
operators should check Runtime before assuming an individual service has a
telemetry problem.

The service telemetry preview answers whether a managed service exposes its own
safe telemetry posture through the runtime. For Secrets Broker, Service Admin
uses the runtime service route so the broker stays behind the runtime API
boundary. If the core runtime is healthy but the service preview is unavailable,
check the affected service state, service route metadata, and Logs.

## Exporter Status

Exporter status describes configuration posture only:

| Status | Meaning |
| --- | --- |
| Disabled | No exporter is configured or export is intentionally off. Telemetry can still be visible locally as status metadata. |
| Configured | Export settings are present enough for the service to report configured posture. Confirm the backend sink separately before treating export as received. |
| Error | The service detected invalid exporter settings, a failed exporter check, or a runtime contract problem. Use the row outcome and service logs for the next check. |
| Dry-run or ready | The service can describe the exporter plan without proving delivery of production telemetry. Treat it as preflight evidence, not payload export proof. |

If exporter status is absent, use the safest interpretation: export is not
proven configured.

## OTLP And Export Preview

OTLP or export preview fields explain shape and readiness, such as whether
traces, metrics, or logs would be included and whether a configured exporter
looks syntactically ready. The preview must not reveal endpoint URLs,
authorization headers, cookies, provider tokens, credentials, query strings, or
environment values.

When an export preview says ready, ask: which service reported it, what signal
kind was included, what readiness timestamp or outcome was shown, and whether a
separate sink dashboard or collector check confirms receipt.

## Trace Context And Correlation IDs

Trace context fields describe propagation posture. A row can show whether trace
id, span id, `traceparent`, response header names, and Service Lasso
correlation ids are present, missing, forwarded, or intentionally suppressed.

Use correlation ids and operation ids when moving between Telemetry, Logs,
Runtime, Services, and Audit. Correlation ids help connect related events across
surfaces without copying raw request headers or bodies.

## API Request Summary And Buffer

Telemetry may summarize API request activity using route templates, status
classes, outcomes, methods, timestamps, durations, and service ids. Route
templates should be normalized, such as `/api/services/:serviceId/logs`, rather
than full request URLs.

Request buffers are for safe trend and failure review. They must not include
raw headers, raw query strings, request bodies, response bodies, tokens,
cookies, credentials, secret values, private keys, recovery material, or
environment dumps.

## Redaction Boundaries

Telemetry allowlists safe metadata fields. Examples include service id, route
template, signal kind, status class, operation id, correlation id, readiness
state, outcome, duration bucket, exporter posture, and timestamp.

Forbidden field classes must stay out of runtime responses, UI rows, exported
previews, tickets, screenshots, and support notes:

- raw headers, especially authorization, cookie, and trace header values
- raw request bodies and response bodies
- tokens, credentials, private keys, recovery material, and secret values
- query strings and callback URLs that may carry private parameters
- OTLP endpoint URLs, OTLP headers, provider tokens, and environment values
- unredacted log excerpts copied from application output

If a row would need one of those fields to explain itself, show a redacted
summary and a next action instead.

## Unavailable Or Degraded Rows

Use this order when telemetry is missing:

1. Open Runtime and confirm the runtime API is healthy.
2. Confirm same-origin `/api/telemetry` responds through Service Admin.
3. Confirm `/api/services/@secretsbroker/telemetry` responds through the
   runtime boundary when the Secrets Broker row is affected.
4. Open Services and confirm the affected service exists, is started when
   expected, and is not blocked by dependencies.
5. Open Logs for short redacted startup or exporter errors.
6. Check whether the service intentionally disables telemetry export or only
   supports local status metadata.
7. If trace context is missing, compare runtime trace propagation posture with
   the affected service row before changing exporter settings.

Do not retry broad restarts until the unavailable row is tied to runtime
health, service state, exporter configuration, or a known service telemetry
contract gap.

## Relationship To Logs And Audit

Telemetry explains runtime signal posture and request summary metadata. Logs
explain service output near a failure, using safe runtime log lines and log
source metadata. Audit explains operator actions, broker decisions, operation
receipts, and policy outcomes where those events are exposed.

Use Telemetry first for questions about signal presence, export posture, trace
context, or request outcome trends. Use Logs when a service or exporter needs a
redacted error summary. Use Audit when the question is who initiated an
operator action, which policy outcome was recorded, or which operation id should
be handed off.

## Safe Handoff Evidence

When escalating a telemetry problem, include:

- affected service id and telemetry route
- runtime health state and latest check timestamp
- exporter status and signal kind
- trace context posture and correlation id when available
- route template, status class, and outcome summary when request telemetry is
  involved
- short redacted error summary
- the next check already performed

Exclude raw headers, request or response bodies, tokens, credentials, query
strings, secrets, private keys, recovery material, OTLP endpoint values, OTLP
headers, environment values, and unredacted log output.

---

[Component guides](../README.md) · Imported from [lasso-serviceadmin](https://github.com/service-lasso/lasso-serviceadmin/blob/d018767c715c92719b8df69f64ebf5484ee0ba11/docs/help/operations-telemetry-operator-guide.md). The [migration inventory](../documentation-migration.md) records ownership and remaining work.
