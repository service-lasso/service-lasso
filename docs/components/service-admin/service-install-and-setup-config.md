# Service Install and Setup Config

Use this guide to keep install/setup data consistent across services.

## Required install paths

Record these in service metadata so Installed view is useful:

- install path
- config path
- data path
- optional log/work paths

## Setup flow

A standard setup usually includes:

1. create folders
2. copy config templates
3. set env variables
4. run initial install action

Service Admin first-run setup is a separate runtime bootstrap boundary. It
reads `GET /api/setup/status` and invokes `POST /api/setup/bootstrap`; it does
not run per-service setup steps through `GET /api/setup`, and it never asks the
operator to copy or acknowledge a raw vault key.

## Config hygiene

- keep defaults versioned
- keep environment-specific values separate
- avoid hard-coding machine-specific paths in docs/examples

---

[Component guides](../README.md) · Imported from [lasso-serviceadmin](https://github.com/service-lasso/lasso-serviceadmin/blob/d018767c715c92719b8df69f64ebf5484ee0ba11/docs/help/service-install-and-setup-config.md). The [migration inventory](../documentation-migration.md) records ownership and remaining work.
