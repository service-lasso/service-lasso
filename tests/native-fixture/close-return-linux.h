#ifndef SERVICE_LASSO_CLOSE_RETURN_LINUX_H
#define SERVICE_LASSO_CLOSE_RETURN_LINUX_H

#include "thread-history-linux.h"

struct lf_close_return_record {
  uint64_t object_key;
  int workload_fd;
  pid_t closing_tid;
  uint64_t entry_ordinal;
  uint64_t exit_ordinal;
  uint64_t next_entry_ordinal;
  struct lf_trace_observation actual_exit;
};
struct lf_close_return {
  bool begun;
  bool complete;
  bool failed;
  int rejection_error;
  size_t record_count;
  struct lf_close_return_record records[LF_POLICY_FDS];
};

/* Internal S's actual retained inception/gate history, not W close receipts.
 * Each registered original slot needs one independently SAME-OFD-approved
 * genuine close entry, paired actual exit0, then that SAME closing thread's
 * next genuine entry. The latter is the selected kernel's post-userspace-return
 * checkpoint; exit-stop alone is insufficient for deferred release/task work.
 * Original signals/results are untouched; error exits and missing/ambiguous
 * chronology reject. No Node callback/promise/owner closure is fabricated.
 * Genuine owner callbacks, earlier original-effect history, no mappings/async,
 * complete original register and independent current census remain separate
 * mandatory facts. Count0 cannot prove absence of historical effects.
 * Fresh zero-initialized private output only; no erase/retry after failure.
 * This module reads history, never resumes/closes/deletes/resets any object.
 */
int lf_close_return_check(const struct lf_thread_history *, struct lf_close_return *);

#endif
