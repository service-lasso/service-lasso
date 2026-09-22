# Release 1 GA decision

Decision: **GA approved with accepted residuals for Core/npm `2026.9.22-f3de461`** (AC-7H recorded 2026-09-23). The prior decision bound AC-7H to `462f837` and treated operator-promoted `1bffd1b` as a post-review delta; both remain history below.
Prepared: `2026-09-14`; revised: `2026-09-23`
Tracking issue: [#1151](https://github.com/service-lasso/service-lasso/issues/1151)
Review request: [#1402](https://github.com/service-lasso/service-lasso/issues/1402)
Prior packet issue: [#1208](https://github.com/service-lasso/service-lasso/issues/1208)

The 2026-09-08 independent AC-7H reject of Core/npm `2026.9.1-1f4ec40` /
`1f4ec40f13fe3867b24ca901c42fe31c69e01e8d` remains in force for that identity.
Packet PR [#1210](https://github.com/service-lasso/service-lasso/pull/1210) /
`c341552` stays the rejected packet. Historical published-package failures
`33500138538`, `33503750329`, and `33506286697` stay failures.

Lane AN recorded **approve with accepted residuals** on 2026-09-12 for Core/npm
`2026.9.11-462f837` / `462f837b25224e98103296b4597807b5beea00c5` and packet
merge `155d643256ee050299883d1634be067a1ff4ebce`
([comment](https://github.com/service-lasso/service-lasso/issues/1151#issuecomment-5645610452)).
That decision does **not** cover later develop product bytes.

> **Related:** [Delivery-owner evidence readback](./release-1-independent-security-review-report.md)
> remains historical for the rejected identity. The [security packet](./release-1-security-review-packet.md)
> now names the AC-7H identity as `2026.9.22-f3de461`.

## GA decision: 2026.9.22-f3de461

The AC-7H review recorded **approve with accepted residuals** on 2026-09-23 for
Core/npm `f3de46166c03d3feca5b27fa72f941e0ce8472ae` / `2026.9.22-f3de461`
([#1402 decision record](https://github.com/service-lasso/service-lasso/issues/1402#issuecomment-5781828161))
against packet revision `a144abf024e44831685663e832a6f4b777b5c61f`. The
operator authorized promotion.

- GitHub release `2026.9.22-f3de461` ID `393972333`, immutable, target
  `f3de46166c03d3feca5b27fa72f941e0ce8472ae`, published 2026-09-22T17:27:35Z.
- npm `@service-lasso/service-lasso@2026.9.22-f3de461` is `latest`; `gitHead`
  `f3de46166c03d3feca5b27fa72f941e0ce8472ae`; integrity
  `sha512-Y9sawMjrZkPd95fNHCWHGHjT6CL4cPkYr7i+BvZhImJvU7agiHCzpuC8/X7Tlgip+KD7iRQA8EAIEJeqZZz4DA==`;
  shasum `ce8672a6705ca1b4a9dffb0c2b2d3131b3da8ffb`; signed provenance.
- Gates at `f3de461`: Release Qualification `35758557194`, MCP Product
  Acceptance `35758557293`, Packaged Admin Lifecycle Acceptance `35758557458`,
  CodeQL `35758557221`, Release Artifact `35758779276`, Publish Package
  `35758782877`, Published Package Three-OS Qualification `35763042401` — all
  success.
- Admin `2026.8.31-f015b44` and Broker `2026.8.31-f340883` remain the pinned
  release artifacts.

Accepted residuals: single-operator control limitation (no enforced required
approvals, CODEOWNERS, last-push approval, or required status checks on
Core/Admin `develop`; no GA claim may assert enforced independent branch
approval or review); Admin development-scope critical code-scanning alert not on
the pinned release; publish attempt-1 registry-propagation reliability residual;
isolation L2–L4 not implemented with `require` other than none failing closed;
`#1326` and `#1382` open; `#1330` macOS proof deferred; `gh`
operator/delivery-owner independence limitation; historical failed runs retained
as failures.

This decision does not relabel the prior `462f837` approval, does not convert
any failed run into a pass, and does not claim enforced independent branch
approval.

## Current published identities (operator-promoted)

Superseded on 2026-09-23: GitHub/npm `latest` is now `2026.9.22-f3de461` (see
the GA decision above). The 2026-09-14 readback below is retained as history.

- Core `origin/develop` and `origin/main` are both
  `1bffd1bca177de213e3a0bd3efb54125dc5cf107` (`Parse isolation manifests and fail closed when require cannot be met.` `#1241`);
- GitHub release `2026.9.13-1bffd1b` ID `387882796`, not draft, not prerelease,
  target `1bffd1bca177de213e3a0bd3efb54125dc5cf107`, run
  [34754535992](https://github.com/service-lasso/service-lasso/actions/runs/34754535992) success;
- npm `@service-lasso/service-lasso@2026.9.13-1bffd1b` is `latest`, `gitHead`
  matches that SHA, integrity
  `sha512-vfrXiPeBBK8v72oUdNN7lfwokNNT9rgTyOrKEK0p+wKDPUtEVjY6X471bEtrneD6kBF4eEfC6kytuEWY7wVcgg==`,
  shasum `4bbaff1cb6ce06aa4dd8438434f1e53c8e7f12bb`; npm workflow
  [34754536780](https://github.com/service-lasso/service-lasso/actions/runs/34754536780) success;
- published-package qualification
  [34755655440](https://github.com/service-lasso/service-lasso/actions/runs/34755655440)
  attempt 1 green, exactly three unexpired records
  (`10317946523`, `10317491873`, `10317291967`, expire `2026-12-12`);
- Admin pin unchanged: `2026.8.31-f015b44`;
- Broker pin unchanged: `2026.8.31-f340883`.

Unbundled SHA-256 from the operator publication comment: win32
`9f1d6a4fb730e9c861c01c1f5d977bfbe552d8f712f826ff2e495b6122175aea`; linux/darwin
`2e4e9b07a59ad1230d29fa7376775f36483d0e208ccf318f74754e89ecc18c96`.

Commits on `develop` after the AC-7H SHA include Dependabot `#1236` `#1231`
`#1230` `#1229`, packet `#1237`, docs `#1240` (`SPEC-002` `AC-4CE`), and product
`#1241`. Those bytes are a post-review delta, not a second AN signature.

## AC-7H identity (still `462f837`)

The replacement set Lane AN reviewed remains internally qualified:

- immutable Core `2026.9.11-462f837` at
  `462f837b25224e98103296b4597807b5beea00c5` (GitHub release ID `387143354`);
- npm `@service-lasso/service-lasso@2026.9.11-462f837` later became independently
  visible; integrity
  `sha512-whjIemqmLt/NQH03QZVMMjAtXWfx+aL1Ee3aRzeSiQgbZcvKhrpRDVqzqjj57H2A4FPXw9PzTC7PB6940OQjYg==`;
- GitHub Release Artifact
  [34614413642](https://github.com/service-lasso/service-lasso/actions/runs/34614413642)
  success. npm workflow
  [34614418000](https://github.com/service-lasso/service-lasso/actions/runs/34614418000)
  attempt 1 remains **failure** at consumer verify (registry E404 window) and is
  not converted into a pass;
- published-package
  [34625492347](https://github.com/service-lasso/service-lasso/actions/runs/34625492347)
  attempt 1 green with records `10275075407`, `10274393550`, `10274044042`.

## Canonical demo (current HEAD)

On 2026-09-14 Lane AO recovered the loopback canonical demo of
`1bffd1bca177de213e3a0bd3efb54125dc5cf107`:

- Admin `http://127.0.0.1:17700/` and runtime `http://127.0.0.1:17883`;
- `demo:deploy-canonical` still exits `recycle_failed` while first-run setup
  mode blocks daemon autostart (`setup.state=setup_required`); that failed
  recycle is not converted into a pass;
- operator loopback `POST /api/setup/bootstrap` then confirmed
  `POST /api/runtime/actions/startAll` completed vault + daemons;
- `npm run demo:verify-canonical` then **passed**, including operator MCP
  protocol `2025-11-25`, 15 tools / 7 resources, and required service pins.

Browser MCP was not connected in this session; Admin HTML `HTTP 200` and the
canonical verifier are the recorded UI/reachability evidence.

## Residuals that stay residuals

- Independent AC-7H of `1bffd1b` / `2026.9.13-1bffd1b` is **not** recorded.
- `gh` identity `wildone` is also the delivery owner; independence is session
  role, not a separate GitHub login.
- Packet merge `#1237` included Dependabot not in shipped Core `462f837`.
- Historical npm run `34614418000` stays red.
- Historical published-package failures stay failures.
- Canonical recycle does not complete first-run vault bootstrap by itself
  ([#1242](https://github.com/service-lasso/service-lasso/issues/1242)).

## What this decision authorizes

Operator authority already placed `1bffd1b` on `main` and published
`2026.9.13-1bffd1b` as GitHub Latest and npm `latest`. This file records that
working-release publication honestly.

This decision does **not**:

- relabel AN's approval as covering `#1241` isolation bytes;
- convert any failed workflow into a pass;
- close `#1151` as SPEC-007 GA of an unreviewed SHA;
- change Admin or Broker pins.
