---
title: Getting started
---

# Getting started

Newcomer path for Service Lasso. Do these in order.

| Level | Guide | What you prove |
| --- | --- | --- |
| Beginner | [Todo app](beginner-todo-app.md) | Lasso runs, you sign into Admin, then create a todo and confirm persistence |
| Intermediate | [Make the Todo app durable](intermediate-make-todo-app-durable.md) | The same app keeps data in a managed PostgreSQL service across stop/start |
| Advanced | [Add a Go Todo API service](advanced-add-go-todo-api-service.md) | A new managed Go web API sits between the Todo UI and the database |
| Advanced | [Add Zitadel SSO to Todo](zitadel-sso-hub.md) | Add managed Identity, sign into Todo, protect reads/writes and verify logout while retaining the shared list |
| Advanced | [Package Todo as a desktop app](package-todo-tauri.md) | Wrap the managed App, API and Database in the Tauri template and compile a Windows installer |
| Advanced | [Provision secrets as RAM files](advanced-provision-service-secrets-securely.md) | Windows: declare a Broker-backed RAM file, read it with Echo, inspect usage and verify recreation/revocation |
| Advanced | [Proxy FastCGI services with Caddy](advanced-proxying-services-with-caddy.md) | Windows: publish Echo by host name through the shared Caddy translator, the same route FastCGI apps use behind Traefik |
| Optional demo | [Quick start](../quick-start.md) | Visual Admin + Echo tour |

After that: [Configure and recover a service](../operate-your-service.md), [package your app](../package-your-app.md), or [browse services](../service-catalog.md).
