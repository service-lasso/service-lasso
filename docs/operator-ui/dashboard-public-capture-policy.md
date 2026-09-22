---
title: Dashboard public-capture policy
---

# Dashboard public-capture policy

This proposed policy is the public-documentation boundary for the Service Admin
Dashboard. It is bound to `SPEC-002` `AC-4AJ.3a` and Core issue #1322. It does
not authorize release, deployment, a security conclusion, or a GA claim.

## Policy identity and preconditions

The only policy identifier accepted by the capture runner is
`dashboard-public-safe-v1`. Run it only against a clean, task-owned loopback
proof environment after the complete 40-route read-only audit succeeds. Keep
the normal Playwright password masking enabled. The policy is deliberately
fail-closed: Dashboard is review-only unless that exact identifier is supplied,
and the runner will not copy it to public documentation until it has applied
the policy and recorded it in the receipt.

## Field inventory

| Dashboard content class | Classification | Public-frame rule |
| --- | --- | --- |
| Page identity: `Dashboard` and `Runtime health` labels | Public-safe | Preserve these static labels only. |
| Health state, service totals, warning counts, Broker posture, and recovery state | Redactable | Mask every value and generated status text. Do not infer that a masked value is healthy or current. |
| Alerts, lifecycle/generation details, allocation values, ports, hosts, endpoint values, service/workspace/correlation identifiers, links, logs, configuration, paths, and error detail | Prohibited | Mask completely. Do not publish a frame if any remains readable. |
| Password controls and password-like inputs | Redactable | Playwright native password masking remains mandatory; it is additional to, not a replacement for, this policy. |
| Tokens, credentials, secret values, private keys, cookies, raw environment/configuration, or any unclassified value | Prohibited | Stop the run, retain only a metadata-safe failure receipt, and create or link a focused follow-up. |

The runner replaces every Dashboard text value other than the two allowlisted
static labels with `[REDACTED]` immediately before writing the PNG. This makes
the published image a redacted route illustration, not an operator-state
report.

## Required evidence and review

Run the normal audit and capture in a clean owned environment:

```powershell
npm run capture:service-admin-tour -- --url=http://127.0.0.1:17700/ --dashboard-public-policy=dashboard-public-safe-v1
```

Before a PNG is committed, an independent PR reviewer must inspect the
1512×982 image and its metadata-only `capture-receipt.json`. Confirm the exact
policy identifier, the active redaction record, password masking, no readable
prohibited content, and that the result is a rendered Dashboard rather than a
setup, unavailable, error, or skeleton screen. Record the Core/Admin candidate
identities, environment ownership, route, viewport, policy, inspection result,
and limitations in the capture manifest. A passing runner or a masked image is
only partial evidence until that review occurs.
