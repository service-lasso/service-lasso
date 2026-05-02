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

## ISS-367: BPMN client sample

Decision: documented as client/API usage, not a managed service.

The reviewed `bpmn-client-sample` is a Node/TypeScript script that calls a running BPMN Server API. It is not an active Service Lasso service and should not become a `lasso-bpmn-client` repo because it has no daemon, manifest, healthcheck, release-backed runtime, service data path, or independent lifecycle contract.

Current replacement path:

- Use [`service-lasso/lasso-bpmn-server`](https://github.com/service-lasso/lasso-bpmn-server) for the managed BPMN Server daemon and MongoDB-backed workflow API.
- Use [`service-lasso/lasso-bpmn-server/blob/main/docs/client-sample.md`](https://github.com/service-lasso/lasso-bpmn-server/blob/main/docs/client-sample.md) for direct HTTP and optional `bpmn-client` npm usage examples.
- Put BPMN client scripts in the consuming app, test harness, setup step, or future one-shot job that owns the workflow behavior.

Catalog impact:

- Do not list `bpmn-client-sample` in the Service Catalog.
- Do not create `service-lasso/lasso-bpmn-client` unless a future issue defines a real managed runtime or job contract distinct from normal BPMN Server API usage.
- No implementation follow-up is required for ISS-367.
