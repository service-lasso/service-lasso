---
title: "The 5,601-Scan Loop: Porting Nextcloud to Native Windows"
---

# The 5,601-Scan Loop: Porting Nextcloud to Native Windows

## 1. Introduction: the single-process challenge

Service Lasso distributes complex server stacks as portable, local application
bundles. A user installs a service, the runtime allocates loopback ports,
starts the process, and the service behaves like a normal local application.

The contract for `lasso-nextcloud` is deliberately narrow:

- Nextcloud is a **pure FastCGI backend**. It listens on a private loopback
  TCP endpoint and never terminates TLS.
- `lasso-caddy` is the shared **HTTP-to-FastCGI translator**. It matches a
  host name and forwards the request to the FastCGI endpoint.
- `lasso-traefik` owns the public edge: TLS and `Host` routing.

That gives three clean layers:

```text
Client -> Traefik (TLS, Host) -> Caddy (FastCGI) -> Nextcloud (php-cgi / php-fpm)
```

The historical problem is that Nextcloud dropped native Windows support years
ago. Linux is the supported server target; Windows is supported for
development only. Teams that need Nextcloud on a Windows host usually hide it
inside Docker, WSL or a Linux VM. That works, but it breaks the single-process,
portable-local-bundle goal.

This is the story of making the real Nextcloud payload run natively on Windows,
and of the path bug that only appears when a POSIX filesystem assumption meets
the Windows kernel.

## 2. The symptom: the silent twenty-second hang

The first install looked healthy:

- The release archive downloaded and extracted.
- PostgreSQL was provisioned and `occ maintenance:install` completed.
- `GET /status.php` returned the expected JSON.
- `PROPFIND` on the DAV root returned `207`.
- A WebDAV `PUT` **wrote the file to disk**.

Then the response never came back.

The client waited until its timeout, and Caddy eventually returned a `502`. A
`GET` on the same path returned the bytes that had just been written, so the
write itself was not the problem. The request was completing the work and then
losing the thread somewhere between the write and the response headers.

The first useful measurement was CPU. The FastCGI child was not idle. It burned
roughly 11 seconds of CPU on a three-byte upload, and it stayed busy until it
was killed. This was not a lock, a socket wait or a database deadlock. It was a
loop.

## 3. The whack-a-mole phase (and how it was disproved)

The first trace markers landed on the DAV plugin path:

- `FilesPlugin::sendFileIdHeader`
- `getNodeForPath`
- `HookConnector::postWrite`

The obvious theory was a bad handler in one of those callbacks. It was wrong.

The decisive experiment was to make the suspect function return immediately.
`sendFileIdHeader` was replaced with an unconditional `return`. The request
still timed out. That disproved the handler theory: the handler was not the
cause, it was one of several callers that reached the same broken code.

Guarding the callers produced a very characteristic result. The hang moved:

| Guard applied | Where the hang moved next |
| --- | --- |
| `HookConnector::postCreate` / `postWrite` | `afterBind` -> `FilesPlugin::sendFileIdHeader` |
| `sendFileIdHeader` | `afterMethod:PUT` |

That migration is the signature of a **shared convergence path**, not a loose
handler. Every route — the node hooks, the DAV bind hook, the method hook —
eventually called the same filesystem operation. The bug was below all of them.

At this point the useful question changed from "which handler is wrong?" to
"what do all of these handlers call?".

## 4. The breakthrough: the endless ancestor walk

The next round of instrumentation was structural rather than speculative. Four
filesystem helpers in Nextcloud walk a file's folder lineage with `dirname()`:

| File | Walk |
| --- | --- |
| `apps/dav/lib/Connector/Sabre/Directory.php` | DAV `getNodeForPath()` ancestor read check |
| `lib/private/Files/Mount/Manager.php` | mount lookup by path |
| `lib/private/Files/SetupManager.php` | ancestor setup lookup |
| `lib/private/Files/Config/UserMountCache.php` | cached-mount walk |

On Linux and macOS the termination condition is simple:

```php
while (($path = dirname($path)) !== '/') {
    // check the parent
}
```

`dirname()` keeps collapsing the path until it returns the POSIX root, `/`.
On a native Windows host the same string does not behave that way. Depending on
the shape of the path it returns:

