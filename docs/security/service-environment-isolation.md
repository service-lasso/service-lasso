---
title: Service environment isolation
slug: /security/service-environment-isolation
---

# Service environment isolation

A custom service `env` block controls which values Service Lasso supplies to a
launched process. It avoids accidentally sharing configuration through a global
environment. It does **not** make that process's environment unreadable to other
processes with sufficient OS permissions.

Use explicit service-local `env` mappings and declared Broker imports. Keep
secrets out of `globalenv`, command lines, logs, diagnostics and persisted
manifests. Broker authorizes secret delivery; OS controls must protect the
consuming process after delivery. A consuming app can also pass its environment
to children unless it deliberately filters it.

## Linux: shared users are a shared trust boundary

Linux exposes a process's initial environment through `/proc/<pid>/environ`.
Access is subject to kernel ptrace access checks; it is not readable by every
user just because `/proc` is mounted. Processes running under the same UID can
often read each other's environments, subject to credentials, dumpability and
the host's security policy. Different service names, working directories and
custom `env` maps do not change that UID boundary.

If all direct services run as the user that started Core, assume they share a
trust boundary. Running Core and every service under one dedicated account
separates them from other ordinary users, but does not separate those services
from each other.

For mutually untrusted services, use distinct service identities or a verified
sandbox/container policy that prevents cross-service process inspection and
access to shared secret files. Dedicated Linux service users can be non-login
system accounts; they do not require interactive desktop profiles. Account
provisioning and launching under those identities remain deployment/provider
work: the [isolation ladder](../reference/resource-isolation-model.md) does not
promise that Core automatically implements those rungs.

## Linux host hardening with hidepid

Mounting procfs with `hidepid=2` (also named `hidepid=invisible` on supporting
kernels) hides other users' process directories. It is a useful additional
host control, **not a substitute for separate identities when services share
one UID**. The rule is based on credentials and access checks, not a special
allowance for direct children. It does not hide every indication that a PID
exists.

For a host whose distribution manages `/proc` through `/etc/fstab`, an operator
can adapt the existing procfs entry:

```fstab
proc /proc proc defaults,hidepid=2 0 0
```

The equivalent named spelling is:

```fstab
proc /proc proc defaults,hidepid=invisible 0 0
```

Use **one** applicable entry, preserving the existing required mount options;
do not append duplicate `/proc` mounts or blindly replace distribution defaults.
Check the target kernel and distribution's supported configuration mechanism.
An fstab edit alone does not change an already mounted filesystem. During an
operator-approved maintenance window, a supporting host can apply the option
with a remount, then inspect the effective mount:

```sh
sudo mount -o remount,hidepid=2 /proc
findmnt -T /proc -o TARGET,FSTYPE,OPTIONS
```

Record the previous mount options/configuration first and keep a recovery
session available. If process discovery, monitoring, backups or service
management break, restore the previous configuration and mount options, then
recheck those tools. Verify persistence after reboot using the distribution's
boot configuration; a successful remount alone does not prove persistence.
Service Lasso does not edit fstab or apply this setting automatically.

Limits to account for:

- Same-UID services remain within the same trust boundary.
- Privileged inspection (including appropriately scoped `CAP_SYS_PTRACE`) and
  the procfs `gid=` exemption can bypass restrictions. Do not give service
  identities membership in an exempt monitoring group.
- The setting applies to the relevant procfs mount. Check the view inside each
  service's mount/PID namespaces, including containers; host settings do not
  prove an identical view everywhere.
- It does not protect secrets copied into files, logs, dumps or application
  responses, or secrets already available to the consuming application.

### Verify without exposing secrets

Use disposable processes containing only a synthetic marker, never production
credentials. Confirm their actual UIDs and run the probe under the observer's
real service identity, without sudo or elevated capabilities. Check whether
`/proc/<fixture-pid>` is visible and whether opening its `environ` succeeds;
record only allowed/denied results, not file contents.

Verify both a different-UID observer (expected hidden/denied under the intended
policy) and a same-UID observer (which `hidepid=2` alone does not isolate).
Also verify that each service still reads its own required environment and that
Core's health, lifecycle and monitoring operations still work. If the deployment
requires service-to-service confidentiality, an allowed cross-service probe is
a failed isolation requirement even if the mount option is present. Recheck
after reboot and in the actual service namespace before claiming enforcement.

### systemd deployments

Where services are independently launched as systemd units, `ProtectProc=invisible`
can restrict a unit's procfs view on supported hosts. It also leaves processes
owned by the same UID visible. Applying it only to the Core unit and its
same-UID children does not create per-service boundaries. Combine distinct
identities and appropriate privilege/sandbox policy, and verify the effective
view. These are host deployment options, not Service Lasso manifest fields or
evidence of implemented dedicated-user isolation.

## Windows: process access rights still matter

Windows does not expose Linux procfs. Its process security descriptors, access
tokens and process access rights govern inspection. Reading another process's
memory requires rights such as `PROCESS_VM_READ`; sufficiently privileged
debugging can also expose secrets.

A custom environment block is therefore not an unconditional Windows security
guarantee either. Processes using the same account may have sufficient rights
to inspect one another. For services that must distrust each other, configure
and verify distinct service identities and appropriate process/file access or
sandbox boundaries. Job objects and resource limits alone do not establish
secret confidentiality.

## Secret files and remaining responsibility

RAM-backed files can support applications that require files and reduce durable
plaintext storage, but do not fix a shared-identity boundary by themselves.
Same-UID Linux processes can generally access files allowed to that UID; the
corresponding Windows ACLs must also be considered. Protect the Broker, Core,
consumer processes, transport credentials and recovery material as part of the
same deployment design.

See [startup Broker resolution](../reference/startup-broker-resolution.md),
[Linux tmpfs secret files](../reference/linux-app-secret-files.md), and
[RAM WebDAV delivery](../reference/ram-webdav-secret-files-review.md) for their
specific delivery and storage limits.

## Sources

- [Linux kernel procfs mount options](https://www.kernel.org/doc/html/latest/filesystems/proc.html#mount-options)
- [Linux initial process environment and access checks](https://man7.org/linux/man-pages/man5/proc_pid_environ.5.html)
- [systemd process protection settings](https://www.freedesktop.org/software/systemd/man/latest/systemd.exec.html#ProtectProc=)
- [Windows process security and access rights](https://learn.microsoft.com/en-us/windows/win32/procthread/process-security-and-access-rights)
