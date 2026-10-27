---
title: Service Lasso, containers or process managers?
---

# Service Lasso, containers or process managers?

Choose around the unit you want to own: an application's native supporting
services, a containerized environment, or a set of processes. These approaches
overlap. The useful distinction is how much of your desired lifecycle their
contracts already express and what your application or test harness must add.

## Service Lasso: an app-owned service lifecycle

Service Lasso is a natural fit when an application builder wants to ship a local
API, database or other native supporting service as part of the app experience.
The app supplies manifests and workspace roots; Core handles acquisition,
configuration, dependency-aware startup, health, updates and owned shutdown.
See [Why Service Lasso](why-service-lasso.md) and the
[integration path](integration/README.md).

For agent testing, its workspace/generation identity and endpoint allocation
contracts help distinguish independent runtimes. The existing
[worktree proof workflow](one-worktree-one-runtime.md) packages that into a
source-repository handoff with explicit verification and cleanup commands.
Services must still support the target host, and your harness must isolate any
external state they use.

## Containers: an environment built around images

Containers fit teams that already distribute images and want image-defined
dependencies, container networking and volume lifecycles. Docker provides an
Engine API as well as its CLI, with
[native Linux Engine installation](https://docs.docker.com/engine/install/).
Docker Desktop is another distribution choice; a VM is not an inherent
requirement for Docker Engine on Linux.

Docker documents [rootless mode](https://docs.docker.com/engine/security/rootless/)
for running the daemon and containers without root, subject to host prerequisites.
It also has [MCP Catalog and Toolkit tooling](https://docs.docker.com/ai/mcp-catalog-and-toolkit/).
Agent integration is therefore not exclusive to Service Lasso.

[Compose project names](https://docs.docker.com/compose/how-tos/project-name/)
support separate environments for feature branches and CI. Still plan published
host ports, bind mounts, external volumes and remote state explicitly. Your
container configuration and host policy determine the security boundary.

## Process managers: supervise the processes you already have

A process manager fits when your main need is starting, restarting and observing
known executables, while your app already owns their installation, configuration
and data layout. PM2 supports [programmatic process management](https://pm2.keymetrics.io/docs/usage/pm2-api/),
so embedding control in a Node application is possible. It also documents
[multiple instances through separate `PM2_HOME` locations](https://pm2.keymetrics.io/docs/usage/specifics/).

For a worktree harness, decide how to separate application data and ports and how
to associate test results with the right managed instance. For an app bundle,
decide where service acquisition, dependency readiness, configuration and updates
belong. Service Lasso is useful when you want those concerns expressed together
in its service contract; PM2 may fit when the process supervision layer is the
piece you need.

## Questions that make the choice concrete

| Your requirement | What to evaluate |
| --- | --- |
| An app brings native supporting services | Service Lasso manifests, app-owned roots, host artifacts and packaging outputs. |
| Your delivery unit is already an image stack | Container images, Compose projects, network/volume policy and host integration. |
| You already manage installation and configuration | Whether process supervision plus your existing lifecycle code is sufficient. |
| Agents test branches independently | Per-run data, endpoint discovery, instance selection, evidence and owned cleanup in any approach. |
| Services or agents distrust one another | Verified OS identities and sandbox/container/VM policy appropriate to the threat model. |

Separate workspaces are operational separation, not a hostile-code sandbox.
Same-UID or same-account services can often inspect one another or access shared
files. Custom environments and job/resource controls do not establish secret
confidentiality. Follow [service environment isolation](security/service-environment-isolation.md)
and the [resource and isolation model](reference/resource-isolation-model.md);
the latter distinguishes current behavior from proposed isolation options and
does not promise a built-in Docker/Podman execution provider.

Secret delivery has a similar limit: RAM-backed files can reduce durable plaintext
storage, but cannot prevent a consumer from copying secrets to disk, logs or dumps,
or by themselves exclude client caches or swap. Consult the
[canonical security guides](security/README.md) for the delivery mechanism you use.

There is no benchmark or battery-life claim behind this comparison, and no
guarantee about how many agents a host can run. Measure your actual workloads.
Service Lasso source features also do not establish qualification of a published
package; check [capability status](reference/runtime-capabilities.md),
[secret capability evidence](reference/secrets-capability-ledger.md) and
[release/package guidance](releases/README.md) for the exact version and platform.

[Why Service Lasso](why-service-lasso.md) centers application ownership.
[One worktree, one runtime](one-worktree-one-runtime.md) shows the concrete
independent-testing workflow.
