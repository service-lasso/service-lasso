# Service Lasso Docs

This repo is the canonical home for general Service Lasso documentation.

## Canonical general docs

- `docs/reference/service-json-reference.md` - general `service.json` contract reference
- `docs/reference/SERVICE-JSON-COMPLETE-UNION-SCHEMA.md` - generalized schema/reference shape
- `docs/reference/SERVICE-CONFIG-TYPES.md` - taxonomy of common service config patterns
- `docs/reference/shared-runtime/SERVICE-MANAGER-BEHAVIOR.md` - shared runtime behavior notes
- `docs/windows-containment-tiers.md` - Windows containment guidance
- `docs/development/core-runtime-layout.md` - first tracked core runtime source layout for `SPEC-002` / `TASK-006`
- `docs/development/core-runtime-dev-plan.md` - recommended full core repo structure, API shape, and implementation order
- `docs/development/core-runtime-demo-instance-plan.md` - phased plan for turning the current bounded core runtime into a reviewable demo instance
- `docs/development/core-runtime-migration-plan.md` - donor service-manager migration status, gap map, and recommended next migration order

## Source-of-truth rule for `service.json`

When discussing or changing the general `service.json` contract:
- use the core `service-lasso` docs as the source of truth
- update the canonical docs here first
- only then mirror or point from individual service repos as needed

Current canonical files for that work are:
- `docs/reference/service-json-reference.md`
- `docs/reference/SERVICE-JSON-COMPLETE-UNION-SCHEMA.md`
- `docs/reference/SERVICE-CONFIG-TYPES.md`
- `docs/reference/shared-runtime/SERVICE-MANAGER-BEHAVIOR.md`

## Repo boundary rule

Keep these docs here when they describe:
- general manifest schema
- shared runtime behavior
- provider/dependency semantics
- reusable service taxonomy
- cross-service/platform contract rules

Keep docs in individual service repos when they describe:
- service-specific UI or runtime behavior
- service-specific migration notes
- service-specific route/page specs
- service-specific packaging quirks unless they generalize back into the core contract
