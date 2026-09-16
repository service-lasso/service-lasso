---
title: Let an agent do the work
---

# Let an agent do the work

Copy one task below into your coding agent. It needs terminal and file access to install or build an app. For operating an existing runtime through MCP, use the connection section first.

## Connect an operator agent through MCP

Service Lasso exposes MCP at the runtime's `/api/mcp` endpoint, with discovery at `/api/mcp/info`. Use the runtime URL printed at startup; the normal demo API is `http://127.0.0.1:17883`. Admin also has an **MCP** page.

Follow [Operator MCP](reference/operator-mcp.md) for transport, identity, scopes, client configuration, and the exact tool inventory. Start with read-only access. Ask the client to list its available tools and verify runtime identity before using them. Guarded lifecycle actions require the configured permissions and server-issued confirmation flow; a prompt cannot grant those permissions.

MCP operates the connected runtime. It does not give an agent a general terminal, install a development environment, or write an application repository. Use a coding agent for those tasks.

## Try the demo

```text
Help me try Service Lasso. Follow https://github.com/service-lasso/service-lasso/blob/develop/docs/quick-start.md.
Check prerequisites, use an isolated folder, and preserve other running instances.
Start the demo, guide me through any credential-saving step, and open Admin.
Verify Echo responds, stop and start Echo, verify it again, then stop this demo.
Report the exact release/source, platform, download/start time, and observed results.
Never put credentials in screenshots, logs, or your response.
```

## Add a database and connect my app

```text
Follow https://github.com/service-lasso/service-lasso/blob/develop/docs/getting-started/beginner-todo-app.md then https://github.com/service-lasso/service-lasso/blob/develop/docs/getting-started/make-todo-app-durable.md.
Run the PostgreSQL app example in its own directory. Use its pinned dependencies
and released manifest. Run the real write/read check and show the app response.
Then explain the actual host, allocated port, and database my app should use.
Keep the tutorial credentials local, preserve existing data, and stop only this
example's processes when finished. Report failures rather than claiming success.
```

## Configure a service safely

```text
Follow https://github.com/service-lasso/service-lasso/blob/develop/docs/operate-your-service.md.
Identify my selected service and workspace before changing anything. Change one
requested setting or declare a secret reference with the minimum required grant.
Keep secret values out of source and responses. Validate, restart that service,
and repeat its functional check. Report the changed setting and recovery result.
```

## Diagnose through MCP

```text
Use the connected Service Lasso MCP tools to identify this runtime, list services,
and find unhealthy services. Inspect only the relevant health, log summary,
dependency, and recovery information. Do not reveal secrets or dump environments.
Explain the first actionable cause and the smallest recovery action. Stay read-only
until that action is authorized; use the server's confirmation flow if required.
After recovery, verify service readiness and the consuming application's behavior.
```

## Package my working app

```text
Follow https://github.com/service-lasso/service-lasso/blob/develop/docs/package-your-app.md.
Create a source archive of the working example. Inspect its contents and exclude
runtime state, credentials, databases, logs, and downloaded artifacts. Unpack into
a new directory, install, set up, start, and run the write/read check there.
Stop both owned examples. State which platform was tested and whether another
machine or offline operation was actually tested. Do not claim untested portability.
```

## Embed Lasso in an existing application

```text
Read https://github.com/service-lasso/service-lasso/blob/develop/docs/integration/README.md
and inspect my application before choosing an integration. Reuse the appropriate
reference app, give it an explicit service inventory and workspace, and connect
through allocated endpoints. Add one dependency, demonstrate a real application
operation, handle dependency failure, and verify shutdown. Explain the packaging
choice and prerequisites. Keep changes reviewable and preserve unrelated work.
```
