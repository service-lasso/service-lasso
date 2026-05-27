# Runtime port reservation ledger

Service Lasso persists runtime port reservations under `workspaceRoot/runtime/port-reservations.json`.

The ledger is separate from service manifests. It records the ports the current runtime considers reserved before install/config/start state is mutated, so a restarted API instance can rehydrate prior allocations and avoid assigning a service port over another runtime or service listener.

## Reservation records

Each reservation contains:

- `host`: listener host, defaulting to `127.0.0.1`
- `port`: TCP port number
- `kind`: `api`, `service-fixed`, or `service-negotiated`
- `ownerId`: `runtime-api` for the API server or the service id for service-owned ports
- `portName`: logical port name such as `http`, `admin`, or `service`
- `createdAt` and `updatedAt`: ISO timestamps
- `stale` and `staleReason`: optional reconciliation evidence when a previous reservation is no longer present in rehydrated runtime state

Reservation writes fail closed when a live, non-stale `host:port` is already owned by a different API/service reservation.

## Reconciliation model

At runtime startup, callers should build the active set from:

- the API listener port
- service-declared fixed ports
- service runtime ports rehydrated from `.state/runtime.json`

Reconciliation keeps active reservations fresh and marks missing historical entries stale instead of deleting them. Stale evidence gives operators a safe recovery path without silently forgetting why a port was previously considered unavailable.

## Conflict explanation API

`GET /api/runtime/ports/conflict?port={port}&host={host}&serviceId={serviceId}&portName={portName}` is a read-only operator diagnostic for a requested service port.

Required query:

- `port`: integer TCP port from `1` to `65535`

Optional query:

- `host`: listener host to test, defaulting to `127.0.0.1`
- `serviceId`: requesting service id for context
- `portName`: requesting logical port name for context

The response reports:

- `conflict`: whether the requested `host:port` is currently unavailable
- `reason`: `ledger_reserved`, `live_listener`, or `none`
- `owner`: safe Service Lasso ledger owner details when a non-stale reservation owns the port
- `ledger.activeReservations` and `ledger.staleReservations`: safe ledger evidence for the requested port
- `liveListener`: whether a bounded bind probe found an occupied listener
- `remediation`: safe operator hints such as stopping the owning service/runtime instance, choosing another port, or running reconcile/doctor flow

The endpoint must not expose process IDs, command lines, environment values, credentials, or raw diagnostics payloads. Unknown live listeners are reported only as occupied `host:port` evidence.
