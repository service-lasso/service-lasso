---
title: Beginner Todo app
---

# Beginner Todo app

Build the smallest useful Service Lasso result: a signed-in Todo list that survives a browser refresh.

**Success check:** you can sign in, create a todo, refresh the page, and still see that todo.

This guide is the primary newcomer path. The [Admin and Echo demo](../quick-start.md) remains a visual introduction to Service Admin; it is not a substitute for this Todo journey.

## What you will do

1. Start Service Lasso.
2. Open Service Admin and confirm it is healthy.
3. Create a simple Todo app.
4. Add login.
5. Run it locally and verify persistence.

You need **Node.js 22+**, **npm**, **Git**, and internet access for the first download of service releases.

## 1. Start Service Lasso

From a terminal:

```sh
git clone --branch develop https://github.com/service-lasso/service-lasso.git
cd service-lasso
npm ci
npm run demo
```

Keep this terminal open. The demo builds the runtime, uses the checked-in `services/` manifests, and keeps state under `workspace/demo-instance/`.

The first start downloads releases and takes longer than later starts.

## 2. Open Admin and confirm it is healthy

Open **[http://127.0.0.1:17700/](http://127.0.0.1:17700/)**.

On a fresh workspace:

1. Complete first-run setup.
2. Use both copy buttons on the credential screen, save the token and recovery material privately, tick **I saved this token**, and continue.
3. Sign in with the saved local credential or the offered local session.

Confirm Admin is usable:

- the home or services view loads without a setup blocker;
- at least the baseline managed services appear;
- you can open a service detail page and see status (for example `echo-service`).

If setup finished but services stay stopped, from a second terminal in the same checkout run:

```sh
npm run demo:recycle
```

Do not paste vault tokens, recovery material, or passwords into chat, tickets, or docs. See [Complete first-run setup](../complete-first-run-setup.md) and [Vault setup and key custody](../reference/vault-key-bootstrap.md).

## 3. Create a simple Todo app

You want a host app that shows its own UI (the Todo list) while Service Lasso manages supporting services and exposes Service Admin.

Fastest starting shapes:

- Clone the [`service-lasso-app-node`](https://github.com/service-lasso/service-lasso-app-node) template when you want a small Node host you own.
- Or keep using this Core checkout's demo Admin for operators and add an app-owned `services/` inventory next to your Todo UI, following [Reference apps](../reference-apps.md).

In the host app:

1. Add a Todo page with create and list.
2. Store todos in an app-owned store for this beginner slice (for example a JSON file under the app's workspace). Database durability is the next article, not this one.
3. Keep Service Admin reachable from the same local run so you can check service health while you develop.

Validate in Service Admin that any services your Todo host declares appear under **Services**, show runtime state under **Runtime**, and resolve endpoints under **Network**. See [How to create a basic service](../components/service-admin/how-to-create-a-basic-service.md) when you add a managed dependency later.

## 4. Add login

Use the local operator identity from first-run for this beginner path:

1. Sign out of Service Admin (or open a private browser window).
2. Sign in again with the saved local credential.
3. Confirm the Todo host only serves the list UI after the same local session boundary you chose for development (cookie/session shared with Admin, or an explicit login gate in the host that reuses the local identity story).

Do not invent a second password store for this exercise. Distributed or SSO login is a later integration; see [ZITADEL consumer integration](../reference/zitadel-consumer-integration.md) when you outgrow local-only login.

## 5. Verify: sign in, create, refresh, persist

With Lasso and the Todo host running:

1. Sign in.
2. Create a todo with a unique title.
3. Confirm it appears in the list.
4. Refresh the browser.
5. Confirm the same todo is still present.

**Pass:** the todo survives refresh without recreating it.

**Fail:** an empty list after refresh means the app is only holding memory for the request or the store path is not writable. Fix the store, restart the host, and repeat the five checks. Do not skip ahead to PostgreSQL until this refresh check passes.

## Stop

Stop the Todo host with its documented stop command. Stop the demo with `Ctrl+C` in the demo terminal (or the demo's documented stop/recycle flow). Local demo state remains under `workspace/demo-instance/` unless you deliberately clear it.

## Next

Make the same Todo durable with a managed database: [Make the Todo app durable](make-todo-app-durable.md).

Optional visual tour of Admin + Echo: [Quick start](../quick-start.md).
