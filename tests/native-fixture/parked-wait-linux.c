#define _GNU_SOURCE
#include "parked-wait-linux.h"

#include <errno.h>
#include <limits.h>
#include <linux/futex.h>
#include <linux/kcmp.h>
#include <linux/seccomp.h>
#include <string.h>
#include <sys/syscall.h>
#include <unistd.h>

#if !defined(__linux__) || !defined(__x86_64__)
#error "The admitted parked-wait ABI is Linux x86_64"
#endif

static int failed(struct lf_gate_observation *observation,
                  int native_error, int error) {
  observation->native_error = native_error;
  observation->rejection_error = error;
  errno = error; return -1;
}

int lf_parked_wait_check(const struct lf_trace_observation *entry,
    const struct lf_terminal_policy *policy, int pidfd,
    const struct lf_fd_binding *bindings, size_t count,
    struct lf_gate_observation *observation) {
  if (!observation) { errno = EINVAL; return -1; }
  memset(observation, 0, sizeof(*observation));
  observation->original_fd = -1;
  observation->actual_comparison = -1;
  if (!entry || entry->tid <= 0 || pidfd < 0 || !policy || !bindings ||
      !count || count > LF_POLICY_FDS)
    return failed(observation, 0, EINVAL);
  observation->tid = entry->tid;
  observation->syscall_number = entry->syscall_number;
  uint32_t verdict = 0;
  if (lf_policy_entry_verdict(policy, entry, &verdict) < 0)
    return failed(observation, 0, errno);
  observation->policy_verdict = verdict;
  if (verdict != SECCOMP_RET_ALLOW) return failed(observation, 0, EPERM);

  if (entry->syscall_number == SYS_futex) {
    uint64_t command = entry->arguments[1];
    if (command > UINT32_MAX || !(command & FUTEX_PRIVATE_FLAG))
      return failed(observation, 0, EPROTO);
    uint64_t operation = command & FUTEX_CMD_MASK;
    if (operation != FUTEX_WAIT && operation != FUTEX_WAIT_BITSET)
      return failed(observation, 0, EPERM);
    if (operation == FUTEX_WAIT && (command & FUTEX_CLOCK_REALTIME))
      return failed(observation, 0, EPERM);
    return 1;
  }
  if (entry->syscall_number == SYS_nanosleep ||
      entry->syscall_number == SYS_clock_nanosleep) return 1;

  uint32_t required = 0;
  if (entry->syscall_number == SYS_epoll_wait ||
      entry->syscall_number == SYS_epoll_pwait
#ifdef SYS_epoll_pwait2
      || entry->syscall_number == SYS_epoll_pwait2
#endif
      ) required = LF_FD_EPOLL;
  else if (entry->syscall_number == SYS_recvmsg) required = LF_FD_CONTROL;
  else return failed(observation, 0, EPERM);

  if (entry->arguments[0] > INT_MAX) return failed(observation, 0, EPROTO);
  int fd = (int)entry->arguments[0];
  const struct lf_fd_binding *binding = NULL;
  for (size_t i = 0; i < count; i++) {
    if (bindings[i].workload_fd != fd) continue;
    if (binding || bindings[i].held_fd < 0 || !bindings[i].object_key ||
        !(bindings[i].rights & required))
      return failed(observation, 0, EPROTO);
    binding = &bindings[i];
  }
  if (!binding) return failed(observation, 0, EPERM);
  int duplicate = (int)syscall(SYS_pidfd_getfd, pidfd, fd, 0);
  if (duplicate < 0) return failed(observation, errno, errno);
  int primary = 0, rejection = 0;
  if (fstat(duplicate, &observation->actual_original) < 0) {
    primary = rejection = errno;
  } else {
    pid_t self = getpid();
    errno = 0;
    long actual = syscall(SYS_kcmp, self, self, KCMP_FILE,
                          (unsigned long)duplicate,
                          (unsigned long)binding->held_fd);
    observation->actual_comparison = actual;
    if (actual != 0) {
      primary = actual < 0 ? errno : 0;
      rejection = primary ? primary : ESTALE;
    }
  }
  if (close(duplicate) < 0) {
    observation->duplicate_close_error = errno;
    if (!rejection) primary = rejection = errno;
  }
  if (rejection) return failed(observation, primary, rejection);
  return 1;
}
