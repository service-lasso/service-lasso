#ifndef SERVICE_LASSO_ENTRY_GATE_LINUX_H
#define SERVICE_LASSO_ENTRY_GATE_LINUX_H

#include "fd-census-linux.h"
#include "trace-observation-linux.h"

struct lf_gate_observation {
  pid_t tid;
  uint64_t syscall_number;
  uint32_t policy_verdict;
  int original_fd;
  long actual_comparison;
  struct stat actual_original;
  int native_error;
  int duplicate_close_error;
  int rejection_error;
};
struct lf_entry_gate {
  bool closed;
  bool failed;
  int held_pidfd;
  struct lf_terminal_policy policy;
  struct lf_policy_fd nonoriginals[LF_POLICY_FDS];
  size_t nonoriginal_count;
  struct lf_fd_binding originals[LF_POLICY_FDS];
  bool original_close_entered[LF_POLICY_FDS];
  size_t original_count;
  struct lf_gate_observation last_observation;
};

/* Internal trusted S state only. Inputs originate from actual independently
 * inspected held non-original objects and genuine original owner/FD bindings,
 * not W0 JSON/cooperative FD lists. All W0 threads are stopped, no acquisition
 * is in flight, and complete SETTLED/source/inception proofs precede closure.
 * Original bindings authorize ONLY normal owner close, never arbitrary I/O.
 * Closure is one-way. Reinitialization/failure cannot broaden permissions.
 * This object must be zero-initialized before its first/only close call.
 */
int lf_entry_gate_close(struct lf_entry_gate *, int held_pidfd,
    const struct lf_terminal_catalog *, const struct lf_fd_binding *originals,
    size_t original_count);

/* Actual original syscall-entry observation from the held thread history.
 * Return1 permits S's genuine continuation; return-1 retains the native stop
 * and failure. No syscall register/result is rewritten and no W0 errno/ACK
 * is fabricated. Before resuming a registered original close, pidfd_getfd/
 * KCMP_FILE independently check SAME OFD, retaining actual inspection errors.
 * An inspection duplicate is closed once; that never closes W0's slot.
 * S's inspection close effects belong to its own captured durability ledger.
 * Non-original slots cannot rebind after the one-way acquisition gate closes.
 */
int lf_entry_gate_check(struct lf_entry_gate *,
                        const struct lf_trace_observation *);

/* Exact source-built BPF evaluation on an actual entry, used by S's entry gate.
 * Reject unknown instructions/jumps/offsets rather than interpreting a wider
 * program. It is not kernel installation/introspection or object authority.
 */
int lf_policy_entry_verdict(const struct lf_terminal_policy *,
    const struct lf_trace_observation *, uint32_t *actual_verdict);

#endif
