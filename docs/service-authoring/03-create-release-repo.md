---
id: 03-create-release-repo
title: 3. Create the Release Repo
---

# 3. Create the Release Repo

Each shared Service Lasso service should live in its own release-backed repo, usually named [`service-lasso/lasso-<name>`](https://github.com/service-lasso?q=lasso-&type=repositories).

## Required Repo Shape

Start with this shape unless the service has a strong reason to differ:

```text
lasso-example/
  .github/
    workflows/
      release.yml
  scripts/
    package.mjs
    verify-release.mjs
  service.json
  README.md
  LICENSE
  package.json
```

Add service-owned runtime source or assets only when the service builds its own wrapper. Provider repos often package upstream archives instead.

## Release Outputs

The release workflow should create:

- a GitHub release tagged `yyyy.m.d-<shortsha>`
- platform archives for each supported operating system
- asset names that include the exact upstream version
- `SHA256SUMS.txt` when practical
- a released `service.json` that points at those assets

## Reuse the Full Handoff

Use [Create a New Lasso Service](../development/new-lasso-service-guide.md) as the detailed implementation handoff for this step. That guide includes naming rules, examples, release workflow expectations, packaging checks, and consuming-app guidance.

## Exit Criteria

Move to step 4 only when:

- the service repo exists
- packaging can be run locally
- CI can create release assets
- `service.json` in the repo points to the released artifacts
- release verification proves the archive layout matches the manifest commands
