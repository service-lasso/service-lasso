---
title: Security and access
slug: /security
---

# Security and access

This section describes the Core boundaries for local operator access, service secret metadata, audit history, and isolation. It does not claim service-specific security behavior or capability maturity beyond the cited canonical records.

- [Vault setup and key custody](../reference/vault-key-bootstrap.md) describes the supported first-run custody and recovery boundary.
- [Users and permissions](../reference/first-run-vault-bootstrap-permissions.md) defines local and remote first-run access rules.
- [Service secret access](../reference/service-secret-access-policy.md) defines assignment and policy metadata without exposing secret values.
- [Audit history](../reference/audit.md) describes durable metadata-only evidence.
- [Process and resource isolation](../reference/resource-isolation-model.md) defines the supported isolation ladder and honest degradation rules.
- [Supported capabilities and limitations](../reference/runtime-capabilities.md) is the runtime capability API contract. Consult the [capability ledger](../reference/secrets-capability-ledger.md) for maturity and release-readiness evidence.

- [Operate and recover Secrets Broker](broker-operator-tasks.md) centralizes bounded setup, recovery, source and adapter tasks with exact source provenance.
