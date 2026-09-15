---
id: 03-create-release-repo
title: 3. Create the Release Repo
---

# 3. Create the Release Repo

Each shared Service Lasso service should live in its own release-backed repo, usually named [`service-lasso/lasso-<name>`](https://github.com/service-lasso?q=lasso-&type=repositories).

Start from [`service-lasso/service-template`](https://github.com/service-lasso/service-template) with GitHub's template flow. Do not clone a local copy or another service repo and try to retrofit the template relationship later.

The template is the contract baseline. Do not rebuild the release workflow and repo layout from memory unless the service has a specific reason to diverge.

## Create the repository from the template

Create the repository in GitHub first, then verify its template origin before
you change service files:

```powershell
gh repo create service-lasso/<repo-name> --public --template service-lasso/service-template --description "<description>"

$template = gh api repos/service-lasso/<repo-name> --jq '.template_repository.full_name'
if ($template -ne 'service-lasso/service-template') {
  throw "Repository was not created from the Service Lasso template: $template"
}
```

Then clone that GitHub-created repository and make the first adaptation on a
tracked issue branch:

```powershell
git clone --branch develop --single-branch https://github.com/service-lasso/<repo-name>.git C:\projects\service-lasso\<repo-name>
cd C:\projects\service-lasso\<repo-name>
gh issue create --title "Bootstrap <service-id> from service template" --body "..."
git checkout -b docs/<issue>-bootstrap-<service> origin/develop
```

If the template query returns `null`, stop and correct the repository's
template/bootstrap origin with its owner before adapting service files. Matching
files alone do not establish the required template origin. If the repository
has no authorized `develop` branch, stop and obtain the authorized bootstrap
workflow; never fall back to a promotion branch.

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
