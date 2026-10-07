# Linux #1724 barrier and protected-operation protocol

Status: proposed complete algorithm for a DIFFERENT whole review; not an ADR selection, source implementation or native admission. This closes the choices named by the073e2902 review. It is read with LINUX1724_NATIVE_REMOVAL_DESIGN.md, the complete inherited D1-D8 blueprint/review, ADR-002 and the ONE canonical F7 inventory. Unknown runtime inputs retain failure; source design completeness is separate from later direct qualification.

## Admission and irreversible state machine

S is a separately held, unfiltered privileged native supervisor. Actual CAP_SYS_ADMIN, CAP_SYS_PTRACE, supported native pidfds/cgroup/mount/object operations, CONFIG_SECCOMP_FILTER and CONFIG_CHECKPOINT_RESTORE are prerequisites. PTRACE_SECCOMP_GET_FILTER requires inspector seccomp mode DISABLED: filtered-container S is unsupported even if effective UID0. Actual first-input ROOT admission binds exact compiler/Node/libuv/V8/glibc/kernel/config/policy/loaded-source/ENV/role/control/crypto/resource/row bytes. Matching a release tag to uname is not running-binary attestation. All missing authority/capability rejects before original writes.

An early bootstrap filter denies kernel asynchronous/device/cross-process/namespace/credential escape mechanisms before Node initializes; ordinary immutable runtime mappings load while originals do not exist. After complete admitted module/native preload, a stricter all-thread inception filter denies all non-private-anonymous mappings before S exposes fresh originals. No io_uring SQPOLL/AIO/mutable-device/userfaultfd object may survive from before the mapping filter. No file mapping can later become an approved original through link/owner/name substitution. Original hardlinks/special objects and unexpected owner/object identities reject. No assumption that late seccomp cancels an earlier effect.

The supervisor state machine is monotonic:

| State | Native facts and allowed next transition |
|---|---|
| ADMITTED | All actual inputs/resources/actor channels verified, independent O active before dependent initialization; no originals yet. |
| INITIALIZED | Native bootstrap restrictions, immutable source/runtime preload, all-thread mapping restriction and actual ownership/namespace/cgroup/inheritance established. Create fresh originals only here. |
| ACTIVE | Original action/assertions run in W0; every creation, helper, lifetime, raw stream and original-capable syscall is tracked. No unknown direct launch/capability transport. |
| SETTLED | Real Core cleanup, strict registry classification and accepted union verified; other relevant W children/guardian positively exited and original streams reached EOF. R/U survival and separately owned settlement retain original order. Close launch authority. |
| PARKING | Request PTRACE_INTERRUPT on every recorded W0 thread and process every actual event until all are in an accepted parked class. Never infer final closure from a timeout or sampled task list. |
| PARKED | All TIDs/cgroup/native clone history agree; no original-capable operation/descriptor acquisition/async/device effect is in flight. Only the selected original W0 main barrier may resume. |
| SEALING | S permits only the actual native seccomp installation/control handshake syscalls in the barrier thread. Unexpected syscall, clone, death or nonzero TSYNC retains failure without deletion. Others remain stopped. |
| SEALED | Stop the barrier thread again. S inspects every exact live thread's actual filter chain and every permitted I/O object's held binding. Compare exact admitted BPF bytes; root/UID/channel/name-only receipts are insufficient. Release inspection duplicates, preserving actual original EOF ownership. |
| COPY_APPROVED | Resume W0 under terminal denial. S inventories, independently copies, flushes and verifies original/copy under continuous exclusion, with held original owner/no-redirection proof. Prior actor/stream/effect evidence stays mandatory. |
| REMOVING | Execute the original before/after validation hooks through finite native operations; reverify actual original/copy identity and approved inventory. Only S can issue exact approved-object unlink/disposition. Faults retain actual partial state and block reset. |
| REMOVED | Native approved-object absence proved. Only now return removal completion permitting the ORIGINAL W0 reset callback. |
| POST_REMOVAL | Same-isolate reset, unconditional actual hook/ENV restoration, real original/copy readback, error retention and final cleanup observations occur through the finite operation table below. No original capability is returned. |
| CLOSED | W0 actual native natural exit and original raw EOF plus independent persistent copy/failure readback are complete. Test result transport binds this complete source/recipe/lifetime, not merely exit0 or a JSON PASS. |
| FAILED | Absorbing no-new-launch/no-unapproved-delete/no-reset state. Retain original, independent copies/raw private errors and actual pending process handles until direct settlement. A failed transfer does not manufacture accessible custody. |

