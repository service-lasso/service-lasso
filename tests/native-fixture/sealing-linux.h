#ifndef SERVICE_LASSO_SEALING_LINUX_H
#define SERVICE_LASSO_SEALING_LINUX_H

#include "thread-history-linux.h"
#include "filter-inspection-linux.h"
#include "task-census-linux.h"

struct lf_seal_memory_read {
  uintptr_t address;
  size_t requested;
  ssize_t actual;
  int native_error;
};
struct lf_sealing_inputs {
  int held_proc_directory;
  int held_workload_cgroup;
  struct lf_filter_view early[2];
  const struct lf_fd_binding *nonoriginals;
  size_t nonoriginal_count;
  struct lf_fd_census_record *before_fd_records;
  struct lf_fd_census_record *after_fd_records;
  size_t fd_record_capacity;
  struct lf_filter_readback *before_filter_records;
  struct lf_filter_readback *after_filter_records;
  size_t filter_record_capacity;
};
struct lf_sealing {
  bool begun;
  bool failed;
  bool verified;
  int native_error;
  int rejection_error;
  uint64_t entry_ordinal;
  size_t start_record_count;
  pid_t tids[LF_POLICY_THREADS];
  size_t tid_count;
  struct lf_gate_observation wait_observations[LF_POLICY_THREADS];
  struct lf_sealing_inputs held_inputs;
  struct lf_fd_binding held_nonoriginals[LF_POLICY_FDS];
  struct lf_terminal_policy early[2];
  struct sock_fprog actual_program;
  struct sock_filter actual_instructions[LF_POLICY_INSNS];
  struct lf_seal_memory_read reads[2];
  size_t read_count;
  struct lf_trace_observation actual_install_exit;
  struct lf_fd_census_observation before_fds;
  struct lf_fd_census_observation after_fds;
  struct lf_filter_inspection before_filters;
  struct lf_filter_inspection after_filters;
  struct lf_task_census before_tasks;
  struct lf_task_census after_tasks;
};

/* Internal trusted S, once-zero-initialized state and continuously held inputs.
 * Complete independently established PARKED/effect/owner-callback/task/cgroup/
 * inception/root/mapping/O facts must already hold. Neither numeric handles
 * nor these local checks fabricate those facts. Other threads stay parked.
 * Uses real SAME-OFD full-table census and actual early-chain inspection;
 * reads the exact actual W root seccomp fprog/instructions without changing
 * memory/registers; only the precise TSYNC call may genuinely resume.
 * All buffers/objects are private pre-reserved, disjoint and retained by S/O.
 * Early source programs and held bindings remain immutable through finish.
 * Failure retains the one-way hold; no retry, deletion or reset permission.
 */
int lf_sealing_begin(struct lf_sealing *, struct lf_thread_history *,
                      const struct lf_sealing_inputs *);

/* S captures the real next event through lf_thread_history_next, then calls
 * this. Returns0 only while no new event is captured,1 after actual install
 * return0 plus every live thread's complete exact three-filter readback and
 * another full SAME-OFD non-original table census; -1 on retained failure.
 * Any intervening event/clone/death/signal or nonzero TSYNC fails this finite
 * transaction. It grants normal terminal continuation only, never copy/
 * deletion/reset/custody authority. No W success message participates.
 */
int lf_sealing_finish(struct lf_sealing *, struct lf_thread_history *);

#endif
