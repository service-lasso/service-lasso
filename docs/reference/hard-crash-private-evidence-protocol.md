# Hard-crash failure custody proposal (#1326 / PR1596)

Status: source protocol prepared; owner private-transfer authority, implementation,
independent whole review, complete ROOT input admission and direct failed-attempt
acceptance remain required. No hosted private cause or accessible raw receipt is
available for run37007665958. Its seven Windows jobs failed initialization before
crash_spawn; run artifact inventory is zero. This proposal does not attribute the
failure to ACLs, the guardian, a compiler, or any other native operation.

## Destructive retention boundary: F1/F2

The fixture helper has no validated primitive excluding every relevant namespace
and content writer for preservation/removal. POSIX descriptor-relative unlink
still names an entry; it cannot atomically condition deletion on its approved
inode. Windows held roots do not exclude child creation; fresh child handles
cannot bind deletion to the earlier copy. No cooperative lock, 0700, extra lstat,
rename, share3 handle or inventory recheck grants that guarantee.

Current source therefore rejects removal without entering unlink/rmdir or native
disposition. A successful verified private copy remains alongside the original;
reset is not attempted. Existing positive removal/reset/full-matrix gates remain
UNMET. Retention is a safety disposition, never a passed acceptance result.

To enable deletion, a separate reviewed platform transaction must identify all
approved original descendants before copying, hold the exact objects and bytes
under documented writer exclusion, and delete only those objects. It must detect
new names without deleting them, reject all changed/unknown-owner/reparse objects,
and never claim a directory-sharing mode excludes additions. POSIX requires a
stronger approved isolation boundary or an explicitly owner-approved retention
policy; neither exists in this candidate. A policy change needs GOV14/spec and
separate protected-evidence review before altering any positive assertion.

The owner decision is concrete and bounded:

| Option | Scope and tradeoff | Required evidence / affected gate |
| --- | --- | --- |
| Continue fail-closed retention | No host/trust/permission change; original/copy accumulate under their owner. Current safety behavior stays enabled. | Positive removal/reset and complete formal matrix remain unmet; no completion or release acceptance. |
| Windows exact-held inventory transaction | A new reviewed helper acquires approved original descendants before preservation with documented denial of relevant write/delete sharing, hashes bytes through those same handles, and deletes only approved handles. Directory additions remain possible and must fail closed without deleting additions. Approved-member partial deletion is reported separately from retained copy. | Actual kernel sharing/handle identity/byte invariance and after-inventory addition/substitution/content tests, exact-head whole review/admission, complete current matrix. No inference that directory sharing excludes additions. |
| Approved isolated POSIX writer boundary | A separately designed, owner-approved isolation boundary must exclude all relevant namespace/content writers for the whole transaction. This changes the current trust/host boundary and cannot be invented inside this repair. | GOV14 blueprint, explicit scope/owner, enforceable primitive, adversarial same-uid final-delete tests and full native acceptance. No cooperative-lock or 0700 substitute. |
| Change the retention acceptance contract | Owner explicitly decides that retained originals/copies satisfy a revised requirement and supplies storage/custody/closure policy. This changes required positive cleanup behavior. | Spec/issue policy before implementation and separate protected-evidence review; current assertions cannot be silently narrowed. |

Rollback for any future implementation keeps the currently disabled destructive
route and retains every original, copy, failed attempt and private manifest. No
rollback here means deleting evidence or restoring by unreviewed rename. This
candidate implements only the first safety option; the decision/proof needed to
restore positive cleanup remains open and belongs to the owner/conductor.

## Handle-bound privacy: F5

POSIX protection acquires prior uid/no-follow root and ancestors, then fchmods
the original directory handle. A replaced name cannot redirect the mutation.
Windows privacy source acquires root/ancestor and every original descendant
handle, reads each prior owner through GetSecurityInfo, rejects reparse/special
targets before mutation, and uses only DACL SetSecurityInfo on held originals.
No owner reset, SACL, privilege enablement or path-based Set-Acl is allowed.

Mutating handles request MAXIMUM_ALLOWED solely for the documented suppression
of automatic child propagation; each held target receives its own private DACL.
It does not grant a new right. Unopenable or unknown-owner targets retain state.
All original handles and names plus the exact direct-child inventory receive
readback; new entries are never traversed recursively to an outside target.
Protected-root and exclusive owner/SYSTEM ACL checks precede sensitive writes.
This is source preparation, not an executed native claim. The helper's compiler,
CLR, Advapi32/kernel32 libraries, executable, environment, native child custody
and exact loaded inputs require new complete ROOT admission.

