# Broker file contract review and Ubuntu verification (#1749)

SPEC-011 ESM-12/13/14/15, Development source verification, 2026-10-11.

Reviewed Core develop `7d3fe9a0142c9d1c3fa2d570f84f2f25e27a4e60`, Broker
develop `b0048353d32540b7a8708dcb4dce8946a23e5b91`, Echo PR #17 head
`e3abd085fe91a33f87d2338c824be43ed3a150b7`. Echo merged through PR #17 as
`a1429dba8abab79b8b85b319392729c5608b60d9`; all three platform CI jobs passed
(run 38068596220). Only documentation changed after its previously tested head.

## Review

Checked manifest validation, ordinary config/transaction/drift compatibility,
file-only lookup exclusion, launch identity scope, template definition guards,
secret-free requests, metadata privacy, grant replacement and exact revocation.
No additional runtime defect was demonstrated in this scope. Fixed contradictory
Echo README instructions still using config.files[].ephemeral and a broken
navigation arrow. Core lesson clarifies broker.files as the provisioning request,
Broker's returned directory, delivery through app env and complete Linux input.

## Executed on authorized Ubuntu cs-int-01

Node 22.23.3; private Go 1.26.6 linux/amd64 verified against official go.dev
release metadata checksum. No system installation or installed Service Lasso
deployment changed.

- Current Core build passed; source-built Broker RAM/contract tests passed.
- Native Echo Go tests, vet and setup/checker tests (2/2) passed.
- Eight-file Core native regression selection: **105 passed, zero failures or
  skips**. Includes required actual Broker/Core/Echo integration, Broker templates
  beside ordinary config, legacy rejection, dependency/selector/audit planning,
  tmpfs permissions/recreation/disk denial, rotation, counters and revocation.
- Executed the actual prepare.mjs command with Go on Ubuntu, then launched the
  resulting complete manifest unchanged through Core. Missing original ref
  denied before spawn, with no grant. After seeding only the synthetic ref,
  checker reported loaded, sizeBytes 46, reads 2; inventory reported downloads 2,
  servedBytes 92. Stop revoked the path (404). Second fresh launch/check/stop
  repeated the results. No secret file under the service root; log/state privacy
  held. The prepared manifest's bytes stayed unchanged throughout.

Broker SHA-256: `63794615613b733e735c9077c491315527466037c6006ea003240b1f03fc43a6`.
Echo SHA-256: `15121ec5604372d3b9683b1d1990268d854bd2fb3cb2366d1735d8e8311f205b`.

Retained evidence on cs-int-01:
`/home/maxbarrass/service-lasso/audit/broker-files-review-1749/`
(setup.log, native.log, prepared-example.log, exact scripts/source/binaries and
official Go checksum metadata). Closed isolated receipt:
`/tmp/service-lasso-test-host-state-JeV3en/isolated-test-receipts/run-1791650592629-1409744.json`.
Local evidence: `D:/projects/service-lasso/audit/broker-file-latest-review-20261011/`.

## Docs checks and limits

Docusaurus build passed; publication/tooling/adapter checks 17/17 passed;
capability ledger 25 passed; diff check passed. Native product source is unchanged
by this docs follow-up. This does not qualify Windows WebClient mounting, the
published Broker pin, whole Core CI, binary release, GA or installed deployment.
Previously recorded native/provenance/published-package failures remain separate
requirements; no protected evidence, release pin or admission gate was weakened.
