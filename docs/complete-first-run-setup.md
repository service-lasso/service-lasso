---
title: Complete first-run setup
---

# Complete first-run setup

On a fresh workspace, the runtime can enter setup mode and start only the dependencies needed for bootstrap. Check `GET /api/setup/status`, complete the declared setup work, then rerun the normal start command.

First-run operator identity and vault boundaries are security-sensitive. Follow [First-run Vault Bootstrap and Permissions](reference/first-run-vault-bootstrap-permissions.md) for the supported local/remote access rules and [Vault setup and key custody](reference/vault-key-bootstrap.md) for custody and recovery constraints. Do not copy secret values into logs, issue comments, or documentation.
