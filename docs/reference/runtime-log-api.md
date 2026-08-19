---
title: Runtime Log API
sidebar_label: Runtime Log API
---

# Runtime Log API

Service Lasso exposes runtime-owned service logs through bounded read and search endpoints. The endpoints only read the selected service's managed runtime log files; they do not search arbitrary workspace paths.

## Log metadata

~~~text
GET /api/services/log-info?service=<serviceId>&type=default
~~~

Returns the current combined runtime log path, supported log types, declared/discovered sources, and the fail-closed stdin advertisement for Terminal. `type=combined` is an alias for `default` (logs/runtime/service.log).

`stdin` and `capabilities.stdin` are the same object. `available` is true only when `service.json` opts in with `stdin.enabled` and the live managed process still has a writable stdin pipe. Services that do not opt in, adopted processes, and ignored stdio stay `available: false`.

## Safe stdin write

~~~text
POST /api/services/<serviceId>/stdin
~~~

Writes one bounded UTF-8 line to the managed process stdin pipe. This is not a PTY or shell. The body is:

~~~json
{
  "input": "ping",
  "stream": "stdin",
  "actor": "service-admin-web"
}
~~~

`input` must be a non-empty string of at most 2048 characters and must not contain null bytes. `stream`, when present, must be `stdin`. The runtime appends a trailing newline when the caller omits one.

The response is `{ serviceId, accepted, auditId, message }`. Audit records byte length and outcome only; raw stdin, tokens, and secret values are never stored.

`node-sample-service` opts in and accepts documented commands: `help`, `ping`, `status`, and `emit <message>`.

## Paged reads

~~~text
GET /api/logs/read?service=<serviceId>&type=default&limit=<n>&cursor=<cursor>
~~~

limit defaults to 100 and is clamped to 1..500. cursor is the opaque continuation value returned from nextCursor. The legacy before query still accepts a numeric line number for compatibility.

The response includes:

- lines: truncated raw line text for compatibility with existing consumers.
- entries: structured line metadata with source.kind, source.path, source.lineNumber, stream, message, text, and truncated.
- cursor / nextCursor: continuation values for reading older lines.
- hasMore: whether another page is available.

Line text and parsed messages are truncated to 2000 characters per field so large log writes cannot create unbounded API payloads.

## Search

~~~text
GET /api/logs/search?service=<serviceId>&type=default&q=<text>&limit=<n>&cursor=<cursor>&includeArchives=true
~~~

Search uses a bounded case-insensitive substring match. It does not evaluate regular expressions. limit defaults to 50 and is clamped to 1..100; query text is capped at 200 characters. cursor continues from the previous nextCursor.

By default search scans only the current logs/runtime/service.log. Set includeArchives=true to also scan retained combined logs under logs/archive/*/service.log. Archive retention is still governed by the runtime log retention policy.

The response includes the normalized query, whether archives were included, totalScanned for the page, matches, and nextCursor when more service-owned log lines remain.
