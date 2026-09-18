---
title: Advanced — Add a Go Todo API service
---

# Advanced — Add a Go Todo API service

Insert a small **Go web API** between your Todo UI and PostgreSQL. Service Lasso manages that API as a normal service: install, start, health, endpoints, and logs. The browser talks to the Go API; the Go API talks to the database.

Complete first:

1. [Beginner — Todo app](beginner-todo-app.md)
2. [Intermediate — Make the Todo app durable](intermediate-make-todo-app-durable.md)

This article is a worked architecture + authoring guide. It shows the shape you should build. Pair it with the [Service authoring overview](../service-authoring/overview.md) when you turn the sketch into a released `lasso-*` package.

## Outcome

```text
Browser Todo UI
    -> Go Todo API  (managed service, HTTP JSON)
        -> PostgreSQL  (managed service from the intermediate guide)
```

Success checks:

- Service Admin shows the Go API service **healthy**
- `GET /healthz` on the API returns ok
- Todo UI create/list goes through the API, not straight to Postgres
- Refresh still shows todos (API + DB path)

## Why a Go API in the middle

- Keeps SQL and connection strings out of the browser
- Gives you a stable JSON contract for the Todo UI
- Lets Lasso own lifecycle, ports, and health for both API and database
- Is the smallest “add a new service” exercise that is still a real app shape

## 1. Plan the new service

Decide ownership:

| Piece | Owner |
| --- | --- |
| Todo UI / host app | Your app repo (`services/` inventory) |
| Go Todo API | New managed service (app-owned first; later a `lasso-todo-api` release repo) |
| PostgreSQL | Existing managed service from the intermediate example |

Name the service something stable, for example `todo-api`.

Follow [Plan the service](../service-authoring/01-plan-service.md): managed daemon, HTTP endpoint, depends on PostgreSQL.

## 2. Build a minimal Go webserver API

Create a small module (sketch):

```text
todo-api/
  go.mod
  main.go
  service.json   # when you wire it for Lasso
```

`main.go` responsibilities:

1. Read listen address and database URL from environment (Lasso injects these).
2. Serve JSON over HTTP:
   - `GET /healthz` — process up (and optionally DB ping)
   - `GET /todos` — list todos
   - `POST /todos` — create a todo `{ "title": "..." }`
3. Use the normal PostgreSQL driver against the allocated DB endpoint.
4. Do **not** open Admin ports or embed Service Admin in this binary.

Example shape (illustrative):

```go
// Listen on TODO_API_ADDR (for example 127.0.0.1:18600).
// Connect with DATABASE_URL from Lasso-resolved Postgres endpoint + secrets.
// GET /healthz -> 200 {"status":"ok"}
// GET /todos   -> 200 [{"id":"...","title":"..."}]
// POST /todos  -> 201 {"id":"...","title":"..."}
```

Keep the first cut single-binary, loopback-only, no public TLS. Production packaging comes from the service-template release path later.

## 3. Write `service.json` for the Go API

Minimum ideas to encode (exact fields: [service.json reference](../reference/service-json-reference.md)):

- Identity: `id`, `name`, `serviceType`, `runtime`, `version`
- Start command: run the Go binary (or `go run` only for a private local spike — prefer a built artifact for anything you share)
- `endpoints[]` for the HTTP API (for example `web`)
- `env` that binds:
  - listen address from `${endpoint.web...}`
  - database host/port/user/password from the Postgres service selectors / secret policy
- Health check against `GET /healthz`
- Dependency on the Postgres service so Lasso starts DB before API

Validate in Service Admin after install: **Services**, **Runtime**, **Network**, logs on failure. See [How to create a basic service](../components/service-admin/how-to-create-a-basic-service.md).

## 4. Point the Todo UI at the API

Change the beginner Todo host so it:

1. Stops talking to Postgres (or a local JSON file) directly for create/list
2. Calls the Go API base URL from config / allocated endpoint
3. Still uses the same login / local session story from the beginner guide

Verify:

1. Sign in
2. Create a todo in the UI
3. Confirm `POST /todos` hits the Go API (API logs or a quick `curl`)
4. Refresh the UI — todo still present
5. Stop and start the Go API service in Admin — UI recovers once healthy

## 5. Promote from sketch to released service (when ready)

When the local spike works:

1. Create a `lasso-todo-api` (or similar) repo from [`service-template`](https://github.com/service-lasso/service-template)
2. Publish release artifacts with the Go binary for your platforms
3. Pin that release in the Todo app’s `services/todo-api/service.json`
4. Run [Validate and release](../service-authoring/05-validate-release.md)

Until that exists, keep the Go API as an app-owned service folder under your Todo host’s `services/` inventory.

## Boundaries

- Do not put Postgres credentials in frontend code
- Do not skip health checks on the Go API
- Do not treat `go run` + laptop paths as a release
- Do not bypass Lasso and start the binary by hand for the “managed service” proof — Admin start/stop is part of the exercise

## Next

- [Wire consumers](../service-authoring/04-wire-consumers.md)
- [Package your app](../package-your-app.md)
- [Service catalog](../service-catalog.md)
