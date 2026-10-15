#ifndef SERVICE_LASSO_INCEPTION_POLICY_LINUX_H
#define SERVICE_LASSO_INCEPTION_POLICY_LINUX_H

#include <linux/filter.h>
#include <stddef.h>
#include <stdint.h>
#include <sys/types.h>

#define LF_INCEPTION_INSNS 512u
struct lf_inception_policy {
  struct sock_filter instructions[LF_INCEPTION_INSNS];
  size_t count;
};

/* Trusted creator's actual shared-pthread flags and permanently held private
 * credential-only control slot, never numbers/authority from a W0 request.
 * Bootstrap is installed before the initial admitted Node image runs. It
 * allows the creator's initial execve, whose actual held image/argv/ENV and
 * lifetime are independently enforced by S. No originals exist in that phase.
 * Shared pthread clone only; clone3 gets genuine ENOSYS for admitted fallback.
 * Every later fork/exec/helper still needs S's exact registered launch ingress.
 * Default allow here covers ordinary runtime initialization, NOT terminal
 * original exclusion. Actual descriptors/views/loader/filter/entry history
 * and source-owned no-ancillary issuer remain mandatory separate gates.
 */
int lf_bootstrap_policy_build(pid_t held_tgid, uint64_t admitted_pthread_flags,
    int held_control_fd, struct lf_inception_policy *);

/* Stack after the complete immutable module/native/runtime preload, before
 * creating originals. Denies file/shared mmap and subsequent exec. Actual
 * all-thread TSYNC/filter-byte readback and original-free inception are required
 * before exposing originals. Bootstrap stays in every thread's filter chain.
 */
int lf_mapping_policy_build(struct lf_inception_policy *);

/* Genuine kernel result, including positive unsynchronized TID; never an ACK
 * or introspection/census proof. no_new_privs/real role setup occurs upstream.
 */
long lf_inception_policy_install(const struct lf_inception_policy *,
                                uint32_t actual_seccomp_flags);

#endif
