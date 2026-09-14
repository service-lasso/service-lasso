---
title: Use the default Service Lasso stack
---

# Use the default Service Lasso stack

Service Lasso Core discovers, configures and supervises the default local
service set. **Service Admin** is the browser interface for operating that
runtime. Start with this page when you want to run the default stack, then use
the Service Admin-owned guide for every page, control and workflow.

## Start and open the stack

1. From a clean Core checkout, follow [Quick Start](quick-start.md).
2. For an isolated review or documentation run, use
   `npm run demo:worktree-proof -- --id=<issue-or-branch>`. Read the generated
   summary: it is the authority for allocated Runtime, Service Admin, gate,
   verifier and cleanup commands.
3. Open the reported Service Admin URL. Use its **Dashboard** first, then
   **Services** for a service-specific action.
4. Confirm lifecycle changes by refreshing Service Admin and checking the
   resulting runtime/service state; a toast is not durable proof.

## What the default services do

The default proof lane uses Core plus the checked-in baseline manifests. The
runtime prepares providers such as `@node`, `@java` and `@localcert`; it starts
managed services such as `@nginx`, `@traefik` and `echo-service` when their
contracts allow it. `@serviceadmin` is the browser entry point. Additional
interfaces advertised by manifests, such as NGINX, Traefik, Echo Service and
Secrets Broker, have their own service-owned documentation; use Service Admin
to open an advertised interface and use that service’s documentation for its
third-party UI.

## Service Admin documentation

Detailed UI behavior belongs to
[Service Admin’s in-app Help Center](https://github.com/service-lasso/lasso-serviceadmin/tree/develop/docs/help):

- [UI guide and route/control reference](https://github.com/service-lasso/lasso-serviceadmin/blob/develop/docs/help/ui-documentation.md)
- [Capture manifest and maintainer refresh guide](https://github.com/service-lasso/lasso-serviceadmin/blob/develop/docs/help/ui-capture-manifest.md)
- [Product status and safety](https://github.com/service-lasso/lasso-serviceadmin/blob/develop/docs/help/product-status-and-safety.md)

## Capture and coverage status

The documentation capture environment was Core `3307d61787918d6d6dd195facfb808e2c2c0c9a9`,
Service Admin source `5823f1b`, Node 22, a task-owned runtime at port 18100 and
Admin proxy at port 18101 on 2026-09-14. The Core proof runner reached a live
runtime, but its canonical gate reported `canonical_service_state_mismatch`
because `node-sample-service` ran where the source-Admin proof contract expects
it to remain manifest-only. The Admin headless browser captured blank pages, so
the Admin manifest retains those captures as non-evidence receipts. The complete
UI guide therefore documents source-inventoried routes and runtime-backed
workflows but does **not** claim screenshot-complete coverage.
