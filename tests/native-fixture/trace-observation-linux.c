#define _GNU_SOURCE
#include <stdbool.h>
#include "trace-observation-linux.h"

#include <errno.h>
#include <linux/audit.h>
#include <sys/ptrace.h>
#include <linux/ptrace.h>
#include <string.h>
#include <sys/wait.h>

static int observed_failure(struct lf_trace_observation *observation,
                             long result, int error) {
  observation->native_result = result;
  observation->native_error = error;
  errno = error; return -1;
}

int lf_trace_seize(pid_t held_tid) {
  if (held_tid <= 0) { errno = EINVAL; return -1; }
  unsigned long options = PTRACE_O_TRACESYSGOOD | PTRACE_O_TRACECLONE |
      PTRACE_O_TRACEFORK | PTRACE_O_TRACEVFORK | PTRACE_O_TRACEEXEC |
      PTRACE_O_TRACEEXIT | PTRACE_O_TRACESECCOMP;
  return (int)ptrace(PTRACE_SEIZE, held_tid, NULL, (void *)(uintptr_t)options);
}
int lf_trace_interrupt(pid_t held_tid) {
  if (held_tid <= 0) { errno = EINVAL; return -1; }
  return (int)ptrace(PTRACE_INTERRUPT, held_tid, NULL, NULL);
}

