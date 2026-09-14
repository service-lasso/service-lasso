---
title: Add PostgreSQL and connect an app
---

# Add PostgreSQL and connect an app

Give a small Node app its own managed database. You will install a released service, start it through Service Lasso, write and read a row, and open the app. Try the [Admin and Echo demo](quick-start.md) first if you want a visual introduction.

## Run the example

You need Node.js 22+, npm, Git, and internet access. From your Service Lasso checkout:

```sh
cd examples/postgres-app
npm ci
npm run setup
npm start
```

The example supplies a small foreground launcher for the pinned package: it initializes an empty directory and keeps the database process attached so Lasso can verify ownership. The PostgreSQL binaries remain the released artifact.

Setup imports PostgreSQL **15.17**, release **2026.5.3-ddd9e47**, into this example's own `workspace/services`. It pins the artifact tag and installs the package for your platform. The runtime and database state stay under this example's `workspace/`. The example uses the published npm runtime pinned in its lockfile.

The terminal prints the app URL and the **actual allocated database port**. Open [http://127.0.0.1:18552](http://127.0.0.1:18552). Expect `"database":"connected"`.

In a second terminal in the same example folder:

```sh
npm run check
```

**Success:** `PASS: database write + read and app HTTP response.` Refresh the app to see `Hello from Service Lasso`. This checks a real database round trip, not just an open port.

## What did Lasso do?

The [example source](https://github.com/service-lasso/service-lasso/tree/develop/examples/postgres-app) imports a service manifest, downloads its release, configures it, waits for readiness, and records its process and allocated endpoints. Your app uses a normal PostgreSQL driver. It does not need to know how to install or launch PostgreSQL.

| Connection field | This example |
| --- | --- |
| Host | `127.0.0.1` |
| Port | Printed by `npm start`; read from the running service's state |
| Database | `postgres` |
| User / password | `pgadmin` / `pgadmin`, public local tutorial defaults |

Keep this example on loopback. These credentials are for trying the released package locally; use [secret references and access policies](reference/service-secret-access-policy.md) for an application you distribute.

## Change a setting

1. Stop with `npm run stop` in the second terminal.
2. In `workspace/services/postgres/service.json`, add `"POSTGRES_MAX_CONNECTIONS": "120"` inside `env`. The example's foreground launcher passes this setting to PostgreSQL.
3. Run `npm start`, then `npm run check` again.

The check should now print `PostgreSQL max_connections: 120` as well as the passing database check. The app reads the runtime allocation rather than assuming the preferred port was available. The example API uses fixed port `18550` and the app uses `18552`; if either is occupied, stop this example's previous run or choose another environment. Do not kill an unrelated service.

To declare a secret rather than a literal environment value, follow [Configure and recover a service](operate-your-service.md). Changing a manifest password does not rotate an already initialized PostgreSQL account.

## Stop and keep your data

```sh
npm run stop
```

This stops this example's managed database and API. The app also closes when its runtime exits. `Ctrl+C` in the app terminal runs the same owned-workspace shutdown. Run `npm start` to resume; do not repeat setup or delete your database to restart.

## If it fails

Open `workspace/services/postgres/logs/runtime/service.log` and look at the last startup attempt. The pinned PostgreSQL release creates a placeholder under `runtime/data`; setup deliberately chooses `runtime/database`, because PostgreSQL requires an empty directory for first initialization. Preserve any existing database directory.

An app response of **503 / database unavailable** means the web process is alive but its dependency is unavailable. Check the database's health and logs, restore it, restart the example, and rerun the write/read check. See [diagnosis and recovery](operate-your-service.md).

Next: [package this app for another machine](package-your-app.md), [give the task to an agent](agent-prompts.md), or [browse more services](service-catalog.md).

[Measured results and platform limitations](development/newcomer-verification.md).
