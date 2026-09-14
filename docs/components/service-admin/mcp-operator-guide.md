# MCP operator guide

The MCP page reports the runtime's current MCP connection, permission, client,
operation, confirmation, and audit state. Treat the displayed values as a
readback from the running Service Lasso instance, not as a substitute for an
approval decision.

## Before enabling a client

1. Confirm the endpoint and transport match the intended local runtime.
2. Check the client's effective role, mode, scopes, and any denial reason.
3. Keep mutation capability disabled unless the actor has an explicit need and
   the runtime reports the required confirmation and audit controls.
4. Follow the Security link and verify the underlying group and permission
   assignment before granting broader MCP access.

## During an operation

- Use the Operations view to distinguish in-progress work from completed work.
- Do not retry a mutation merely because the UI has not yet refreshed; first
  check its operation or correlation identifier.
- Complete runtime confirmations only when the requested action, scope, and
  actor match the approved change.
- Use the Audit links to trace denials, confirmations, and completed mutations.

If MCP health, permission state, or audit state is unavailable, leave mutation
access disabled and repair the runtime connection before proceeding.

---

[Component guides](../README.md) · Imported from [lasso-serviceadmin](https://github.com/service-lasso/lasso-serviceadmin/blob/d018767c715c92719b8df69f64ebf5484ee0ba11/docs/help/mcp-operator-guide.md). The [migration inventory](../documentation-migration.md) records ownership and remaining work.
