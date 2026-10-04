---
title: Advanced — Add a Go Todo API service
---

# Advanced — Add a Go Todo API service

Continue the managed [Todo](beginner-todo-app.md) and
[PostgreSQL](intermediate-make-todo-app-durable.md) lessons. Add a Go API as the
third application service in the same Service Lasso inventory. Keep the Todo UI
service, move database access into the API and learn dependency chains and
managed API recovery.

## Outcome

**Stage 3: Add a managed Go API.** The Todo app runs inside Service Lasso from
the first lesson. Every application process shown inside the boundary is managed
by Lasso; the browser connects to the Todo service's allocated web endpoint.

```mermaid
%%{init: {"flowchart": {"nodeSpacing": 12, "rankSpacing": 40}}}%%
flowchart TB
  accTitle: Stage 3: Add a managed Go API
  accDescr: Service Lasso manages the Todo app from stage one alongside baseline apps. Stage two adds PostgreSQL. Stage three adds a Go API between the Todo service and database. JSON storage belongs to the Todo service and is not a separate service.
  browser["Browser Todo UI"]
  subgraph lasso["Service Lasso"]
    baseline["Baseline apps<br/>Service Admin<br/>Secrets Broker<br/>Echo / Node provider"]
    todo["lasso-todo<br/>Todo service<br/>UI + API proxy"]
    api["Go Todo API service"]
    db[("PostgreSQL service<br/>Persisted Todo data")]
  end
  browser -->|HTTP| todo
  todo -->|HTTP JSON| api
  api -->|SQL| db
  classDef added fill:#e0f2fe,stroke:#0369a1,color:#0c4a6e
  class api added
```

Blue highlights what this lesson adds. Solid arrows show application traffic.
Service Admin operates the services in the boundary; Lasso installs, starts,
stops, allocates ports and monitors their health. The JSON file in stage 1 is
Todo service data, not another service. Other runtime support packages are omitted.

The browser uses the Todo service on the same origin. Its proxy calls the API's allocated HTTP endpoint; only the API talks to PostgreSQL in this stage.

## 1. Inspect and package another template-derived service

Use Go1.22+ and Node22+. In your Core checkout terminal:

```powershell
git clone --branch develop --single-branch https://github.com/service-lasso/lasso-todo-api.git ../lasso-todo-api
gh api repos/service-lasso/lasso-todo-api --jq '.template_repository.full_name'
npm --prefix ../lasso-todo-api ci
npm --prefix ../lasso-todo-api test
npm --prefix ../lasso-todo-api run package
npm --prefix ../lasso-todo-api run verify
```

The query must print <code>service-lasso/service-template</code>. This separate service repository owns real Go source, manifest, packaging, verification and CI. Its template package/test/verify entrypoints are adapted for Go.

| Manifest field | What this service adds |
| --- | --- |
| id: todo-api | A separately managed API |
| artifact.platforms | Native archive and command matching the packaged binary |
| depend_on: postgres | Start the database before its consumer |
| endpoints.web | An allocated loopback HTTP API |
| env | API port and actual PostgreSQL runtime allocation |
| healthchecks | HTTP readiness includes a real database ping |

[Go source](https://github.com/service-lasso/lasso-todo-api/blob/develop/src/main.go) implements health, create/list and parameterized SQL using the same <code>tutorial_todos</code> table as stage two. The API limits titles to 200 bytes; a long non-ASCII title can therefore receive an API validation error even when the UI's character check accepts it.

Local verification checks native archive structure. Real SQL verification uses <code>TODO_VERIFY_DATABASE_STATE</code>; CI separately executes the held Linux archive against PostgreSQL. Compilation does not qualify runtime behavior on other platforms.

## 2. Import the API and switch Todo to its proxy

Stop Todo in Admin, preserving data. From Core:

```powershell
node dist/cli.js services import service-lasso/lasso-todo-api --tag 2026.10.4-9b45f09 --services-root workspace/canonical-services-root --workspace-root workspace/demo-instance
node ../lasso-todo/scripts/configure-stage.mjs workspace/canonical-services-root/todo api
```

Refresh Admin. Install/Configure the API, then start PostgreSQL, API and Todo in dependency order, waiting for healthy. Lasso acquires the pinned checksum-verified native binary and supplies ports, environment, ownership and health. Todo reads the API's runtime allocation when it starts. Do not launch the Go binary manually.

```text
Todo → Go Todo API → PostgreSQL
```

Inspect dependencies, acquired release/checksum, processes, logs and Network views. The browser receives no database credentials. Open Todo's resolved UI URL.

## 3. Verify the request path and recovery

1. Confirm todos from stages one and two remain.
2. Add another todo through the browser and refresh.
3. Find <code>Created todo through Go API</code> in API logs to prove the proxy path.
4. Stop only the API through Admin, confirming the action. Create/list must fail; inspect dependency health. A running proxy returns503 while the API is down.
5. Start the API, then Todo if needed, and confirm recovery with all saved IDs.
6. Stop Todo, API and PostgreSQL through Admin; restart in dependency order and confirm the complete set again.

**Pass:** three managed services recover without losing data and actual requests reach the acquired Go API. A separately launched binary is not a pass.

## What the template workflow gave you

Both application services own their GitHub template provenance, source, manifests, platform packages, tests, verification and explicit candidate publication. Consumer manifests pin real development prereleases. Source builds, acquired bytes, runtime evidence, docs publication and GA are separate claims. Follow [validate and release](../service-authoring/05-validate-release.md) when authoring your own service.

Stop services through Admin and keep data. Whole-demo shutdown/recycle remains unqualified [#1665](https://github.com/service-lasso/service-lasso/issues/1665). Next: [ZITADEL SSO Hub](zitadel-sso-hub.md), [wire consumers](../service-authoring/04-wire-consumers.md), or [package your app](../package-your-app.md).
