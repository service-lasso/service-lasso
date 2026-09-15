# Network and Service Routes Operator Guide

Status: metadata-only. Network and Service Routes read endpoint, URL, route,
and exposure metadata from the Service Lasso runtime service list. Treat the
rows as configured reachability evidence unless a runtime health check or
direct endpoint probe proves the endpoint is currently reachable.

Use this guide with [How to Create a Basic Service](how-to-create-a-basic-service.md),
[Runtime and Logs Operator Runbook](runtime-and-logs-operator-runbook.md), and
[Health Checks](health-checks.md) when a service is healthy but a URL, port, or
route does not behave as expected.

## When to Use Network or Service Routes

Use Network when you need an endpoint inventory by service. It is the fastest
place to compare service labels, rendered URLs, bind addresses, ports,
protocols, and exposure. Use it when a service should expose a local web UI,
API, callback, debug port, or LAN URL and you need to verify what Service Admin
knows about that endpoint.

Use Service Routes when you need route-oriented evidence. It groups endpoint
metadata into route host, path, provider, target, routing state, config source,
and service status. It is the better first stop when a router or edge service
such as Traefik is expected to publish or forward a route.

Use Runtime first when the Service Admin runtime API itself is unavailable. Use
Services first when the question is lifecycle state, supported actions, or
service identity rather than reachability.

## Endpoint Fields

Each Network row describes one endpoint advertised by service metadata:

| Field | How to interpret it |
| --- | --- |
| Label | Human-facing endpoint name, such as Admin UI, API, Health, Metrics, or Debug. Labels are operator hints and should match the service docs or manifest intent. |
| URL | Rendered endpoint URL. It may include host, port, path, query, or scheme metadata. A rendered URL is not proof that the endpoint responded to a request. |
| Bind | Host or interface where the service expects to listen, such as `127.0.0.1`, `0.0.0.0`, a LAN address, or a service hostname. |
| Port | TCP or UDP port associated with the endpoint. Check it against `service.json`, runtime config, and other local processes when reachability fails. |
| Protocol | The scheme or transport, commonly `http`, `https`, `tcp`, or another service-specific protocol. Protocol mismatches often look like unreachable or invalid endpoints. |
| Exposure | The intended reachability class: `local`, `lan`, or `public`. Exposure is an intent marker from metadata, not a security scan. |

Service Routes shows additional route fields:

| Field | How to interpret it |
| --- | --- |
| Host / path | Parsed route host and path from the endpoint URL. Invalid URLs are marked as invalid route metadata. |
| Target | Runtime-facing target, usually service id plus port. Use it to compare router config with the service that should receive traffic. |
| Routing | Derived route state from URL validity and service status. It does not replace a live request check. |
| Provider | The route publisher or source. Public exposure is commonly associated with Traefik; local and LAN entries are normally Service Lasso runtime metadata. |
| Config source | The manifest or runtime metadata source that supplied the route. Use it when the row needs to be corrected in `service.json` or generated config. |

## Exposure Meanings

`local` means the endpoint is intended for the local machine or local Service
Lasso runtime boundary. Local endpoints normally bind to `127.0.0.1`,
`localhost`, a loopback-only socket, or a runtime-internal target. Do not share
local URLs as LAN or public evidence.

`lan` means the endpoint is intended to be reachable from the local network.
LAN exposure often binds to `0.0.0.0` or a specific LAN interface and uses a
host or IP address that other machines on the network can reach. Confirm host
firewall rules, bind address, service state, and router rules before treating
LAN reachability as proven.

`public` means metadata says the route may be externally reachable, often
through a router, tunnel, reverse proxy, or edge service such as Traefik. Public
exposure needs the highest caution: confirm TLS, authentication, allowed hosts,
firewall posture, and intended audience before sharing the URL or enabling
actions behind it.

If exposure and bind disagree, trust the safer interpretation until corrected.
For example, a `public` endpoint that binds only to `127.0.0.1` is not proven
public. A `local` endpoint bound to `0.0.0.0` deserves review because it may be
reachable beyond the current machine.

## Service Links Versus Runtime Endpoints

A service link is a human-facing shortcut to documentation, a homepage, a
console, source material, or another external reference. It may help an
operator learn about the service, but it is not necessarily part of the running
Service Lasso instance.

A runtime endpoint is operational metadata for a running or managed service. It
usually has a bind, port, protocol, URL, and exposure. Runtime endpoints are the
rows Network and Service Routes use for reachability triage.

