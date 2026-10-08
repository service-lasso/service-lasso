# RAM-backed local WebDAV secret files: design review

Reviewed 2026-10-08 for #1730. This is a proposed optional Windows delivery
adapter, not an implemented server, verified UNC integration or deployment.
The Linux tmpfs feature remains independent. The owner requested per-service
tokens, strict local access and use of UNC paths without drive mapping.

The owner's requested ownership for this proposed adapter is **Broker ownership**:
Broker populates its own in-memory WebDAV store from its encrypted vault and
issues each app a restricted per-launch grant. Core orchestrates readiness,
path delivery and grant revocation; apps cannot write to the store. This does
not change the implemented Linux Core-owned tmpfs file profile.

## Feasibility and recommendation

`webdav-server` supports a virtual filesystem in server memory. Its source
defaults to a virtual root, but also defaults to an all-interface hostname and
optional authentication. A secret provider must explicitly override those
defaults and disable persistence/serialization and request-body logging.
The currently published npm version inspected is 2.6.3; adopting it still
requires dependency/security and exact-version compatibility verification.
[Upstream source](https://github.com/OpenMarshal/npm-WebDAV-Server/blob/master/src/server/v2/WebDAVServerOptions.ts),
[virtual filesystem implementation](https://github.com/OpenMarshal/npm-WebDAV-Server/blob/master/src/manager/v2/instances/VirtualFileSystem.ts).

The proposed plain-HTTP UNC shape is
`\\127.0.0.1@8080\DavWWWRoot\<service-namespace>\<file>`.
It avoids a drive letter. The optional TLS shape is
`\\127.0.0.1@SSL@<port>\DavWWWRoot\<service-namespace>\<file>`;
its server certificate must be trusted and valid for the exact host used.
These paths need native Windows WebClient validation under the actual app
identity. For services, prefer a UNC path over `net use T:` because drive
letters belong to logon sessions. `/persistent:no` controls connection
recreation, not file-content storage.
[Microsoft service guidance](https://learn.microsoft.com/en-us/windows/win32/services/services-and-redirected-drives),
[net use semantics](https://learn.microsoft.com/en-us/previous-versions/windows/it-pro/windows-server-2012-r2-and-2012/gg651155(v=ws.11)).

**Server RAM storage does not establish end-to-end RAM-only access.** Windows
documents a local WebDAV file cache; invalidation marks a cached file for
deletion and fails while it is open. This review has not established that
WebClient avoids disk backing. Cache headers alone are not sufficient proof.
Node memory can also be paged or dumped under host policy. For a strict
no-plaintext-on-disk requirement, native Windows RAM-filesystem delivery or
direct IPC/env remains preferable until the complete WebDAV client path is
qualified. WebClient is deprecated and not started by default on Windows;
deployment must check supported versions and actual availability.
[WebDAV cache API](https://learn.microsoft.com/en-us/windows/win32/api/davclnt/nf-davclnt-davinvalidatecache),
[Windows deprecation record](https://learn.microsoft.com/en-us/windows/whats-new/deprecated-features).

## Required security design

1. Broker creates an independent random token with at least 256 bits of entropy
   per service launch. Bind it to the service ID, folder-instance identity and
   launch generation. Keep it in memory, pass it only to that app's authorized
   launch context, revoke on stop/replacement and recreate after provider restart.
   In the preferred header/credential profile, never put tokens in URLs or UNC
   paths. In every profile, exclude tokens from persistent credentials, logs
   and status. The separately considered capability-path adapter below has
   additional exposure requirements.
2. Bind exclusively to `127.0.0.1`; add `::1` only with an equally constrained
   separate listener. Reject non-loopback peers, unexpected Host/Origin values,
   proxy/forwarded identities and unauthenticated requests. Do not use wildcard
   binding or accept a forwarded localhost assertion. Being local does not
   authorize another user/process on the machine.
3. Authenticate every content/listing request and authorize the exact service
   namespace after decoding and normalization. Default deny, no anonymous
   access, cross-service listing, traversal, aliases or redirects. A token for
   A must never read B. Random path names alone are not authorization.
4. App credentials permit read/list operations only. Disable client PUT, DELETE,
   MOVE, COPY, MKCOL, PROPPATCH and writable locking behaviour. Only Core's
   Broker provisioning interface may populate or replace content.
   Set bounded file/count/total-memory and request limits; errors stay secret-free.
5. Direct HTTP clients can send a bearer token. Windows UNC clients cannot
   attach an arbitrary Authorization header when opening a filename. Their
   credential adapter must use a Windows-supported authentication scheme, such
   as Digest with the token as its password, and be proven under the exact app
   account/logon session. Prefer TLS with a correctly trusted local certificate.
   Do not weaken machine-wide BasicAuth policy or embed the token in net-use
   command arguments. Native credential/session integration is missing work.
6. A shared endpoint can encounter Windows credential reuse across services.
   Qualify distinct service logon identities and namespace authorization, or
   provision distinct loopback endpoints per service. Do not assume one account
   can bind several passwords to the same WebDAV host transparently.

## Proposed startup flow

Core requests delivery using its existing scoped launch identity. Broker
resolves current vault values, renders only declared disposable outputs into
its in-memory filesystem, reserves a service namespace and token, and returns
the restricted grant after an authenticated readiness check. Supply the app the
Broker-granted `_FILE` UNC path or
direct HTTPS URL. Establish the required native client credential context before
spawning the app; an env token alone does not authenticate WebClient. Fail before
spawn if authentication, provider readiness or native path access fails. A restart
recreates values from Broker, never from a serialized WebDAV tree on disk.

## Optional capability-path adapter requested by the owner

The proposed paths are `\\127.0.0.1@8080\DavWWWRoot\<token>\` on Windows and
`dav://127.0.0.1:8080/<token>/` in a supporting Linux file manager. This can
support clients that cannot set `Authorization: Bearer`. The server must
explicitly authenticate the first path segment; a filesystem mapping alone
does not implement authorization. These are client-specific syntax candidates,
not paths validated by this review.

Treat the token as a short-lived bearer capability, not a directory name. Hash
tokens for the in-memory lookup, issue unpredictable independent service tokens,
and bind each to only its service namespace and generation. The virtual root
must not enumerate tokens. Ignore caller-supplied service IDs as authority;
resolve the namespace from the authenticated token. Reject malformed encodings,
traversal, cross-namespace COPY/MOVE and all writable operations. Do not redirect
requests. Rotate/revoke on replacement and provider shutdown.

The complete token-bearing path is secret. It can enter file-manager history,
WebClient caches, request access logs, exception text, diagnostic traces and app
configuration. Disable raw URI/body logging and redact the segment at ingress;
pass the path only in the intended launch environment, never persistent command
arguments or state. Qualify client-side history/cache/credential handling before
selecting this adapter for secrets. Loopback-only binding does not address a
stolen token or automatically authorize a local process.

For an HTTP-capable app, prefer `Authorization: Bearer <token>` on a stable URL;
native UNC/file-manager access requires the adapter above or supported credential
authentication. WinHTTP's documented built-in schemes do not include automatic
Bearer credentials. A token placed in the path is **not** the Bearer header
scheme. [WinHTTP authentication schemes](https://learn.microsoft.com/en-us/windows/win32/api/winhttp/nf-winhttp-winhttpqueryauthschemes),
[Bearer-token specification](https://www.rfc-editor.org/rfc/rfc6750.html).

## Qualification required before implementation claims

- Real app reads through the UNC path under its actual service identity, without
  an interactive drive mapping or administrator-session credential dependency.
- Valid A token reads A; anonymous, wrong, expired/revoked and B tokens fail for A.
  Test concurrent services and normalized/encoded traversal/namespace aliases.
- Confirm only loopback listeners/peers and blocked unexpected Host/Origin;
  prove write methods cannot mutate contents. No request-body or token logging.
- Synthetic markers are traced through WebClient/cache/temp/pagefile/dump and
  app paths on the exact Windows build before making a RAM-only claim. Test
  rotation while files are open and ensure a stale client cache cannot supply
  the prior secret to a replacement launch.
- Provider death/restart, empty memory store, token revocation and app restart
  regenerate current Broker values or block launch safely.

Read-only local inventory found WebClient running on this machine. No WebDAV
provider was installed, listener started, drive mapped, credentials changed,
registry policy weakened or plaintext production secret exposed by this review.