## Selected parked-state algorithm

S's genuine inception syscall ledger records entry/exit, native stop kind, full arguments, relevant FD object identity and clone/exec/lifetime events. W0 clone permits only the admitted pthread flag set with shared VM/files/sighand and same thread group; clone3 is denied with real ENOSYS and the admitted libc fallback is checked. W0 fork/vfork/exec and unshare are unavailable; S performs genuine registered helper/child launches. No external process shares W0's file table or original mappings.

PTRACE_INTERRUPT is used only to obtain an actual stop. Its return is never the proof. Accepted classes are:

| Class | Required source/native proof |
|---|---|
| SYSCALL_ENTRY | Genuine entry stop, complete preceding exit/effect ledger, no unresolved restart/async/original effect. Inception SECCOMP work already active. Resumption reaches seccomp after ptrace entry in the selected kernel. |
| USER_MEMORY_ONLY | Actual event stop with a completed preceding syscall and no active original effect. Original file mappings/device/async/cross-process paths are excluded from inception; stopped userspace can only modify non-original memory. |
| MEMORY_ONLY_BLOCKED | Actual interrupt/event/exit stop with the last recorded in-flight operation restricted to the selected wait catalog below. Every argument/object and restart path is accounted; its existing or restarted operation cannot access or mutate an original object. |
| UNKNOWN | Missing stop/entry/exit, D-state or original-capable in-flight operation, unknown object, restart/effect, new thread or mismatched lifetime. Retain failure; no inventory/delete. |

MEMORY_ONLY_BLOCKED permits only: futex wait/wait-bitset on W0's non-original memory; epoll_wait/epoll_pwait/epoll_pwait2 on the actual held eventpoll object; clock_nanosleep/nanosleep; and read on the authenticated native control socket when S's operation ledger proves no pending original effect. Epoll subscriptions are verified against the immutable admitted control/pipe/eventfd catalog; no unknown/device/inotify/original access callback is admitted. No write, file read/open/stat/rename/unlink/fsync/ioctl, descriptor-acquiring call, signal/control operation or generic syscall is a memory-only wait.

An interrupt may return or restart a wait. That is harmless only because the selected original wait and every possible restart-block target in the entire inception history are from this non-original wait catalog. S never rewrites registers/results or fabricates EINTR/completion. A pending original-capable call must genuinely settle under its original deadline, then reach a known entry/user stop; otherwise retain. The exact kernel's futex/epoll/signal/restart call graph and the admitted libc/libuv/V8 wait implementation belong to whole source review; unexpected restart targets fail the profile. Restart_syscall is allowed only for this certified non-original restart history, not as a universal bypass. No requirement that idle futex threads spontaneously return.

While releasing the barrier thread, S still gates its actual syscall entries: only installing the exact terminal filter and fixed control write/read handshake is permitted until it is reparked. The kernel install result and actual per-thread introspection must agree. Group exit/threads exiting during TSYNC, an unexpected filter chain or incomplete census is FAILED. Threads born before gate closure remain in the native ledger; no creation can be resumed during sealing. A task-list/cgroup comparison corroborates the exact event history but does not replace it.

## Terminal operation and held-object catalog

BPF checks native AUDIT_ARCH_X86_64 and denies x32/compat/unsupported entry ABIs. Any profile for another kernel/architecture needs separate review. The exact generated filter is derived from the native held catalog, not caller-supplied FD numbers.

