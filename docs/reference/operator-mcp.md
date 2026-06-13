# Operator MCP

Service Lasso exposes a first read-only operator MCP surface at `POST /api/mcp`, with discovery metadata at `GET /api/mcp`.

The MCP surface is intentionally scoped to inspection. It does not expose lifecycle actions, runtime orchestration, command confirmation execution, setup runs, update installs, or any other mutating operation.

## Tools

- `service_lasso_list_services`: safe service inventory, lifecycle booleans, dependencies, ports, and paths.
- `service_lasso_get_health`: health metadata for one service or all services.
- `service_lasso_list_routes`: route and port metadata for one service or all services.
- `service_lasso_dependency_status`: dependency readiness, blockers, and next-action metadata.
- `service_lasso_logs_summary`: bounded recent runtime log lines for one service.
- `service_lasso_diagnostics_summary`: dependency and secret-reference audit summaries.

## Resources

- `servicelasso://services`
- `servicelasso://health`
- `servicelasso://routes`
- `servicelasso://dependencies`
- `servicelasso://diagnostics`

## Redaction Boundary

MCP responses must not include raw secret values, provider tokens, passwords, private keys, cookies, broker payloads, or raw manifest `env`/`globalenv` values.

Route URLs strip username, password, query string, and fragment before returning to clients. Log summaries omit file paths and apply the diagnostics redactor to line text before serializing MCP content.
