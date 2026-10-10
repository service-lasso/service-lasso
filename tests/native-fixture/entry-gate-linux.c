#define _GNU_SOURCE
#include "entry-gate-linux.h"

#include <errno.h>
#include <limits.h>
#include <linux/audit.h>
#include <linux/kcmp.h>
#include <linux/seccomp.h>
#include <string.h>
#include <sys/syscall.h>
#include <unistd.h>

#if !defined(__linux__) || !defined(__x86_64__)
#error "The admitted entry-gate ABI is Linux x86_64"
#endif

static int fail(struct lf_entry_gate *gate, int native_error, int error) {
  gate->failed = true;
  gate->last_observation.native_error = native_error;
  gate->last_observation.rejection_error = error;
  errno = error; return -1;
}
int lf_policy_entry_verdict(const struct lf_terminal_policy *policy,
    const struct lf_trace_observation *actual, uint32_t *verdict) {
  if (!policy || !policy->count || policy->count > LF_POLICY_INSNS ||
      !actual || actual->stop != LF_TRACE_SYSCALL_ENTRY || actual->native_error ||
      actual->architecture != AUDIT_ARCH_X86_64 ||
      actual->syscall_number > UINT32_MAX || !verdict) {
    errno = EINVAL; return -1;
  }
  const struct seccomp_data data = {
    .nr = (int)(uint32_t)actual->syscall_number,
    .arch = actual->architecture,
    .instruction_pointer = actual->instruction_pointer,
    .args = {actual->arguments[0], actual->arguments[1], actual->arguments[2],
             actual->arguments[3], actual->arguments[4], actual->arguments[5]}
  };
  uint32_t accumulator = 0;
  size_t pc = 0;
  while (pc < policy->count) {
    const struct sock_filter instruction = policy->instructions[pc];
    size_t jump = 0;
    switch (instruction.code) {
      case BPF_LD | BPF_W | BPF_ABS:
        if (instruction.jt || instruction.jf || instruction.k % 4 ||
            instruction.k > sizeof(data) - sizeof(accumulator)) {
          errno = EPROTO; return -1;
        }
        memcpy(&accumulator, (const unsigned char *)&data + instruction.k,
               sizeof(accumulator));
        break;
      case BPF_ALU | BPF_AND | BPF_K:
        if (instruction.jt || instruction.jf) { errno = EPROTO; return -1; }
        accumulator &= instruction.k; break;
      case BPF_JMP | BPF_JEQ | BPF_K:
        jump = accumulator == instruction.k ? instruction.jt : instruction.jf;
        break;
      case BPF_JMP | BPF_JSET | BPF_K:
        jump = accumulator & instruction.k ? instruction.jt : instruction.jf;
        break;
      case BPF_JMP | BPF_JA:
        if (instruction.jt || instruction.jf) { errno = EPROTO; return -1; }
        jump = instruction.k; break;
      case BPF_RET | BPF_K:
        if (instruction.jt || instruction.jf) { errno = EPROTO; return -1; }
        *verdict = instruction.k; return 0;
      default:
        errno = EPROTO; return -1;
    }
    /* Every generated branch is forward. Bound before arithmetic and never
     * accept fall-through past the admitted program as an implicit ALLOW. */
    if (jump >= policy->count - pc - 1) { errno = EPROTO; return -1; }
    pc += jump + 1;
  }
  errno = EPROTO; return -1;
}

