---
title: Documentation map
---

# Documentation map

This inventory records every Markdown page that existed when issue [#1258](https://github.com/service-lasso/service-lasso/issues/1258) was rebased onto the active `develop` baseline: 94 original pages plus five concurrent entry-point pages. The merge reconciliation adds the component and operator-UI pages below. **Primary home** is the proposed reader category; **Unlisted** means intentionally omitted from the sidebar because the page is a detailed contract, draft/plan, test fixture, or historical/release-specific evidence. It remains discoverable by direct link and this inventory. A `listed` entry that was not on the previous sidebar has a documented reader-facing reason to expose it.

| Existing page | Primary home | Type | Sidebar status / reason |
| --- | --- | --- | --- |
| `README.md` | Start here | explanation | Listed: Docs Home |
| `INTRODUCTION.md` | Start here | explanation | Listed: core orientation |
| `quick-start.md` | Start here | guide | Listed: first runnable path |
| `service-catalog.md` | Start here | reference | Listed: inventory discovery |
| `reference-apps.md` | Use in your app | guide | Listed: reference-app choice; cross-linked from Start here |
| `release-asset-policy.md` | Contribute and maintain | reference | Listed: release verification boundary |
| `understand-service-lasso.md` | Start here | explanation | Listed: newcomer explanation of Core, Broker, and templates |
| `demo/README.md` | Run and manage services | guide | Listed: canonical demo operation guidance |
| `runtime/README.md` | Use in your app | guide | Listed: npm runtime, CLI, and HTTP API integration |
| `ecosystem/README.md` | Use in your app | explanation | Listed: service inventory and companion-project ownership |
| `releases/README.md` | Use in your app | guide | Listed: packaging-output choice and release boundaries |
| `windows-containment-tiers.md` | Security and access | reference | Unlisted: detailed platform contract |
| `operations/self-hosted-wsl-runner.md` | Contribute and maintain | guide | Listed: CI runner operations |
| `service-authoring/overview.md` | Build a service | guide | Listed: five-step entry point |
| `service-authoring/01-plan-service.md` | Build a service | guide | Listed: authoring step 1 |
| `service-authoring/02-write-service-json.md` | Build a service | guide | Listed: authoring step 2 |
| `service-authoring/03-create-release-repo.md` | Build a service | guide | Listed: authoring step 3 |
| `service-authoring/04-wire-consumers.md` | Build a service | guide | Listed: authoring step 4 |
| `service-authoring/05-validate-release.md` | Build a service | guide | Listed: authoring step 5 |
| `service-authoring/setup-helper-conventions.md` | Build a service | guide | Listed: helper guidance |
| `development/new-lasso-service-guide.md` | Contribute and maintain | guide | Listed: detailed handoff, labelled guide |
| `development/dagu-service-plan.md` | Contribute and maintain | plan | Unlisted: service-specific draft plan |
| `development/dependency-security.md` | Security and access | reference | Unlisted: detailed boundary contract |
| `development/deprecated-service-decisions.md` | Contribute and maintain | evidence record | Unlisted: historical decision record |
| `development/reference-template-provider-inventory-plan.md` | Use in your app | plan | Unlisted: implementation plan |
| `development/runtime-provider-release-services-delivery-plan.md` | Contribute and maintain | plan | Unlisted: implementation plan |
| `development/service-recovery-doctor-upgrade-hooks-plan.md` | Run and manage services | plan | Unlisted: implementation plan, not runbook |
| `development/service-update-management-plan.md` | Contribute and maintain | plan | Listed: explicitly labelled implementation plan |
| `development/serviceadmin-integration-validation.md` | Use in your app | evidence record | Unlisted: validation record |
| `development/telegram-group-control-plan.md` | Contribute and maintain | plan | Unlisted: proposal/plan |
| `development/zitadel-service-plan.md` | Use in your app | plan | Unlisted: service-specific plan |
| `reference/audit.md` | Security and access | reference | Listed: audit history |
| `reference/backup-file-export-sftp.md` | Run and manage services | reference | Unlisted: capability-specific contract |
| `reference/baseline-dependency-diagnostics.md` | Run and manage services | reference | Listed: troubleshooting entry |
| `reference/canonical-demo-watchdog.md` | Contribute and maintain | evidence record | Unlisted: demo-specific operational record |
| `reference/config-apply-preflight.md` | Technical reference | reference | Unlisted: detailed contract |
| `reference/config-snapshot.md` | Run and manage services | reference | Unlisted: detailed contract |
| `reference/dependency-graph-api.md` | Technical reference | reference | Unlisted: API detail |
| `reference/endpoints-contract.md` | Technical reference | reference | Listed: dependency and endpoint entry |
| `reference/first-run-vault-bootstrap-permissions.md` | Security and access | guide | Listed: first-run and permissions; cross-linked from Start here |
| `reference/healthcheck-reference.md` | Technical reference | reference | Listed: health and readiness entry |
| `reference/healthchecks-examples.md` | Technical reference | guide | Unlisted: supporting examples |
| `reference/healthchecks-implementation-plan.md` | Technical reference | plan | Unlisted: implementation plan |
| `reference/legacy-globalenv-migration.md` | Technical reference | guide | Unlisted: migration-specific guidance |
| `reference/legacy-setup-migration.md` | Build a service | guide | Unlisted: migration-specific guidance |
| `reference/lifecycle-fault-injection-matrix.md` | Contribute and maintain | evidence record | Unlisted: test matrix |
| `reference/local-sso-bootstrap.md` | Use in your app | guide | Unlisted: detailed bootstrap guide |
| `reference/local-sso-loop-smoke.md` | Contribute and maintain | evidence record | Unlisted: smoke fixture |
| `reference/log-shipping.md` | Run and manage services | reference | Unlisted: preview API contract |
| `reference/one-shot-jobs.md` | Build a service | reference | Unlisted: cross-linked from helper guidance |
| `reference/operator-action-queue.md` | Technical reference | reference | Unlisted: API detail |
| `reference/operator-command-facade.md` | Technical reference | reference | Unlisted: internal boundary contract |
| `reference/operator-diagnostics-bundle.md` | Run and manage services | reference | Unlisted: diagnostic contract |
| `reference/operator-inbox.md` | Run and manage services | reference | Unlisted: API detail |
| `reference/operator-mcp.md` | Technical reference | reference | Listed: MCP entry |
| `reference/operator-notifications.md` | Run and manage services | reference | Unlisted: API detail |
| `reference/process-ownership-registry.md` | Security and access | reference | Unlisted: persistence and ownership contract |
| `reference/product-api-facade.md` | Technical reference | reference | Listed: HTTP API entry |
| `reference/readiness-gate.md` | Technical reference | reference | Listed: CLI entry |
| `reference/redacted-telemetry-preview.md` | Run and manage services | reference | Unlisted: preview API contract |
| `reference/release-1-ga-decision.md` | Contribute and maintain | evidence record | Unlisted: release-specific decision |
| `reference/release-1-independent-security-review-report.md` | Contribute and maintain | evidence record | Listed: explicitly historical evidence |
| `reference/release-1-independent-windows-test-plan.md` | Contribute and maintain | plan | Unlisted: release-specific test plan |
| `reference/release-1-security-review-packet.md` | Contribute and maintain | evidence record | Listed: explicitly historical evidence |
| `reference/release-manifest-verification.md` | Build a service | reference | Unlisted: detailed release contract |
| `reference/resource-isolation-model.md` | Security and access | reference | Listed: isolation entry |
| `reference/runtime-capabilities.md` | Security and access | reference | Listed: capability limitations entry |
| `reference/runtime-doctor-status.md` | Run and manage services | reference | Listed: recovery entry |
| `reference/runtime-dry-run-plans.md` | Technical reference | reference | Unlisted: detailed contract |
| `reference/runtime-instance-registry.md` | Technical reference | reference | Listed: configuration and state entry |
| `reference/runtime-log-api.md` | Run and manage services | reference | Listed: logs entry |
| `reference/runtime-port-reservations.md` | Technical reference | reference | Unlisted: allocation ledger |
| `reference/scheduled-service-actions.md` | Run and manage services | reference | Unlisted: scheduling contract |
| `reference/secret-leak-regression-harness.md` | Security and access | evidence record | Unlisted: regression harness |
| `reference/secret-reference-audit.md` | Security and access | reference | Unlisted: audit contract |
| `reference/secrets-broker-live-readiness.md` | Security and access | evidence record | Unlisted: release-readiness record |
| `reference/secrets-capability-ledger.md` | Security and access | evidence record | Unlisted: canonical maturity ledger |
| `reference/service-action-inputs.md` | Run and manage services | reference | Listed: lifecycle entry |
| `reference/service-config-drift.md` | Run and manage services | reference | Unlisted: configuration diagnostic |
| `reference/service-config-editor-api.md` | Run and manage services | reference | Listed: configuration entry |
| `reference/SERVICE-CONFIG-TYPES.md` | Technical reference | reference | Unlisted: type detail |
| `reference/service-health-history.md` | Run and manage services | reference | Unlisted: health-history API |
| `reference/SERVICE-JSON-COMPLETE-UNION-SCHEMA.md` | Technical reference | reference | Unlisted: schema detail |
| `reference/service-json-reference.md` | Technical reference | reference | Listed: manifest entry |
| `reference/service-lockfile.md` | Technical reference | reference | Unlisted: lockfile contract |
| `reference/service-secret-access-policy.md` | Security and access | reference | Listed: secret-access entry |
| `reference/service-start-trace-api.md` | Run and manage services | reference | Unlisted: tracing API |
| `reference/servicelasso-localhost-sso-test-matrix.md` | Use in your app | evidence record | Unlisted: test matrix |
| `reference/startup-broker-resolution.md` | Security and access | reference | Unlisted: startup-resolution contract |
| `reference/startup-endpoint-allocation.md` | Technical reference | reference | Unlisted: allocation detail |
| `reference/startup-hard-crash-matrix.md` | Contribute and maintain | evidence record | Unlisted: test matrix |
| `reference/template-upgrade-compatibility.md` | Use in your app | guide | Listed: upgrade entry |
| `reference/traefik-local-route-generation.md` | Use in your app | reference | Unlisted: routing detail |
| `reference/vault-key-bootstrap.md` | Security and access | reference | Listed: key-custody entry |
| `reference/workflow-package-catalog.md` | Technical reference | reference | Listed: workflow entry |
| `reference/workflow-repo-sync-activation.md` | Technical reference | reference | Unlisted: activation contract |
| `reference/workflow-run-facade.md` | Technical reference | reference | Unlisted: run facade |
| `reference/workspace-backup-restore.md` | Run and manage services | plan | Listed: accurately labelled planning record |
| `reference/zitadel-consumer-integration.md` | Use in your app | reference | Listed: routing and SSO entry |

## Follow-up gaps

The inventory identifies no invented replacement runbook for backup/restore, updates, or service-specific UI controls. Their current records remain references or plans and are labelled accordingly. If a supported end-to-end operator procedure is needed, it should be a separate, focused issue bound to the relevant runtime acceptance criteria and verified against an actual retained workspace.

| `ui-documentation.md` | Component guides | guide / migration reference | Listed: central component guidance |
| `operator-ui/service-admin-ui-guide.md` | Component guides | guide / migration reference | Listed: central component guidance |
| `operator-ui/capture-manifest.md` | Component guides | guide / migration reference | Listed: central component guidance |
| `components/documentation-migration.md` | Component guides | guide / migration reference | Listed: central component guidance |
| `components/README.md` | Component guides | guide / migration reference | Listed: central component guidance |
| `components/service-admin/dashboard-home.md` | Component guides | guide / migration reference | Listed: central component guidance |
| `components/service-admin/environment-variables-global-and-service-reuse.md` | Component guides | guide / migration reference | Listed: central component guidance |
| `components/service-admin/health-checks.md` | Component guides | guide / migration reference | Listed: central component guidance |
| `components/service-admin/how-to-create-a-basic-service.md` | Component guides | guide / migration reference | Listed: central component guidance |
| `components/service-admin/mcp-operator-guide.md` | Component guides | guide / migration reference | Listed: central component guidance |
| `components/service-admin/network-and-service-routes-operator-guide.md` | Component guides | guide / migration reference | Listed: central component guidance |
| `components/service-admin/operations-audit-operator-guide.md` | Component guides | guide / migration reference | Listed: central component guidance |
| `components/service-admin/operations-inbox-operator-guide.md` | Component guides | guide / migration reference | Listed: central component guidance |
| `components/service-admin/operations-telemetry-operator-guide.md` | Component guides | guide / migration reference | Listed: central component guidance |
| `components/service-admin/operator-troubleshooting-runbooks.md` | Component guides | guide / migration reference | Listed: central component guidance |
| `components/service-admin/product-status-and-safety.md` | Component guides | guide / migration reference | Listed: central component guidance |
| `components/service-admin/runtime-and-logs-operator-runbook.md` | Component guides | guide / migration reference | Listed: central component guidance |
| `components/service-admin/security-and-access-operator-guide.md` | Component guides | guide / migration reference | Listed: central component guidance |
| `components/service-admin/security-secret-access-assignments.md` | Component guides | guide / migration reference | Listed: central component guidance |
| `components/service-admin/service-actions.md` | Component guides | guide / migration reference | Listed: central component guidance |
| `components/service-admin/service-admin-overview-and-navigation.md` | Component guides | guide / migration reference | Listed: central component guidance |
| `components/service-admin/service-admin-packaging-and-release-artifacts.md` | Component guides | guide / migration reference | Listed: central component guidance |
| `components/service-admin/service-install-and-setup-config.md` | Component guides | guide / migration reference | Listed: central component guidance |
| `components/service-admin/variables-and-secrets-broker-safety-guide.md` | Component guides | guide / migration reference | Listed: central component guidance |
| `components/service-template/bootstrap-new-service-repo.md` | Component guides | guide / migration reference | Listed: central component guidance |
| `components/service-template/packaging.md` | Component guides | guide / migration reference | Listed: central component guidance |
| `components/service-template/runtime-extension-points.md` | Component guides | guide / migration reference | Listed: central component guidance |
| `components/service-template/service-contract.md` | Component guides | guide / migration reference | Listed: central component guidance |
| `components/service-template/service-json-reference.md` | Component guides | guide / migration reference | Listed: central component guidance |
| `components/service-template/validation.md` | Component guides | guide / migration reference | Listed: central component guidance |
