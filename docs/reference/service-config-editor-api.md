# Service config editor API

Service Admin uses the runtime-backed config editor API to read and update a service's manifest file as `server.json`.

## Endpoints

`GET /api/services/{serviceId}/config`

- Returns the current service manifest content, file path, SHA-256 hash, update time, backup count, revision list, and safety metadata.
- The runtime response is limited to the service manifest file and does not include resolved environment values, provider credentials, authorization headers, or runtime-only process state.

`PUT /api/services/{serviceId}/config`

- Accepts `{ "content": "<json string>", "actor": "<optional>", "reason": "<optional>" }`.
- Fails closed unless `content` parses as a JSON object.
- Creates a backup revision of the previous manifest before replacing the current manifest.
- Writes through a temporary file and rename so failed writes do not partially replace the manifest.

`GET /api/services/{serviceId}/config/backups`

- Returns backup revisions for the service, newest first.
- Revision records include id, creation time, actor, optional reason, backup path, previous hash, current hash, validation status, and previous content for compare views.

## Safety

- The editor API is scoped to the discovered service's own `service.json` manifest path.
- Backup files are stored under the runtime workspace in `service-config-backups/{serviceId}/`.
- Raw secret values, resolved environment values, provider credentials, authorization headers, request bodies from other APIs, and runtime-only process state must not be added to these responses.
