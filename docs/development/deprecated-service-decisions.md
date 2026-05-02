---
unlisted: true
---

# Deprecated Service Decisions

This page records explicit migration decisions for reviewed service examples that should not appear in the active Service Catalog.

## ISS-342: disabled WebSocket examples

Decision: deprecated and superseded.

The reviewed WebSocket examples are not active Service Lasso services and should not be migrated into new `lasso-*` repos:

| Source example | Decision | Reason |
| --- | --- | --- |
| `wsecho` | Deprecated | It was disabled in the source service set, is a Python/FastAPI WebSocket echo demo, and overlaps with the maintained [`service-lasso/lasso-echoservice`](https://github.com/service-lasso/lasso-echoservice) lifecycle harness. |
| `messageservice-client` | Deprecated | It was disabled in the source service set, is a Python/FastAPI message-client demo, and overlaps with the maintained [`service-lasso/lasso-totaljs-messageservice`](https://github.com/service-lasso/lasso-totaljs-messageservice) and [`service-lasso/lasso-totaljs-flow`](https://github.com/service-lasso/lasso-totaljs-flow) messaging examples. |

Current replacement path:

- Use [`service-lasso/lasso-echoservice`](https://github.com/service-lasso/lasso-echoservice) when a test harness needs echo behavior, service actions, logs, state, SQLite, health toggles, or lifecycle/failure simulation.
- Use [`service-lasso/lasso-totaljs-messageservice`](https://github.com/service-lasso/lasso-totaljs-messageservice) and [`service-lasso/lasso-totaljs-flow`](https://github.com/service-lasso/lasso-totaljs-flow) when a project needs the maintained messaging/flow example set.

Catalog impact:

- Do not list `wsecho` or `messageservice-client` in the Service Catalog.
- Do not create `service-lasso/lasso-wsecho` or `service-lasso/lasso-messageservice-client` repos unless a future issue defines a distinct product need that is not already covered by Echo Service or the Total.js services.
- No implementation follow-up is required for ISS-342.
