---
title: External operator-tool packaging
---

# External operator-tool packaging

Core's `service-lasso` command remains the local-runtime command. The external tools are separate operator clients:

| Tool | Command | Role | Execution boundary |
| --- | --- | --- | --- |
| Service Lasso CLI | `service-lassoctl` | automation-first Core API client | noninteractive; mutations require the client's explicit confirmation contract |
| Service Lasso TUI | released platform executable | keyboard operator client | caller-owned attached terminal; never autostarted |

Neither tool is a Core managed service. Do not add `service.json`, catalog it, supervise it, report Core lifecycle/health for it, or start a terminal session from Core.

## Target platform contract

The API CLI is a Node 22+ package and may be packaged only for a Core platform where that Node runtime is supported. The TUI release inventory must contain `windows-amd64`, `linux-amd64`, `darwin-amd64`, and `darwin-arm64` assets. An operator-tools manifest must enumerate only assets present for the current platform; an unsupported platform must return a stable unavailable result before extraction or process launch.

Core can stage only a fresh reviewed candidate release for each tool. Candidate releases are distribution evidence, not GA.

## Release identity gate

Core may package an external operator tool only after the owning repository supplies an approved immutable release that contains the reviewed source head. The Core packaging record must pin all of the following before staging any tool bytes:

- source repository, tag, and full release target commit;
- the exact asset names and SHA-256 values reported by GitHub;
- the downloaded, nonempty checksum manifest and its SHA-256;
- a complete asset inventory for the supported platforms;
- installed relative paths and command names.

The stage must reject mutable selectors such as `latest`, an unmatched tag/target, a missing, extra, duplicate, malformed, redirected, path-traversing, unsupported, or checksum-mismatched asset. It must make no network fetch at Core startup.

The Core staging record verifies the GitHub release tag target, candidate status, full asset inventory, downloaded nonempty bytes, checksum manifest, and independently pinned asset digest. Earlier foundation releases target different commits, so Core must not package or qualify them as substitutes.

After the exact releases exist, qualify a clean Core package/archive extraction or install on Windows, Linux, and macOS. Run the API CLI against the packaged Core for machine-readable success, safe error, and confirmation behavior. Run the TUI in the caller terminal for startup, safe errors, keyboard navigation, and clean exit. Record the tested Core and tool heads, and distinguish direct runtime proof from surrogate checks.
