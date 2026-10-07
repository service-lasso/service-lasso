#ifndef SERVICE_LASSO_THREAD_HISTORY_LINUX_H
#define SERVICE_LASSO_THREAD_HISTORY_LINUX_H

#include "trace-observation-linux.h"
#include "terminal-policy-linux.h"

struct lf_thread_history_entry {
  pid_t tid;
  pid_t creator_tid;
  bool awaiting_birth_stop;
  bool syscall_pending;
  bool exit_announced;
  bool actually_exited;
  bool currently_stopped;
  pid_t pending_clone_tid;
  bool inherited_clone_return_pending;
  uint64_t syscall_number;
  uint64_t arguments[6];
  uint64_t entry_ordinal;
  uint64_t exit_ordinal;
  bool has_restart_result;
  int64_t restart_result;
  struct lf_trace_observation last_observation;
};
struct lf_thread_history_record {
  struct lf_trace_observation actual;
  bool awaiting_creator_event;
};
struct lf_thread_history {
  pid_t root_tid;
  pid_t held_process_group;
  uint64_t admitted_pthread_flags;
  struct lf_thread_history_entry threads[LF_POLICY_THREADS];
  size_t thread_count;
  struct lf_thread_history_record *records;
  size_t record_count;
  size_t record_capacity;
  bool failed;
  int native_error;
  int rejection_error;
};

/* Trusted native S has created/seized THIS fresh root before admitted work,
 * holds its actual lifetime, and fixed its exclusive native process group.
 * No caller packet/PID/group/clone flags establishes that creator authority.
 * Arrange the next genuine traced stop to be syscall ENTRY before originals
 * exist; do not discard an already-consumed entry then begin at its exit.
 * Previous creator/initial executable events remain separately captured.
 * Inherited
 * descriptor/runtime/namespace/filter admission is a separate mandatory gate.
 * Root is the only initial thread; every later birth needs a real clone event.
 * Records are reserved before capture and never overwritten on exhaustion.
 */
int lf_thread_history_begin(struct lf_thread_history *, pid_t root_tid,
    pid_t held_process_group, uint64_t admitted_pthread_flags,
    struct lf_thread_history_record *, size_t record_capacity);

/* Calls actual waitpid on the creator's exclusive group with __WALL/WNOHANG,
 * then real ptrace observation. Returns1 for a retained native event,0 when
 * none is presently available,-1 on genuine error or failed history. Never
 * resumes/reaps an unrelated process group or infers exit/EOF from no event.
 * A newborn stop can arrive before its parent's clone event; it is retained
 * pending correlation and cannot resume or count as a proved live member yet.
 * Caller still owns actual absolute deadlines and independently persisted O.
 */
int lf_thread_history_next(struct lf_thread_history *);

/* Only a first synthetic PTRACE_EVENT_STOP of a genuinely correlated clone may
 * suppress its tracing birth stop. All other resumes use lf_trace_resume's
 * original-signal rule. No registers, syscall results or user signals change.
 */
int lf_thread_history_resume(struct lf_thread_history *, pid_t tid);

/* This module records actual lifecycle/syscall chronology only. It cannot
 * authorize drain, PARKED/TSYNC, deletion or reset. Original FD/effect/restart
 * classification, current full task/cgroup census, bootstrap/mapping filters,
 * actual owner callbacks and independent no-original references remain gates.
 * In particular an exit stop or interrupt is never a completed-effect proof.
 */
#endif
