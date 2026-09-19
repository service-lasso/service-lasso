---
title: Newcomer candidate qualification
---

# Newcomer candidate qualification

This is the evidence contract for Core #1323 and `SPEC-002` `AC-4AJ.4a`.
It is not a GA decision or release authorization.

## Candidate

| Component | Identity | Classification |
| --- | --- | --- |
| Core | `develop` source `2fc28ad4a9e8b47bbd0e615afb2179bb2f61baa8` | Candidate source; not a published-release claim |
| Service Admin | `service-lasso/lasso-serviceadmin` `2026.8.31-f015b44` | Pinned release artifact |
| Secrets Broker | `service-lasso/lasso-secretsbroker` `2026.8.31-f340883` | Pinned release artifact |

Core Release Qualification [35341823256](https://github.com/service-lasso/service-lasso/actions/runs/35341823256) is surrogate-only evidence; it does not establish a newcomer journey.

## Required platform matrix

Each platform must retain a metadata-only receipt with its environment identity,
candidate, elapsed observations, rendered Admin proof, and owned-cleanup result.

| Platform | Clean install/setup | Demo and visible Admin | Safe app outcome | Failure/recovery and restart | Secret boundary | Cleanup | Classification |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Windows | Existing development machine is not clean-machine evidence; [#1328](https://github.com/service-lasso/service-lasso/issues/1328) | — | — | — | — | — | Blocked |
| Linux | Shared stopped WSL environments are not an authorized clean candidate environment; [#1329](https://github.com/service-lasso/service-lasso/issues/1329) | — | — | — | — | — | Blocked |
| macOS | No host or remote connection is available; [#1330](https://github.com/service-lasso/service-lasso/issues/1330) | — | — | — | — | — | Blocked |

Do not replace a platform row with CI, an API response, a source build, or a
result from another operating system. If a platform is unavailable, change only
that row to `Blocked` and record its reproducible prerequisite and owning
follow-up.
