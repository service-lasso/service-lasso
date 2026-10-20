#ifndef SERVICE_LASSO_FILTER_INSPECTION_LINUX_H
#define SERVICE_LASSO_FILTER_INSPECTION_LINUX_H

#include "terminal-policy-linux.h"

#define LF_INSPECTION_FILTERS 8u

struct lf_filter_view {
  const struct sock_filter *instructions;
  size_t count;
};
struct lf_filter_readback {
  pid_t tid;
  size_t offset;
  long native_result;
  size_t requested_count;
  size_t count;
  struct sock_filter instructions[LF_POLICY_INSNS];
};
enum lf_inspection_stage {
  LF_INSPECTION_INPUT,
  LF_INSPECTION_PRIVILEGE,
  LF_INSPECTION_LENGTH,
  LF_INSPECTION_BYTES,
  LF_INSPECTION_COMPARE,
  LF_INSPECTION_NO_EXTRA,
  LF_INSPECTION_COMPLETE
};
struct lf_filter_inspection {
  enum lf_inspection_stage stage;
  pid_t tid;
  size_t offset;
  long native_result;
  int native_error;
  size_t readback_count;
};

/* Actual inspector privilege, not CONFIG/support attestation. An actual
 * PTRACE_SECCOMP_GET_FILTER read before originals must additionally qualify
 * CONFIG_CHECKPOINT_RESTORE, tracer relationship and the running kernel. */
int lf_filter_inspector_privilege(void);

/* Caller is the actual tracer with every original W0 thread still parked and
 * matched to its complete held inception/lifetime ledger. Numeric TIDs alone
 * do not meet this precondition. Every result/byte and failure is private O
 * input; independent custody is not performed or inferred by this component.
 * Expected order is OLDEST FIRST at selected c21a03 kernel: bootstrap,
 * mapping restriction, terminal. Records are caller-pre-reserved (no malloc).
 * All expected filters on every exact thread, followed by actual ENOENT, are
 * required. No count/hash-only fallback or resumption during inspection. */
int lf_filter_inspect_all(const pid_t *tids, size_t tid_count,
    const struct lf_filter_view *oldest_first, size_t filter_count,
    struct lf_filter_readback *records, size_t record_capacity,
    struct lf_filter_inspection *observation);

#endif
