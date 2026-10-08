#ifndef SERVICE_LASSO_PARKED_WAIT_LINUX_H
#define SERVICE_LASSO_PARKED_WAIT_LINUX_H

#include "entry-gate-linux.h"

/* Internal trusted S classification of an ACTUAL preceding entry retained in
 * its inception history, with the same thread currently genuinely stopped.
 * Only private futex WAIT/WAIT_BITSET, sleeps, immutable held epoll waits and
 * fixed credential-only recvmsg are candidates. All mappings, subscriptions,
 * no-FD issuer, native lifetimes and preceding original effects must already
 * be proved by the complete inception/settlement ledger. A syscall number or
 * a cooperative waiting flag is never that proof. This does not discharge
 * earlier restart history or classify userspace/unknown/group stops.
 * The policy and bindings are source-owned held NON-ORIGINAL objects only.
 * Returns1 for the finite wait class, -1 retaining actual inspections/errors.
 * Inspection duplicates close once without closing any workload slot.
 */
int lf_parked_wait_check(const struct lf_trace_observation *actual_entry,
    const struct lf_terminal_policy *, int held_pidfd,
    const struct lf_fd_binding *nonoriginals, size_t nonoriginal_count,
    struct lf_gate_observation *);

#endif
