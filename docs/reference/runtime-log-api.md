---
title: Runtime Log API
---

# Runtime Log API

Service Lasso exposes runtime-owned service logs through read-only API routes for admin consumers.

## Log metadata

`GET /api/services/log-info?service=<serviceId>&type=default`

Returns the current combined runtime log path and available log types. The only supported type in this slice is `default`.

## Paged reads

`GET /api/logs/read?service=<serviceId>&type=default&limit=100&before=<lineNumber>`

Reads the current combined runtime log with a bounded line limit. `before` is a line-number cursor; omit it for the latest page. The response includes `start`, `end`, `hasMore`, and `nextBefore` so callers can continue backward without rereading the whole file.

## Bounded search

`GET /api/logs/search?service=<serviceId>&type=default&query=<text>&limit=50&includeArchives=true`

Search is a case-insensitive substring search, not a regular expression. It is bounded to at most 100 matches per request and returns truncated message snippets with source metadata:

- `source`: `current` or `archive`
- `archiveId`: archive identifier when the match came from a retained archive
- `lineNumber`: one-based line number inside the source log
- `level`: parsed `stdout`, `stderr`, or `unknown`
- `snippet`: at most 240 characters
- `truncated`: whether the snippet was shortened

Archive search is opt-in with `includeArchives=true`; the default searches only the current combined runtime log.
