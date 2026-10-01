# Host-runner service owner package

This package is a source/build/install package for a Darwin owner with an
existing legitimate root-service authority. It is not authority to change a
provider setting, publish a runner, or activate any other host.

The daemon creates its own resident primary, records its audit token, birth
time, daemon-parent relation and `csops`-validated code-signature status, then keeps
that record private. It issues a write-only pipe capability itself, binds it to
the XPC peer audit identity, expires it after sixty seconds, consumes it once,
and revokes peer grants on disconnect. Completion accepts only root-owned,
single-link regular-file descriptors, hashes those held descriptors, and
requires the parent descriptor to bind the leaf digest. A client never supplies
the daemon's executable, PID, image digest, or a readable bearer capability.

On the designated Darwin host, after root approval, build and sign in the
owner-controlled pipeline, then install the checksum-bound binary:

```sh
export SERVICE_LASSO_HOST_RUNNER_SIGNING_IDENTITY='Developer ID Application: owner identity'
scripts/host-runner-service/darwin/build.sh /absolute/output/service-lasso-host-runner
sudo scripts/host-runner-service/darwin/install.sh /absolute/output/service-lasso-host-runner /absolute/output/service-lasso-host-runner.sha256
sudo scripts/host-runner-service/darwin/verify.sh
```

The installer validates root ownership, restricted modes, SHA-256 and a strict
code signature before staging a replacement under the service root. It unloads
the old label, atomically swaps the binary, bootstraps and reads launchd back;
failure restores the prior binary. Uninstall fails if unload fails and only
then removes program files. Both uninstall and failed-install rollback retain
the private state directory for owner review.

Retain the private receipt containing only service identity, launchd state,
FD/capability expiry and revocation events, primary identity fields, and result
classes. Do not put capability contents, caller paths, command lines, secrets,
or provider tokens in it. Roll back with
`sudo scripts/host-runner-service/darwin/uninstall.sh`.

`node scripts/host-runner-service/qualification.mjs` compiles the platform
validator where its native toolchain is present. It is source/build evidence,
not activation evidence. Native acceptance remains unavailable until an
authorised owner performs the Darwin install and retains its private receipt.
