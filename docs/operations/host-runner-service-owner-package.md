# Host-runner service owner package

This package is a source and installer proposal for a Darwin owner with an
existing legitimate root-service authority. It is not authority to change a
provider setting, publish a runner, or activate any other host.

Review `scripts/host-runner-service/darwin/service-lasso-host-runner.c` with
the final signed binary and its source/hash provenance. The owner must complete
the `csops` code-signature/image-FD binding noted in the source before approval;
the current source proves the FD-only and one-use-close boundary but is not a
native acceptance receipt.

On the designated Darwin host, after root approval and after producing a
reviewed signed binary, run:

```sh
sudo scripts/host-runner-service/darwin/install.sh /absolute/path/to/reviewed/service-lasso-host-runner
sudo scripts/host-runner-service/darwin/verify.sh
```

Retain the private receipt containing only the protected service identity,
launchd state, FD/capability expiry/close events and result classes. Do not put
capability contents, paths from callers, command lines, secrets or provider
tokens in it. Roll back with `sudo scripts/host-runner-service/darwin/uninstall.sh`;
it intentionally retains state for owner review.

Native acceptance remains unavailable until an authorised owner performs this
on a Darwin host. Source verification exercises the denial properties only.