API basis: [SetSecurityInfo](https://learn.microsoft.com/en-us/windows/win32/api/aclapi/nf-aclapi-setsecurityinfo)
documents handle binding, automatic ACE propagation and MAXIMUM_ALLOWED
nonpropagation. [SetKernelObjectSecurity](https://learn.microsoft.com/en-us/windows/win32/api/securitybaseapi/nf-securitybaseapi-setkernelobjectsecurity)
explicitly directs filesystem callers to SetSecurityInfo; it is not a shortcut.
No such documentation supplies namespace-writer exclusion for removal.

## Independent private failure channel: F7

The release/project owner must select one authorized private evidence custodian,
destination and access policy for failed attempts. This candidate neither names
an imaginary owner nor provisions a key, token, destination, ACL grant or public
upload. Parent/root coordination must record the actual decision and dependency
against issue1326 before enabling transfer.

The concrete source protocol is an external ROOT-owned observer with the
following ordered contract, implemented and independently reviewed separately:

1. Before any fixture privacy, compiler, guardian or Core action, ROOT creates
   a unique private spool in its approved owned nonredirected evidence path and
   opens the failure stream with exclusive creation. It validates original and
   ancestor identity, prior owner and native protected ACL using held handles.
   Sink failure rejects admission; it does not fall back to the original fixture,
   a default temporary directory, console/TAP, or a named unvalidated ENV path.
2. ROOT binds the held stream to exact candidate HEAD/tree, complete raw-source
   inventory and complete tool/native/ENV admission. It supplies only that held
   stream to its directly owned test child as an explicit inherited private
   channel. A numeric descriptor or environment variable alone is not evidence
   of sink authority. Parent/native lifetime, expected descriptor/object identity
   and privacy witness must be read back before source execution.
3. The reviewed fixture writer sends framed full initialization/cleanup errors
   to that held channel independently of diagnosticRoot protection. Frame limits,
   serialization/cycle handling, error cause chains and write/flush/EOF failures
   are explicit. It never writes full errors to public output. Existing private
   local diagnostic retention remains supplemental; rejected privacy cannot be
   bypassed or treated as captured evidence.
4. ROOT observes both original pipes and the private channel to actual natural
   EOF/child closure, retains original failed exit and errors, writes a manifest
   over actual raw bytes, and independently reads hashes, sizes, owner/ACL and
   input bindings. Incomplete capture remains failed/unavailable. No replacement
   successful run, retry, skipped assertion or synthetic error may qualify.
5. The authorized custodian transfers only the validated private spool through
   the chosen approved private route and independently reads it back. Actual
   access by the custodian is required; an ephemeral retained pathname is not
   accessible custody. Public artifacts may contain only the separately reviewed
   finite status/stage/outcome projection and approved opaque binding. Raw paths,
   fingerprints, PIDs, SIDs, ACLs, secrets, exception messages and native output
   remain private. No raw GitHub artifact upload is authorized by this proposal.

Public initialization substages are fixed: diagnostic allocation, diagnostic
privacy, original privacy, held acquisition, original identity and held verify.
They identify the source boundary which rejected without selecting a native
cause. Unknown categories cannot become arbitrary public text.

Current workflow is unchanged and has no private transfer. Full private cause
capture independent of the failing privacy prerequisite is NOT implemented or
accepted by this candidate. F7 remains a concrete external-authority/protocol
dependency. Required next decision: approve a real custodian/destination/access
policy, then have a fresh bounded source author implement this exact private
channel and workflow integration under GOV14 before review/admission/execution.

## Acceptance retained

All seven formal phases, both recovered rows, actual native keeper identity,
all lifetime/ownership/generation/allocation/residue/privacy assertions, original
deadlines/retries, ENV restoration and unrelated-process survival remain required.
F1/F2 retention safety, F3 malformed-row rejection, F4 mixed-lifetime retention,
F5 physical mutation binding, F6 direct-child classification and F7 private failed
capture require independent entire review and freshly admitted direct execution.
Historical EBUSY and all seven current initialization failures remain failed and
unattributed. This source protocol grants no execution or provider/release action.

## Selected architecture amendment (#1629)

The earlier option table is historical candidate analysis. The conductor has now
selected [ADR-002](../../.governance/decisions/ADR-002-fixture-isolation.md) and
SPEC-002 AC-4BJ.9c.fixture-isolation-v1 FI-1..FI-7 for prospective source work:
Linux distinct host UID/private persistent backing/mount/supervisor; Windows W2
fresh SID/restricted token/process protection/controlled Job plus W1 same-held
original copy and ordinary disposition. W1 alone and changed retention acceptance
remain unselected. No additional human confirmation is needed to prepare this
source contract. Current destructive refusal stays enabled until actual newly
admitted native proof; this amendment is neither provisioned capability nor GO.

ADR-002 defines source-owned actor paths, live mediator/workload separation,
continuous guardian identity transfer/delete-handle settlement, bounded inherited
private IPC, proof keys and compiler/runtime/ENV/native provenance admission.
Its persistent independent copy is separate from original removal and survives
observer failure. Memfd is a sealed read capability with finite lifetime, never
persistent storage. Windows copy remains private point-in-time owner-mutable.
All primary/secondary raw errors and ENV/hook/reset/partial states remain private
and separately truthful. Original failure records are never rewritten.

F7's independent pre-established initialization-error stream must use its own
admitted held root before the diagnostic prerequisite can fail. The launcher
cannot invent that root's authority or treat its own successful initialization
as capture of earlier provisioning failure. Actual accessible off-host transfer
still requires the owner-selected real private custodian/destination/access
policy and direct failed-attempt readback. None is supplied by this amendment;
no public upload or credential/provider grant is authorized. Native source
preparation can progress while F7 runtime acceptance remains blocked.