int lf_entry_gate_close(struct lf_entry_gate *gate, int pidfd,
    const struct lf_terminal_catalog *catalog,
    const struct lf_fd_binding *originals, size_t original_count) {
  if (!gate) { errno = EINVAL; return -1; }
  if (gate->failed) { errno = gate->last_observation.rejection_error; return -1; }
  if (gate->closed) return fail(gate, 0, EPROTO);
  /* Even invalid closure cannot be retried under a wider catalog. */
  gate->closed = true;
  if (pidfd < 0 || original_count > LF_POLICY_FDS ||
      (original_count && !originals) || !catalog)
    return fail(gate, 0, EINVAL);
  if (lf_terminal_policy_build(catalog, &gate->policy) < 0)
    return fail(gate, 0, errno);
  for (size_t i = 0; i < original_count; i++) {
    if (originals[i].workload_fd < 0 || originals[i].held_fd < 0 ||
        !originals[i].object_key) return fail(gate, 0, EINVAL);
    for (size_t j = 0; j < i; j++)
      if (originals[j].workload_fd == originals[i].workload_fd)
        return fail(gate, 0, EINVAL);
    for (size_t j = 0; j < catalog->fd_count; j++)
      if (catalog->fds[j].fd == originals[i].workload_fd)
        return fail(gate, 0, EINVAL);
  }
  gate->held_pidfd = pidfd;
  gate->nonoriginal_count = catalog->fd_count;
  memcpy(gate->nonoriginals, catalog->fds,
         catalog->fd_count * sizeof(gate->nonoriginals[0]));
  gate->original_count = original_count;
  if (original_count)
    memcpy(gate->originals, originals,
           original_count * sizeof(gate->originals[0]));
  return 0;
}

static int original_close(struct lf_entry_gate *gate, size_t index) {
  struct lf_gate_observation *observation = &gate->last_observation;
  const struct lf_fd_binding *binding = &gate->originals[index];
  observation->original_fd = binding->workload_fd;
  if (gate->original_close_entered[index]) return fail(gate, 0, EPROTO);
  int duplicate = (int)syscall(SYS_pidfd_getfd, gate->held_pidfd,
                              binding->workload_fd, 0);
  if (duplicate < 0) return fail(gate, errno, errno);
  int primary_native = 0, rejection = 0;
  if (fstat(duplicate, &observation->actual_original) < 0) {
    primary_native = rejection = errno;
  } else if (!S_ISREG(observation->actual_original.st_mode) &&
             !S_ISDIR(observation->actual_original.st_mode)) {
    rejection = EPROTO;
  } else {
    pid_t self = getpid();
    errno = 0;
    long actual = syscall(SYS_kcmp, self, self, KCMP_FILE,
                          (unsigned long)duplicate,
                          (unsigned long)binding->held_fd);
    observation->actual_comparison = actual;
    if (actual != 0) {
      primary_native = actual < 0 ? errno : 0;
      rejection = primary_native ? primary_native : ESTALE;
    }
  }
  if (close(duplicate) < 0) {
    observation->duplicate_close_error = errno;
    if (!rejection) primary_native = rejection = errno;
  }
  if (rejection) return fail(gate, primary_native, rejection);
  gate->original_close_entered[index] = true;
  return 1;
}

int lf_entry_gate_check(struct lf_entry_gate *gate,
                        const struct lf_trace_observation *actual) {
  if (!gate) { errno = EINVAL; return -1; }
  if (gate->failed) { errno = gate->last_observation.rejection_error; return -1; }
  memset(&gate->last_observation, 0, sizeof(gate->last_observation));
  gate->last_observation.original_fd = -1;
  gate->last_observation.actual_comparison = -1;
  if (!gate->closed || !actual || actual->stop != LF_TRACE_SYSCALL_ENTRY ||
      actual->native_error) return fail(gate, 0, EINVAL);
  gate->last_observation.tid = actual->tid;
  gate->last_observation.syscall_number = actual->syscall_number;
  uint32_t verdict = 0;
  if (lf_policy_entry_verdict(&gate->policy, actual, &verdict) < 0)
    return fail(gate, 0, errno);
  gate->last_observation.policy_verdict = verdict;
  if (actual->syscall_number == SYS_close) {
    if (actual->arguments[0] > INT_MAX) return fail(gate, 0, EPROTO);
    int fd = (int)actual->arguments[0];
    for (size_t i = 0; i < gate->original_count; i++)
      if (gate->originals[i].workload_fd == fd) return original_close(gate, i);
    for (size_t i = 0; i < gate->nonoriginal_count; i++)
      if (gate->nonoriginals[i].fd == fd) return 1;
    return fail(gate, 0, EPERM);
  }
  if (verdict != SECCOMP_RET_ALLOW) return fail(gate, 0, EPERM);
  return 1;
}