When debugging reachability, prefer runtime endpoints over generic service
links. If the only available URL is a vendor homepage, release page,
documentation page, or artifact download, it should not be treated as a local
service endpoint.

## Route Surfaces and Edge Providers

Service Routes makes router-facing questions easier to answer:

- Which service owns this host, path, and target?
- Is the URL syntactically valid?
- Is the service running, degraded, stopped, or unavailable?
- Did metadata mark the route local, LAN, or public?
- Does the provider look like runtime metadata or an edge service such as
  Traefik?
- Which config source should be corrected when the route is wrong?

For Traefik or another edge provider, compare Service Routes with the provider
configuration. The route host, path, target service id, target port, protocol,
TLS posture, and exposure should all agree. If Service Routes shows `public`
but the edge service has no matching router, middleware, certificate, or
service target, the public route is not proven active.

## Port Collisions and Unreachable URLs

When an endpoint or route is unreachable, check in this order:

1. Open Runtime and confirm the runtime API is healthy enough to report fresh
   service metadata.
2. Open Services and confirm the affected service id, lifecycle state, health,
   and recent action result.
3. In Network, compare label, URL, bind, port, protocol, and exposure.
4. In Service Routes, compare host, path, target, provider, route state, and
   config source.
5. Check whether another process already owns the port or whether two service
   manifests declare the same bind and port combination.
6. Confirm the service is listening on the advertised interface. A service
   listening on `127.0.0.1` will not accept LAN traffic unless a proxy or route
   forwards it.
7. Confirm the URL uses the correct protocol. An `https` URL against a plain
   `http` listener, or a browser request to a raw TCP port, will fail even when
   the port is open.
8. Check Health Checks and Logs for readiness failures after the process starts.
9. For LAN or public exposure, check firewall rules, host allowlists, reverse
   proxy/router state, DNS, TLS certificates, and upstream target mapping.

Common signs:

| Symptom | Likely check |
| --- | --- |
| Service is healthy but URL does not load locally | Compare protocol, bind, port, and path. Then check service logs for listener startup lines. |
| Works on the host but not from another LAN machine | Check exposure, bind address, host firewall, LAN IP, and whether the URL uses `localhost`. |
| Public route returns a router error | Compare Service Routes target and provider config, then check Traefik route, middleware, certificate, and upstream service target. |
| Browser opens a download or documentation page | Confirm the row is a runtime endpoint, not a service link or artifact URL. |
| Route state is invalid | Fix malformed URL metadata in `service.json` or generated runtime metadata. |
| Two services fight for one port | Assign a distinct port, update `service.json`, reload runtime metadata, and recheck Network. |

## How Network Relates to `service.json`

Network and Service Routes are only as accurate as the service metadata that
the runtime discovers. For simple services, the primary port usually comes from
`service.json` `execconfig.serviceport`. More complex services may advertise
secondary endpoints, console URLs, debug ports, route metadata, or provider
links through additional manifest fields or generated runtime metadata.

When a row is wrong, fix the source metadata rather than the UI row. Check:

- service id and folder name
- `execconfig.serviceport`
- environment variables that supply the port, host, path, or URL
- generated config created by the service `config` action
- router labels or provider config for Traefik-style routes
- service health checks that should prove readiness for the advertised URL

After editing metadata, reload or restart the runtime path required by the
service package. Then re-open Network, Service Routes, Services, Runtime, and
Health Checks to confirm the new contract is visible and coherent.

## Security Expectations

Keep route evidence metadata-only. Do not paste raw credentials, tokens,
cookies, private keys, request bodies, response bodies, recovery material, or
environment values into tickets, Help Center examples, logs, or support notes.

Before treating LAN or public exposure as intentional, confirm:

- authentication is required where the service needs it
- TLS is enabled for public browser or API routes
- debug, admin, metrics, and health endpoints are not exposed more widely than
  intended
- router middleware, host allowlists, and firewall rules match the declared
  exposure
- the URL does not embed secrets, tokens, or private query parameters
- public routes have an owner, expected audience, and rollback path

When exposure is uncertain, classify the route using the narrowest safe scope
and escalate with service id, endpoint label, URL host, bind, port, protocol,
exposure, route provider, health state, timestamp, and the check already run.

---

[Component guides](../README.md) · Imported from [lasso-serviceadmin](https://github.com/service-lasso/lasso-serviceadmin/blob/d018767c715c92719b8df69f64ebf5484ee0ba11/docs/help/network-and-service-routes-operator-guide.md). The [migration inventory](../documentation-migration.md) records ownership and remaining work.