| Operation class | Exact permitted syscall family / argument rule |
|---|---|
| Control/output | read/readv only on authenticated control/reply and admitted non-original pipe/eventfd read endpoints; write/writev only on those endpoints and actual stdout/stderr/test-result pipes. Held OFD/type/role/rights are verified before sealing. No original/device/unknown FD. |
| Event loop | epoll_wait/epoll_pwait/epoll_pwait2 on the held eventpoll catalog; epoll_ctl only for the fixed permitted non-original endpoint catalog and recognized ADD/MOD/DEL operations. No new epoll/eventfd/signalfd/timerfd/inotify object creation. |
| Descriptor close | close on an existing slot is allowed, including stdio/control during real teardown. This does NOT permit reuse: every descriptor-acquiring/rebinding syscall and any pre-seal in-flight acquisition is absent. S tracks actual close; future access to a closed slot yields the real kernel error. No permanent close denial that makes ordinary Node shutdown impossible. |
| Descriptor flags | fcntl GETFD/GETFL and SETFD with FD_CLOEXEC only for held non-original I/O roles; SETFL only the admitted NONBLOCK/access-mode bit mask on those roles. No duplication, owner/signal/lease/lock or unknown command. close_range is denied; ordinary individual closes remain genuine. |
| Anonymous memory | brk; mmap only MAP_PRIVATE+MAP_ANONYMOUS with fd=-1 and admitted memory flags; munmap/mprotect/madvise/mremap on W0's non-original address space. No file-backed or shared original mapping ever existed. No userfaultfd or device mapping. |
| Synchronization | futex/futex_time64 only admitted private-memory operations; rseq and set_robust_list within the non-original W0 address space. No cross-process VM/ptrace/namespace/credential operation. |
| Clock/resources | clock_gettime/gettimeofday/time, getrusage, getpid/getppid/gettid/getuid/geteuid/getgid/getegid, uname, sched_getaffinity and sched_yield; pure host/process observation or non-original memory output. |
| Signals/closure | rt_sigaction/rt_sigprocmask/rt_sigpending/rt_sigsuspend/rt_sigtimedwait/rt_sigreturn, sigaltstack; tgkill only W0's exact admitted TGID/TIDs and the admitted signal set; exit/exit_group. No foreign process signal. Core-dump output is excluded from inception with an irrevocable zero core limit. |
| Wait restarts | nanosleep/clock_nanosleep and restart_syscall only under the certified MEMORY_ONLY_BLOCKED history above. |
| Everything else | Deny, including open/openat/openat2/creat, socket/accept/pipe/eventfd/memfd/pidfd acquisition, dup/dup2/dup3/SCM_RIGHTS, stat/readlink on originals, original I/O/mutation, clone/fork/exec, ioctl, asynchronous I/O, identity/capabilities, new filters or namespace/cgroup/mount changes. Unknown genuine teardown fails visibly and requires a reviewed profile correction; it never bypasses original denial. |

Before actual policy dispatch, all numeric constants/argument widths, kernel restart targets and genuine Node/libuv/V8/syscall callers are compiled into the exact admitted source manifest. This catalog is an architecture selection proposal, not claimed running code. Policy high words/argument masks and integer arithmetic reject aliases/overflow. Native inspection must verify the complete filter tree, not just its count/latest caller-reported hash.

Allowing close is safe only with the stated no-in-flight-FD-acquisition proof and permanent acquisition/rebinding denial. S's inspection duplicate of a W0 pipe/socket endpoint is released before accepting its original EOF; K/O independent copies do not keep an unintended original writer alive. Closing control prematurely produces real failure/EOF, never a synthetic completed reset or copy proof.

## Protected filesystem operations after sealing

No monkey-patched fs and no caller-supplied path/owner authority. Explicit fixture adapters map the exact invocation's admitted object keys/recipes to S's held operations; ordinary defaults remain genuine Node fs and destructive refusal. Original assertions compare actual results/bytes/errno in W0 and same Error objects remain in W0. A native result may be decoded; original JS Error identity is never asserted across IPC.

