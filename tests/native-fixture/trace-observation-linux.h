#ifndef SERVICE_LASSO_TRACE_OBSERVATION_LINUX_H
#define SERVICE_LASSO_TRACE_OBSERVATION_LINUX_H

#include <signal.h>
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include <sys/types.h>

enum lf_trace_stop {
  LF_TRACE_SYSCALL_ENTRY,
  LF_TRACE_SYSCALL_EXIT,
  LF_TRACE_SECCOMP,
  LF_TRACE_CLONE,
  LF_TRACE_FORK,
  LF_TRACE_VFORK,
  LF_TRACE_EXEC,
  LF_TRACE_EXIT_EVENT,
  LF_TRACE_INTERRUPT_OR_GROUP,
  LF_TRACE_SIGNAL,
  LF_TRACE_NATIVE_EXIT,
  LF_TRACE_UNKNOWN
};

struct lf_trace_observation {
  pid_t tid;
  int actual_wait_status;
  enum lf_trace_stop stop;
  unsigned int ptrace_event;
  unsigned long native_event_value;
  int stop_signal;
  int native_error;
  long native_result;
  uint32_t architecture;
  uint64_t instruction_pointer;
  uint64_t stack_pointer;
  uint64_t syscall_number;
  uint64_t arguments[6];
  int64_t syscall_result;
  bool syscall_is_error;
  uint32_t seccomp_data;
  bool has_signal_info;
  siginfo_t actual_signal_info;
};

/* Caller supplies an ORIGINAL actual waitpid/__WALL result for its held thread
 * ledger, never a caller PID/status projection. Every raw native observation
 * is private O input. Stops do not themselves prove quiescence/effect drain.
 * Actual complete entry/exit/clone/restart/object history remains mandatory. */
int lf_trace_observe(pid_t tid, int actual_wait_status,
                     struct lf_trace_observation *);

/* Genuine SEIZE before admitted original work; never attaches an arbitrary
 * caller PID. Exact native creation/lifetime/cgroup/observer proof is separate.
 * EXITKILL is intentionally absent: S death must not destroy retained W0 and
 * manufacture closed original capability/evidence without native custody. */
int lf_trace_seize(pid_t held_tid);
int lf_trace_interrupt(pid_t held_tid);

/* Actual syscall tracing continuation. A positive delivered signal must match
 * the original signal-delivery stop/siginfo; no register/result/signal rewrite.
 * Group/unknown/dead/exit-event stops require explicit state-machine handling.
 * Caller still owns absolute deadlines and closed stage/launch authority. */
int lf_trace_resume(const struct lf_trace_observation *, int delivery_signal);

#endif
