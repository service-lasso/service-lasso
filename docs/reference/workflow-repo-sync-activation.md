# Workflow repo sync and activation controller

Service Lasso workflow content updates through pinned Git/release refs, not by blindly pulling a mutable branch into active production state. The workflow repo sync controller is the first contract for fetching official/core and custom workflow repositories into an instance-local workspace, validating them, and activating them safely.

## API contract

The platform surface is intentionally small and state-oriented:

- `GET /api/platform/workflow-repos/state` returns the active revision, previous-good revision, failed activation evidence, and activation history.
- `POST /api/platform/workflow-repos/sync` fetches configured workflow repo sources into a staging workspace.
- `POST /api/platform/workflow-repos/activate` validates staged workflow package metadata and promotes a complete activation.
- `POST /api/platform/workflow-repos/rollback` restores the previous-good revision pointer when an activated revision must be backed out.

The initial implementation exposes this as a platform controller contract in `src/platform/workflowSyncController.ts`; runtime route binding can wrap the same state shape later.

## Source configuration

Each workflow source must declare:

- `id` — stable source id, usually matching the package id.
- `source` — `official` for Service Lasso-owned workflow content or `custom` for additive operator content.
- `repo` — repository slug or local/file source.
- `ref` — pinned release tag or immutable commit/ref.
- `channel` — optional release channel metadata such as `stable` or `preview`.
- `path` — optional package-root path inside the synced repository.

Mutable production refs such as `main`, `master`, `develop`, `latest`, or `HEAD` are rejected by validation. This keeps sync from turning into an uncontrolled `git pull main` against the active workflow directory.

## Activation model

Activation is staged before promotion:

1. Fetch each configured source into `workspaceRoot/staging/<activation-id>/<source-id>`.
2. Load `workflow-package.json` metadata from each synced package root.
3. Validate package metadata, source/ref alignment, Dagu workflow definition files, namespace rules, raw secret boundaries, and catalog collisions.
4. Promote the complete staging directory to `workspaceRoot/active/<activation-id>` only after validation passes.
5. Write state atomically to `state.json` with the new active revision and prior active revision as `previousGood`.

The active revision is a composed source/revision string, for example:

```text
official.core.maintenance@2026.5.8+custom.local.reporting@v0.1.0
```

The active state includes mounted package roots, source revisions, activated package ids, and activation history. API consumers should display both active and previous-good revisions so operators can see what changed and what rollback target is available.

## Validation and rollback

Activation fails before promotion when:

- a source is missing `id`, `repo`, `ref`, or has an invalid `source` kind;
- a source uses a mutable production ref such as `main`;
- package metadata fails the workflow catalog contract;
- package metadata repo/ref does not match the configured synced source;
- a Dagu package declares a workflow id but does not include a matching `workflows/<name>.yaml` or `workflows/<name>.yml` definition;
- custom content collides with official package ids, workflow ids, config paths, or tool ids;
- raw secret/token/key/recovery material appears in workflow metadata.

On validation or fetch/activation failure, the controller records failed activation evidence and leaves the previous active revision mounted. `failed.rolledBackTo` names the active revision that remained in effect.

Manual rollback swaps `active` and `previousGood` state pointers and appends a rollback history record. Rollback does not invent a new workflow package revision; it restores the previously activated known-good revision.

## Custom package policy

Custom workflow packages remain additive overlays. They may add `custom.*` package ids, workflow ids, tools, and config paths, but must not edit or override official/core content in place. Collisions are activation blockers, not warnings.

## Secret boundary

The sync controller reuses the workflow catalog secret boundary:

- broker secret refs are allowed as metadata (`namespace` + dotted `ref`);
- raw provider tokens, API keys, private keys, passwords, client secrets, and recovery material are rejected before activation;
- state/API payloads contain metadata and refs only, not secret values.
