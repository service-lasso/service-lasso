---
id: 03-create-release-repo
title: 3. Create the Release Repo
---

# 3. Create the Release Repo

Each shared Service Lasso service should live in its own release-backed repo, usually named [`service-lasso/lasso-<name>`](https://github.com/service-lasso?q=lasso-&type=repositories).

Start from [`service-lasso/service-template`](https://github.com/service-lasso/service-template). Use it as a GitHub template or clone it into the new `lasso-*` repo, then replace the sample service details with the real service manifest, packaging script, README, and release verification.

The template is the contract baseline. Do not rebuild the release workflow and repo layout from memory unless the service has a specific reason to diverge.

## Required Repo Shape

The template provides this expected shape:

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

## Template Customization Checklist

After creating the repo from the template:

- rename the repo and package metadata to the target `lasso-*` service
- replace the sample `service.json` with the real service manifest
- update `scripts/package.mjs` to produce the exact release assets the manifest references
- update `scripts/verify-release.mjs` so CI proves the archive layout and manifest commands match
- update `README.md` with service purpose, supported versions, required env, ports, health checks, and release artifact names
- keep the `yyyy.m.d-<shortsha>` release version pattern from the template workflow

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
