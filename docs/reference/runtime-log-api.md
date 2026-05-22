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

Returns the current combined runtime log path and the supported log types for a service. The only supported type is default, which maps to logs/runtime/service.log.

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