int lf_trace_observe(pid_t tid, int actual_wait_status,
                     struct lf_trace_observation *observation) {
  if (!observation) { errno = EINVAL; return -1; }
  memset(observation, 0, sizeof(*observation));
  observation->tid = tid;
  observation->actual_wait_status = actual_wait_status;
  observation->stop = LF_TRACE_UNKNOWN;
  if (tid <= 0) return observed_failure(observation, -1, EINVAL);
  if (WIFEXITED(actual_wait_status) || WIFSIGNALED(actual_wait_status)) {
    observation->stop = LF_TRACE_NATIVE_EXIT; return 0;
  }
  if (!WIFSTOPPED(actual_wait_status))
    return observed_failure(observation, -1, EPROTO);
  int signal = WSTOPSIG(actual_wait_status);
  unsigned int event = (unsigned int)actual_wait_status >> 16;
  observation->stop_signal = signal; observation->ptrace_event = event;
  if (event == PTRACE_EVENT_STOP) {
    /* An interrupt stop is an observation only. Group stops can have SIGSTOP,
     * SIGTSTP/SIGTTIN/SIGTTOU: do not silently resume/suppress their semantics. */
    observation->stop = LF_TRACE_INTERRUPT_OR_GROUP; return 0;
  }
  if (event && signal != SIGTRAP)
    return observed_failure(observation, -1, EPROTO);
  if (event && event != PTRACE_EVENT_SECCOMP) {
    switch (event) {
      case PTRACE_EVENT_CLONE: observation->stop = LF_TRACE_CLONE; break;
      case PTRACE_EVENT_FORK: observation->stop = LF_TRACE_FORK; break;
      case PTRACE_EVENT_VFORK: observation->stop = LF_TRACE_VFORK; break;
      case PTRACE_EVENT_EXEC: observation->stop = LF_TRACE_EXEC; break;
      case PTRACE_EVENT_EXIT: observation->stop = LF_TRACE_EXIT_EVENT; break;
      default: return observed_failure(observation, -1, EPROTO);
    }
    errno = 0;
    long result = ptrace(PTRACE_GETEVENTMSG, tid, NULL,
                         &observation->native_event_value);
    if (result < 0) return observed_failure(observation, result, errno);
    observation->native_result = result; return 0;
  }
  if (signal == (SIGTRAP | 0x80) || event == PTRACE_EVENT_SECCOMP) {
    struct ptrace_syscall_info info;
    memset(&info, 0, sizeof(info));
    errno = 0;
    long result = ptrace(PTRACE_GET_SYSCALL_INFO, tid,
                         (void *)(uintptr_t)sizeof(info), &info);
    if (result < 0) return observed_failure(observation, result, errno);
    observation->native_result = result;
    if ((size_t)result < offsetof(struct ptrace_syscall_info, entry) ||
        info.arch != AUDIT_ARCH_X86_64)
      return observed_failure(observation, result, EPROTO);
    /* Older admitted headers call bytes1-3 padding; selected kernel exposes
     * flags/reserved there. Unknown nonzero values cannot inherit this profile. */
    const unsigned char *prefix = (const unsigned char *)&info;
    if (prefix[1] || prefix[2] || prefix[3] ||
        (event == PTRACE_EVENT_SECCOMP && info.op != PTRACE_SYSCALL_INFO_SECCOMP) ||
        (!event && info.op != PTRACE_SYSCALL_INFO_ENTRY &&
                    info.op != PTRACE_SYSCALL_INFO_EXIT))
      return observed_failure(observation, result, EPROTO);
    observation->architecture = info.arch;
    observation->instruction_pointer = info.instruction_pointer;
    observation->stack_pointer = info.stack_pointer;
    if (info.op == PTRACE_SYSCALL_INFO_ENTRY ||
        info.op == PTRACE_SYSCALL_INFO_SECCOMP) {
      size_t needed = info.op == PTRACE_SYSCALL_INFO_ENTRY
          ? offsetof(struct ptrace_syscall_info, entry.args) + sizeof(info.entry.args)
          : offsetof(struct ptrace_syscall_info, seccomp.ret_data) + sizeof(info.seccomp.ret_data);
      if ((size_t)result < needed || (info.entry.nr & UINT64_C(0x40000000)))
        return observed_failure(observation, result, EPROTO);
      observation->syscall_number = info.entry.nr;
      memcpy(observation->arguments, info.entry.args,
              sizeof(observation->arguments));
      observation->stop = info.op == PTRACE_SYSCALL_INFO_ENTRY
          ? LF_TRACE_SYSCALL_ENTRY : LF_TRACE_SECCOMP;
      if (info.op == PTRACE_SYSCALL_INFO_SECCOMP)
        observation->seccomp_data = info.seccomp.ret_data;
    } else if (info.op == PTRACE_SYSCALL_INFO_EXIT) {
      size_t needed = offsetof(struct ptrace_syscall_info, exit.is_error) +
          sizeof(info.exit.is_error);
      if ((size_t)result < needed)
        return observed_failure(observation, result, EPROTO);
      observation->stop = LF_TRACE_SYSCALL_EXIT;
      observation->syscall_result = info.exit.rval;
      observation->syscall_is_error = info.exit.is_error != 0;
    } else return observed_failure(observation, result, EPROTO);
    return 0;
  }
  errno = 0;
  long result = ptrace(PTRACE_GETSIGINFO, tid, NULL,
                       &observation->actual_signal_info);
  if (result < 0) return observed_failure(observation, result, errno);
  observation->native_result = result;
  if (observation->actual_signal_info.si_signo != signal)
    return observed_failure(observation, result, EPROTO);
  observation->has_signal_info = true;
  observation->stop = LF_TRACE_SIGNAL; return 0;
}

int lf_trace_resume(const struct lf_trace_observation *observation,
                     int delivery_signal) {
  if (!observation || observation->tid <= 0 || delivery_signal < 0 ||
      observation->native_error ||
      observation->stop == LF_TRACE_UNKNOWN ||
      observation->stop == LF_TRACE_NATIVE_EXIT ||
      observation->stop == LF_TRACE_EXIT_EVENT) { errno = EINVAL; return -1; }
  if (observation->stop == LF_TRACE_INTERRUPT_OR_GROUP &&
      observation->stop_signal != SIGTRAP) { errno = EPROTO; return -1; }
  if (observation->stop == LF_TRACE_SIGNAL) {
    if (!observation->has_signal_info ||
        delivery_signal != observation->actual_signal_info.si_signo) {
      errno = EPROTO; return -1;
    }
  } else if (delivery_signal != 0) { errno = EPROTO; return -1; }
  return (int)ptrace(PTRACE_SYSCALL, observation->tid, NULL,
                      (void *)(uintptr_t)delivery_signal);
}