| Original operation | Native disposition preserving its order and result |
|---|---|
| evidence.preserve | Enter the barrier before copying, then S performs actual complete held inventory/copy/flush/hash/privacy checks. Return only an authenticated result for that invocation/copy. |
| beforeRemoval / partial fault | The original callback still executes in W0. Its exact registered partial-unlink operation runs once in S on the already copied, held approved journal object, then W0 throws its original injected Error. No arbitrary caller path or bytes. Retain complete pre-fault copy and actual original remainder; no reset. |
| afterFinalValidation hook | Exact admitted native fault action or ordinary no-op, bound current state/object. Wrong recipe or late/replayed call rejects. The last-check adversary remains an actual filesystem intervention, not a modified assertion. |
| normal remove | S alone performs component-relative approved-object unlinkat under continuous exclusion and reports actual partial/complete state. No release-to-name-based rm. |
| reset | The original actual callback in the populated W0 isolate, only after native REMOVED. Injected reset Error is thrown/retained/asserted in that same isolate. |
| restore ENV/hooks | Actual original JS callbacks execute unconditionally in W0. Memory and admitted control remain available; no mock replacement. |
| copy-tamper write | Source-selected one-shot COPY_TAMPER_JOURNAL operation, admitted only for copy-tamper recipe in AFTER_REMOVED, actually writes CHANGED to the current held copy. S never grants original/write/path capability. Independent hash readback must observe the real corruption and mark evidence unresolved. |
| evidence.state / original readback | S performs actual held owner/object/name inventory and fstatat/openat reads with real errno. Original-root absence is checked against its held approved parent/name; no cached removed flag substitutes for observation. Finite approved original observations are S replies, not W0 original filesystem capability. |
| independent copy readFile | Actual K/S held-copy read with native type/identity/size/hash checks and current bytes. Tampered copy is not silently substituted with its earlier sealed counterpart. |
| evidence.release | Actual held guardian/object settlement, exact native results and original EOF. No receipt-only release. |
| finally rm(original) | Real approved-parent absence/remaining-object operation. Force suppresses actual ENOENT only; replacement/unknown objects reject and retain. No unrelated directory cleanup. |
| finally rm(copy/diagnostic) | Actual removal only after independently retaining and verifying the current complete failed/positive bytes and raw evidence under the selected O/K custody. The tampered current copy and original sealed copy are distinct preserved records. Failure to establish custody retains the objects and fails; no fabricated rm success. |
| retainErrors/report | Original raw JS errors are observed in the same isolate and retained through the selected independent native O protocol; public output stays the existing closed projection. Allocation/privacy/transport failure uses the pre-established independent channel, not public raw upload. |

S's fault operations are source-enumerated qualification actions bound by independently admitted recipe/state/sequence/object, not a general RPC. Only the privileged trusted effect issuer can perform them. Replay, arbitrary arguments, wrong owner/object or wrong phase is failure. Native lifecycle/protocol acknowledgments cannot manufacture real caller callback/error equality or native absence.

## One-shot registration and result

Seven formal phase wrappers, four positive custody wrappers and two recovered-primary recipes form the exact native recipe enumeration. R's entrypoint binds each immutable source wrapper/selector and launches its fresh W0 through the admitted native launcher. Inside W0 the actual shared test body and all original actions/assertions/callbacks run once. Metadata and ordinary negative/partial cases retain their source registration and fail-closed unsupported path; native adversaries additionally exercise registered exact fault recipes. No permanent revocation is reused for a later case.

R verifies the exact source/recipe, genuine W0 test result, actual native exit/code/signal and raw terminal EOF with independent O/K evidence. A JSON PASS, merely starting a process, or a source wrapper that skipped its body is insufficient. Test selectors skip only according to the existing protected selection semantics, and skipped rows never count as native acceptance. Real injected Error equality is tested within W0 before closed projection. R/U remain separate actual lifetimes and their protected survival/settlement assertions are unchanged.

## D4 Linux recipe dispositions