- `.` for a relative path,
- `\` for a backslash root,
- `C:\` for a drive root,
- or the same string again when there is no further parent.

None of those values is `/`, so the loop never terminates.

The proof was a call counter, not another stack trace. `View::getFileInfo()` was
instrumented with a per-process counter:

```text
gfi=5401
gfi=5501
gfi=5601
```

That is **5,601 `getFileInfo` calls in 15 seconds** from the DAV ancestor walk
alone. Each call rebuilt the file-cache query, joined the metadata table, and
walked the mount manager again. The "20-second hang" was simply the thread
starving itself on its own ancestors.

### Reproducing the frame in a debugger

The native stack is not enough on its own because PHP userland frames are
interpreted. The reliable method was to dump the busy `php-cgi` child with
`procdump`, load the matching PHP PDBs into `cdb`, and walk
`EG(current_execute_data)` by hand:

```text
r $t9 = &php8!executor_globals
r $t0 = poi($t9+0x1e8)        # current_execute_data
r $t1 = poi($t0+0x18)         # func
.printf "line=%d\n", dwo(poi($t0)+0x18)
r $t4 = poi($t1+8)            # function_name
da ($t4+0x18)
r $t5 = poi($t1+0x90)         # op_array.filename
da ($t5+0x18)
r $t0 = poi($t0+0x30)         # prev_execute_data
```

With the PHP 8.3 PDBs loaded, the chain read:

```text
Directory::getNodeForPath  (Directory.php:570)
View::getFileInfo          (View.php:1453)
View::getCacheEntry        (View.php:1398)
Cache::get                 (Cache.php:127)
selectFileCache            (CacheQueryBuilder.php:56)
```

The native top frame was `php8!zif_dirname+0x5`. The loop was not recursion —
Xdebug's `max_nesting_level` never fired — it was a flat `while` loop calling
`dirname()` forever.

## 5. The fix: guarded win32 boundary terminations

The fix is a small, explicit termination rule shared by all four walks. Stop
when the parent is a root-like value, or when `dirname()` stops making
progress:

```php
$parent = dirname($scanPath);
if ($parent === $scanPath          // no progress
    || $parent === '.'             // relative root
    || $parent === ''              // exhausted
    || $parent === '/'             // POSIX root
    || $parent === '\\'            // Windows backslash root
    || preg_match('/^[A-Za-z]:[\/\\\\]?$/', $parent) === 1) { // drive root
    break;
}
$scanPath = $parent;
```

The patch is applied at packaging time, not at runtime. `scripts/package.mjs`
holds a guarded list:

```js
const windowsCompatibilityPatches = [
  // migration separators, drive-qualified data dir, containment separators
  { file: "apps/dav/lib/Connector/Sabre/Directory.php", /* DAV ancestor walk */ },
  { file: "lib/private/Files/Mount/Manager.php",       /* mount lookup */ },
  { file: "lib/private/Files/SetupManager.php",        /* ancestor setup */ },
  { file: "lib/private/Files/Config/UserMountCache.php" /* cached mounts */ },
];
```

Two properties matter:

- The patches run **only** for `platform === "win32"`. The Linux and macOS
  artifacts keep the upstream code.
- Packaging **fails closed** if the upstream text no longer matches. A future
  Nextcloud upgrade cannot silently ship a stale patch.

## 6. The results

After the four patches, the same three-byte upload behaves like a normal local
service:

| Measurement | Before | After |
| --- | --- | --- |
| First `PUT` after a fresh install | never returns (CPU spin) | `201`, ~16 s (first-access cache warm-up) |
| Second `PUT` | never returns | `201`, **0.68 s** |
| `GET` of the uploaded file | works after the write, but the write request is dead | `200`, body matches |
| `PROPFIND` | `207` before the write | `207` |
| `getFileInfo` calls during the write | 5,601 in 15 s | ordinary ancestor count |

The first request is still slower than the second because Nextcloud populates
the file cache on first access. That is expected and bounded. The unbounded
spin is gone.

The full E2E — Caddy route, `PUT`, `GET`, `PROPFIND` — passes, and the release
pipeline publishes the fixed Windows archive alongside unchanged Linux and
macOS artifacts.

## What this cost, and what it taught

This took far longer than the size of the diff suggests. The hard part was not
writing the guard; it was proving **where** the guard belonged.

What actually worked, in order:

1. Measure CPU, not just wall time. A busy child rules out locks and I/O waits.
2. Treat a moving hang as a convergence signal. If guarding a caller moves the
   hang to the next caller, stop reading handlers and find the shared callee.
3. Count calls. The `getFileInfo` counter (5,601 in 15 s) was more decisive than
   any single stack sample.
4. Use the right debugger for the layer. Native stacks show `dirname()`; PHP
   PDBs plus `EG(current_execute_data)` show which userland function called it.
5. Assume standard-library path semantics are platform-specific. `dirname()`
   is not a portable root-walk primitive.

The takeaway for anyone porting a large POSIX codebase to native Windows: the
dangerous code is rarely the part that fails loudly. It is the part that
assumes a path eventually becomes `/`. Verify the platform behavior of every
low-level path helper, and put the guard where all the callers converge.

## Related

- [Run Nextcloud behind Caddy](../getting-started/advanced-run-nextcloud-behind-caddy.md)
- [Nextcloud service repository](https://github.com/service-lasso/lasso-nextcloud)
- [Manifest fields and health checks](../reference/service-json-reference.md)
