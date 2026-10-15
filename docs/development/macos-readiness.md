---
title: macOS readiness activities
---

# macOS readiness activities

Reviewed on 5 October 2026 under [Core #1675](https://github.com/service-lasso/service-lasso/issues/1675). The current GA delivery scope is Windows and Linux under [the owner's platform decision](https://github.com/service-lasso/service-lasso/blob/develop/.governance/project/CURRENT_GA_PLATFORM_SCOPE.md). Mac work is deferred for that GA and remains a separate readiness track. Source tests, hosted CI and older releases cannot substitute for an exact published candidate's direct Mac acceptance.

## Native source-test investigation

Exact Core source `8aebf53bdaa4f4d90f32ac91e92a4ec41e783c5a` built on Intel macOS 11.7.11 with an isolated official Node 22.23.3 runtime. An existing Node 20 installation was preserved; SSH did not initially expose it on PATH. Use an explicit candidate-compatible runtime on PATH for both the manager and its subprocesses.

The original thirteen-file run reported 105 passes, one Windows-only skip and one failed file result after the operator interrupted a long guarded lifecycle scenario. A separate 180-second diagnostic ceiling also interrupted it. Those attempts remain retained failures, not product assertion failures. With diagnostic hash tracing, the unchanged scenario subsequently passed in 224 seconds. It progressed through start, stop, update and immediate pre-spawn checks; at least 150 hashes of the 115,419,824-byte Node executable accounted for 170.7 seconds of hashing. This establishes finite progress in that scenario, not a general performance guarantee or cause of historical browser failures.

Do not impose an ad hoc three-minute ceiling on the whole scenario or remove executable revalidation to obtain a green result. Preserve existing assertions, internal deadlines and fresh pre-spawn evidence. The complete uninstrumented thirteen-file rerun passed: 107 reported tests, 106 passed, one Windows-only skip, zero failed/cancelled, exit 0, duration 215.4 seconds. The guarded scenario took 55.6 seconds in that run. Timing varied between these experiments; tracing observations are not a product latency promise. Natural terminal closure and private evidence are recorded in #1675. No runtime defect or product patch is established by the earlier interruptions.

## Required Mac activities

| Activity | Evidence needed | Owner / current disposition |
| --- | --- | --- |
| Source baseline | Locked install, build, complete source suite on the exact candidate, natural exit, owned process/listener cleanup; distinguish OS-only skips | #1675 verifies the bounded thirteen-file experiment (106 passed, one Windows-only skip), not the complete suite |
| Packaged operator journey | Checksum-bound Core, CLI and TUI archives for the actual architecture; native API reads, confirmed lifecycle actions, error/cancel and keyboard/PTY paths | [#1461](https://github.com/service-lasso/service-lasso/issues/1461) and [#1562](https://github.com/service-lasso/service-lasso/issues/1562); source checks do not close these gates |
| Released Admin / Broker lifecycle | Bind Core source, published Admin/Broker archives and separate pinned harness; record first-run/setup, trusted identity, restart, rendering and stopped lifecycle with terminal executable status | [#1382](https://github.com/service-lasso/service-lasso/issues/1382) trusted identity and [#1565](https://github.com/service-lasso/service-lasso/issues/1565) pending browser delivery remain open and causally separate |
| Paired newcomer browser proof | Supported locked browser, complete A/B journeys, real app persistence and dependency recovery, overlapping identities, stop-A-preserves-B isolation, owned cleanup, inspected ZIP upload and downloaded hash readback | [#1330](https://github.com/service-lasso/service-lasso/issues/1330), deferred; bounded native tests cannot replace it |
| Published candidate qualification | Exact release tag/full SHA/npm version and gitHead, platform archive/SBOM/provenance/checksums, immutable inventory/public readback, same downloaded bytes exercised on Mac | SPEC-007 AC-7F/7G/7H and release-authority overlay; current Windows/Linux scope stays intact |
| Provider evidence | Retain exact failed attempt and correlate artifact-service/network records; later recovery does not establish historical cause | [#1390](https://github.com/service-lasso/service-lasso/issues/1390); its macOS ENOTFOUND upload is distinct from HTTP 403/503 investigations |

Core #1504 is currently closed and its diagnostic pin PR [#1509](https://github.com/service-lasso/service-lasso/pull/1509) merged on 2 October 2026 as `5dbcc33a54c587ab49f02327a9112ba1a27a1db6`. The [historical qualification record](core-1509-admin-pin-current-qualification.md) preserves the prior post-acceptance Cypress exit. Source landing and closed issue status do not establish that exit's cause or transfer acceptance to new bytes.

## Browser host prerequisite

The candidate locks Playwright 1.63.0. [Playwright's current system requirements](https://playwright.dev/docs/intro) require macOS 14 (Sonoma) or newer. The tested macOS 11.7.11 host is therefore a legacy source-test host, not a supported current browser qualification host. A browser install dry run is availability metadata, not browser execution or a supported-platform pass.

For #1330, provide a supported Mac, verify its OS/architecture and the candidate's locked browser requirements, select the same exact candidate as the relevant evidence matrix, then follow that issue's fresh A/B-folder procedure. Do not substitute an older browser, force a platform override, upgrade the host, publish a release or change GA applicability as part of prerequisite inspection. Retain private raw diagnostics locally; publish only inspected, redacted receipts and bundles.

The Windows/Linux [newcomer candidate matrix](newcomer-candidate-qualification.md) and [GA dossier](ga-candidate-dossier.md) describe historical exact candidates. They are useful evidence references, not current Mac acceptance or an instruction to reuse an old candidate.
