# SPEC-2001 Local installed operator session

Active Development; #2001; SPEC-005 local operator auth and SPEC-1994 launcher amendment.
Coordinator approved the Linux same-UID private socket boundary before implementation.

- AC-2001-1: An implicit installed TUI launch selects the existing owned live workspace generation. Linux Core offers an OS-protected Unix socket in an exclusively created uid-owned 0700 directory under /tmp, with a 0600 socket. The launcher checks physical uid/mode and exact workspace/services/generation/loopback endpoint binding before accepting a credential. Other platforms retain explicit authentication. An unavailable/denied handoff leaves the existing TUI authentication prompt authoritative; no credential is fabricated.
- AC-2001-2: Core mints only after actual Broker setup is complete and persisted local-operator state acknowledges credentials. No first-run envelope, long-lived token or password is read. A fresh random opaque session exists only in Core memory, expires under the existing local-session TTL and is revoked at owned Core shutdown. Verification binds workspace and generation and accepts direct loopback HTTP only; forwarded/proxy/remote replay cannot use it.
- AC-2001-3: The existing TUI token environment interface receives the session solely in the direct child's environment, never process.env or managed-service environment, arguments, files, logs or source. Explicit URL/profile/config/connect/token selection retains existing authority, and no anonymous HTTP policy changes.
- AC-2001-4: Bounded socket requests/responses and deadlines fail closed for wrong workspace/generation/origin, insecure/replaced paths, missing runtime, denied onboarding/ack, expired/revoked credentials and foreign uid. Linux disposable Core and installed provider fixtures prove authenticated handoff, PTY/args preserved, no persistent credential; actual published provider integration remains coordinator-owned.

Same uid is the trusted principal; root/same-uid malicious process mutation is outside this boundary. Filesystem checks do not claim protection against a trusted same-uid attacker. Stale socket directories contain no credential and are retained after crashes; generation-specific exclusive creation refuses reuse.

- AC-2001-5 (#2009): The checkout-owned installed CLI can use the same
  Linux handoff under AC-1994-9. The child receives the existing CLI Bearer
  environment only when an explicit client credential is absent. Authenticated
  CLI requests remain direct to the verified loopback endpoint.