| Source/caller | Formal/recovered recipe disposition | Custody-positive disposition |
|---|---|---|
| src/server/index.ts / crash-runner / matrix action | Genuine Node API startup in crash W and recovered W0; source-bound same services/workspace/phase and immutable argv. | No Core startup in the four synthetic custody unit recipes. |
| test-helpers executable fixture generator | One matrix-service, autostart=true, private env in formal rows; install/config/setup/actions undefined. Generated exact Node executable/argv and assets frozen before native entry. | Exact journal/registry/interrupted or journal/remainder files; no service child. |
| execution supervisor / Linux managed child | Genuine registered Node fixture executable, original accepted fingerprint/history, streams, probe/error and closure contract; launch catalog retains rollback/resume lifetimes. | Adapter snapshot/stop/finalize/inspect callbacks are the original test callbacks; do not pretend these are native child acceptance. Native adversary rows supplement them. |
| process identity.ts / deadline.ts | Actual proc reads plus getconf CLK_TCK and conditional ps -p PID -o lstart=/exe=/args= fallback; exact held-target binding, actual helper deadline/signal/exit/EOF. The fallback is retained, not silently forbidden. | Original fixture-cleanup adapter only uses supplied callbacks. Native S validates actual root/role/process identities separately. |
| process tree.ts | Linux readLinuxProcessTable from proc; readPsProcessTable -axo pid=,ppid=,pgid=,state= belongs to non-Linux POSIX branch. Native ownership/lifetime observations remain genuine and Core accepted history independent. | No ordinary tree helper under supplied callbacks. |
| process listener.ts | Linux proc TCP/FD inspector. lsof -nP -iTCP:port -sTCP:LISTEN -t is Darwin-only; netstat is Windows-only. Complete native role/proc permission handling is required. | No API/listener. |
| private-json.ts / materialization.ts | Real Linux file/private JSON/materialization operations included. DPAPI native spawn and whoami/icacls are guarded Windows-only; Linux has no selected install/setup/config service action. Caller files remain in the full source closure. | Fixture files/evidence only. |
| root/ privacy guardian | Linux held-directory/privacy operations adapt to S's real approved objects. Windows PowerShell/C# guardian/privacy launch is excluded by actual platform branch, not relabeled Linux. | Same actual original/copy/diagnostic operations and registered fault recipes. |
| Windows native wrapper/target/directory-sync | Actual Windows-only source branches excluded from Linux recipes; never claim Windows acceptance. Include provenance/caller sources in the complete inherited review. | Not executed on Linux. |
| direct crash / U / injected helpers | Genuine native registered crash Node and R-owned U Node; original private/raw limits, same Error observers and native EOF. No direct unregistered launch under W0 filter. | No direct child in original positives; native adversaries declare their own actual roles. |

Each row's final source freeze records actual path/blob/tool/argv/caller/phase tuple and guards. The source table identifies the branch disposition; it is not a token catalog that allows arbitrary code. Product/package/binary source changes require renewed whole input binding before activation.

## D8 finite positive profile and observed input sizes

Retained fd246b4a originals were independently audited as tar METADATA only; no private file contents read/published and no product/native execution. All seven original trees contain45 entries/32 regular files. Bytes by phase: allocation_reserved36897, configuration_materialized37212, generation_committed40303, owned_readiness_proven37138, ownership_persisted36897, preflight_reconciliation37000, process_spawned36717. Largest regular file10513 bytes. These are existing failed-run sizing observations, not new native acceptance or all future input proof. The custody success recipe creates three small literal files; reset/environment/copy-tamper recipes create the two literal journal/remainder files.

The proposed qualification profile requires originals <=128 entries, each <=8MiB, total <=64MiB; fixed names/depth/components and all generated inputs have checked lengths. It preserves full original assertions, not a clipped inventory. Any admitted source-generated fixture exceeding the profile rejects before sensitive writes and requires renewed reviewed input/profile; no unknown input silently inherits the historical4096 limits.

Per recipe reserve distinct capacity for original+verified copy+pre-fault copy+current failed copy, O raw/control/error, K readback, ciphertext/index/manifest, T/G original captures and C own persistence. Checked cumulative13-recipe accounting includes seven formal, four positives and two recovered rows. Data and terminal/control queues are separate; stdout/stderr/raw sequence count upper bound is admitted RAW BYTE COUNT plus independent control/terminal frames, because one-byte frames are possible. No ceil(bytes/maxPayload) claim. Each source-enumerated helper/control interaction contributes separately to source-derived launch/event/control maxima; exact native launches/frames and positive fit are measured after permitted admission and bound to the final compiled recipe. Unknown suffix/overflow remains explicit unavailable with retained failure, not fabricated full capture.

The source design selects the derivation method and genuine existing fixture data; final numeric helper/error/control/crypto reservations and all actual F7 resource capacities are still final-input dependencies. They are not universal guarantees over arbitrary operating-system/error graphs. No memory/resource charge is hidden in another actor or borrowed from unknown Core baseline allowances; actual S/O/K/W0/child storage and memory must satisfy the existing qualification profiles before activation.

## Source authoring and activation distinction

A whole reviewer must assess this selected algorithm/catalog and remaining final-input derivations before the conductor selects the ADR amendment and source authoring. Native running behavior, positive Node teardown/filters, actual kernel/config/UID/cgroup/namespace and F7 external custody remain unqualified until complete source review and NEW actual-input admission. The exact source implementation cannot be a declaration of unsupported capability, mock O or interface skeleton. Source consumers cannot invent the absent canonical U1/U2/U3 components; their actual source/actor/resource dependency remains explicit.
