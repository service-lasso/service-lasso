---
title: Run and manage services
slug: /operations
---

# Run and manage services

Use this section to operate an existing Service Lasso inventory. Start with [Configure and recover a service](../operate-your-service.md). Shared contracts and [Service Admin guides](../components/README.md) are maintained here.

## Start, stop, and configure

Start with [Quick start](../quick-start.md) for the checked-in baseline. The [service action inputs](../reference/service-action-inputs.md) and [service configuration editor API](../reference/service-config-editor-api.md) define the supported lifecycle and configuration inputs; they are contracts, not alternative runbooks.

For the checked-in canonical demo’s exact URLs, lifecycle commands, recovery gate, and isolated worktree proof, use [Demo operations](../demo/README.md).

## Health, logs, updates, and recovery

Use the [healthcheck reference](../reference/healthcheck-reference.md) and [readiness gate CLI](../reference/readiness-gate.md) to interpret readiness. Use the [runtime log API](../reference/runtime-log-api.md) and [operator notifications](../reference/operator-notifications.md) for observable runtime state. The [runtime doctor status](../reference/runtime-doctor-status.md) and [baseline dependency diagnostics](../reference/baseline-dependency-diagnostics.md) are the supported diagnostic surfaces for startup, dependency, and endpoint issues.

## Protect workspace data

The [workspace backup and restore record](../reference/workspace-backup-restore.md) is a planning/reference record, not a claim that every backup target is implemented. Follow its stated maturity and limitations before relying on a recovery procedure.

## Related guidance

- [Service Catalog](../service-catalog.md) for the inventory you are operating.
- [Security and access](../security/README.md) before configuring identities, secrets, or isolation.
- [Technical reference](../reference/README.md) for exact APIs and persisted-state contracts.
