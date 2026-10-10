# Broker-owned RAM WebDAV secret files

For a step-by-step Echo consumer and usage checks, follow
[Advanced - Provision Service Secrets Securely](../getting-started/advanced-provision-service-secrets-securely.md).
The service's `broker.files`/`broker.templates` declaration requests file delivery;
a Broker import alone does not. Core requests provisioning using scoped refs
and secret-free templates. Broker resolves internally and returns the WebDAV path.

Declared `broker.files[]` and `broker.templates[]` use
Broker-owned RAM WebDAV by default on every platform. Core sends declared
selector/ref bindings and secret-free templates through authenticated local IPC
with a fresh service/workspace/peer-bound launch lease. Broker resolves current
vault values internally, renders the files and returns their private directory.
File-only refs do not produce plaintext lookup responses to Core. Broker keeps the outputs
in its bounded memory store. It creates no plaintext filesystem outputs.
Direct environment-variable secret delivery remains supported.

```json
{
  "broker": {
    "imports": [
      {
        "namespace": "shared/database",
        "ref": "database.PASSWORD",
        "required": true
      }
    ],
    "files": [
      {
        "path": "db-password",
        "content": "${database.PASSWORD}"
      }
    ]
  },
  "env": {
    "DB_PASSWORD_FILE": "${SERVICE_LASSO_SECRETS_DIR}/db-password",
    "DB_PASSWORD": "${database.PASSWORD}"
  }
}
```

Before each fresh start or restart, Core prepares a new grant and passes its
directory through the declared service environment. Already-running/adopted
processes keep their existing grant. Broker replacement atomically invalidates
the previous grant for the same service/workspace/instance. Stop, observed exit
and ordinary spawn failure revoke the exact grant, without affecting a successor.
Broker restart loses all RAM grants; fresh app launch recreates them from the
current vault values. It does not generate a new vault value just because an
extracted file disappeared. If Broker IPC is unavailable, process stop still
completes and reports pending grant revocation; the capability stays in Core
memory for an explicit retry. Replacement or Broker restart invalidates it.
Core crash does not itself revoke Broker grants;
replacement or Broker restart invalidates them. No raw token or output enters
Core lifecycle state, materialization preimages or config drift.

Broker chooses an available port and binds its separate file listener strictly
to `127.0.0.1`. The authenticated IPC grant response supplies the actual port;
8080 is only an example. No administrator mount or drive mapping is required.
File delivery offers GET, HEAD, OPTIONS and depth 0/1 PROPFIND. File creation,
updates and revocation are available only over authenticated operator IPC.
Foreign Host/Origin, external peers, forwarding headers, traversal, write
methods and unbounded requests are denied. Anonymous root OPTIONS advertises
protocol methods only; it exposes no directory or file. Responses set no-store.

Each instance receives a fresh random 256-bit capability. Broker indexes its
SHA-256 digest and never logs token-bearing URLs. Treat paths as credentials:
keep them in the child environment, away from command arguments, globals,
operator screenshots and logs. Grant metadata validation rejects non-loopback
endpoints. File names use letters, digits, dot, underscore and hyphen in bounded
relative segments; traversal, absolute names, duplicates and directory/file
conflicts are rejected. Limits are 128 files, 256 KiB per file, 768 KiB per grant,
1024 live grants and 64 MiB of total file content. IPC requests remain bounded to
1 MiB. No disk fallback occurs if RAM delivery is unavailable.

On Windows the supplied directory has this form:

```text
\\127.0.0.1@<port>\DavWWWRoot\<token>
```

On Linux and macOS Core supplies the HTTP directory:

```text
http://127.0.0.1:<port>/<token>
```

Linux file managers can use `dav://127.0.0.1:<port>/<token>/`. HTTP/DAV-capable
apps can consume the supplied URL directly. A URL is not a POSIX filesystem path.
Windows UNC consumption requires Windows WebClient support under the service's
account. A native Windows WebClient read through the token path passed under
the qualification account without drive mapping. App handling after receiving a secret is outside the
delivery contract.

For an HTTP client using headers, send `Authorization: Bearer <token>` to
`http://127.0.0.1:<port>/files/<relative-path>`. Native WebDAV clients use the
capability-path form because they do not offer arbitrary Bearer headers.

Core's production Broker control API stays on its authenticated Unix socket or
Windows named pipe. This read-only listener does not expose the control API.
The new delivery requires a Broker build with `/v1/file-grants`; an older Broker
fails before app spawn. Source landing is separate from release publication.

For apps requiring a native Linux filesystem path, explicitly select
`SERVICE_LASSO_SECRET_FILES_TRANSPORT=tmpfs` and follow
[Linux tmpfs setup](linux-app-secret-files.md). The default `webdav` profile
requires no tmpfs configuration. Environment-secret delivery works in either
profile.

Verification maps SPEC-011 ESM-7..10 to
`tests/ram-webdav-secret-files.test.js`, including an actual production Broker,
peer-bound Unix IPC, fresh managed-child HTTP reads, environment compatibility,
replacement rotation, stop revocation and persisted-state privacy. Broker issue
#196 owns its real HTTP isolation, safety and bounds tests. These checks do not
claim qualification of all Windows service accounts, packaged release or deployment.

## Inventory and consumer example (#1738)

Service Admin exposes **Secrets Broker -> RAM files**, also in the Broker
service Secrets tab. The authenticated workspace-read route is
`GET /api/services/%40secretsbroker/operations/webdav?limit=100&cursor=0`,
forwarded to Broker `GET /v1/file-grants/status`. It reports listener state,
active grant/file counts, RAM capacity/use, service ownership, names, sizes,
completed downloads, served bytes and last access. Values and capability tokens
remain private. Counters reset on grant replacement/revocation or Broker restart;
HEAD and directory listings do not count as downloads.

Echo issue #12 adds an opt-in `examples/webdav/service.json` consumer manifest
in the lasso-echoservice repository. Its `/secret-file` route reports safe read
status; POST rereads the supplied demo JSON without exposing values. Actual
Core/Broker/Echo source builds passed this sample on Ubuntu: two reads matched
Broker accounting, env/durable outputs withheld private material, and stop
removed its grant. The management matrix also passed Windows named-pipe and
Unix IPC, plus native Windows UNC. Admin unit/browser fixtures are separate
from that real integration; no installed/released-package claim is made.
