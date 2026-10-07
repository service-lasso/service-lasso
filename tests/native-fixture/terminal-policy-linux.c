#define _GNU_SOURCE
#include "terminal-policy-linux.h"

#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <linux/audit.h>
#include <linux/futex.h>
#include <linux/seccomp.h>
#include <stdbool.h>
#include <string.h>
#include <sys/epoll.h>
#include <sys/mman.h>
#include <sys/socket.h>
#include <sys/syscall.h>
#include <unistd.h>

#if !defined(__x86_64__) || defined(__ILP32__)
#error "Reviewed terminal policy requires native Linux x86_64, never x32"
#endif

struct builder { struct lf_terminal_policy *out; int error; };
static const uint32_t deny = SECCOMP_RET_ERRNO | EPERM;

static size_t emit(struct builder *b, unsigned short code,
                   unsigned char jt, unsigned char jf, uint32_t k) {
  size_t slot = b->out->count;
  if (b->error) return 0;
  if (slot == LF_POLICY_INSNS) { b->error = E2BIG; return 0; }
  b->out->instructions[slot] = (struct sock_filter){code, jt, jf, k};
  b->out->count++;
  return slot;
}
static void load(struct builder *b, size_t offset) {
  emit(b, BPF_LD | BPF_W | BPF_ABS, 0, 0, (uint32_t)offset);
}
static void result(struct builder *b, uint32_t value) {
  emit(b, BPF_RET | BPF_K, 0, 0, value);
}
static void require_value(struct builder *b, uint32_t value) {
  emit(b, BPF_JMP | BPF_JEQ | BPF_K, 1, 0, value);
  result(b, deny);
}
static void arg_low(struct builder *b, unsigned int arg) {
  load(b, offsetof(struct seccomp_data, args) + arg * sizeof(uint64_t));
}
static void arg_high(struct builder *b, unsigned int arg) {
  load(b, offsetof(struct seccomp_data, args) + arg * sizeof(uint64_t) + 4);
}
static void arg_u32(struct builder *b, unsigned int arg) {
  arg_high(b, arg); require_value(b, 0); arg_low(b, arg);
}
static void arg_equal(struct builder *b, unsigned int arg, uint32_t value) {
  arg_u32(b, arg); require_value(b, value);
}
static void flags(struct builder *b, unsigned int arg,
                  uint32_t permitted, uint32_t required) {
  arg_u32(b, arg);
  emit(b, BPF_ALU | BPF_AND | BPF_K, 0, 0, ~permitted);
  require_value(b, 0);
  arg_low(b, arg);
  emit(b, BPF_ALU | BPF_AND | BPF_K, 0, 0, required);
  require_value(b, required);
}

/* Each nonmatching syscall jumps over a complete block via a 32-bit JA,
 * avoiding conditional-jump truncation when a large held catalog is emitted. */
static size_t rule(struct builder *b, uint32_t number) {
  load(b, offsetof(struct seccomp_data, nr));
  emit(b, BPF_JMP | BPF_JEQ | BPF_K, 1, 0, number);
  return emit(b, BPF_JMP | BPF_JA, 0, 0, 0);
}
static void finish(struct builder *b, size_t skip) {
  result(b, SECCOMP_RET_ALLOW);
  if (!b->error) b->out->instructions[skip].k =
      (uint32_t)(b->out->count - skip - 1);
}
static void pure(struct builder *b, uint32_t number) {
  size_t skip = rule(b, number); finish(b, skip);
}

static void one_of(struct builder *b, const uint32_t *values, size_t count) {
  size_t jumps[LF_POLICY_FDS];
  if (count > LF_POLICY_FDS) { b->error = E2BIG; return; }
  for (size_t i = 0; i < count; i++) {
    emit(b, BPF_JMP | BPF_JEQ | BPF_K, 0, 1, values[i]);
    jumps[i] = emit(b, BPF_JMP | BPF_JA, 0, 0, 0);
  }
  result(b, deny);
  if (!b->error) for (size_t i = 0; i < count; i++)
    b->out->instructions[jumps[i]].k =
        (uint32_t)(b->out->count - jumps[i] - 1);
}
static void held_fd(struct builder *b, const struct lf_terminal_catalog *c,
                    unsigned int arg, uint32_t right) {
  uint32_t values[LF_POLICY_FDS]; size_t count = 0;
  for (size_t i = 0; i < c->fd_count; i++)
    if (c->fds[i].rights & right) values[count++] = (uint32_t)c->fds[i].fd;
  arg_u32(b, arg); one_of(b, values, count);
}
static void io(struct builder *b, const struct lf_terminal_catalog *c,
               uint32_t number, uint32_t right) {
  size_t skip = rule(b, number); held_fd(b, c, 0, right); finish(b, skip);
}
static bool catalog_valid(const struct lf_terminal_catalog *c) {
  if (!c || c->tgid <= 0 || !c->tids || !c->tid_count ||
      c->tid_count > LF_POLICY_THREADS || !c->signals ||
      !c->signal_count || c->signal_count > LF_POLICY_SIGNALS ||
      !c->fds || !c->fd_count || c->fd_count > LF_POLICY_FDS) return false;
  bool main_seen = false; size_t control_count = 0;
  for (size_t i = 0; i < c->tid_count; i++) {
    if (c->tids[i] <= 0) return false;
    if (c->tids[i] == c->tgid) main_seen = true;
    for (size_t j = 0; j < i; j++) if (c->tids[j] == c->tids[i]) return false;
  }
  for (size_t i = 0; i < c->signal_count; i++) {
    if (c->signals[i] > 64) return false;
    for (size_t j = 0; j < i; j++)
      if (c->signals[j] == c->signals[i]) return false;
  }
  const uint32_t all = LF_FD_READ | LF_FD_WRITE | LF_FD_CONTROL |
      LF_FD_EPOLL | LF_FD_EPOLL_MEMBER | LF_FD_FLAGS;
  for (size_t i = 0; i < c->fd_count; i++) {
    uint32_t rights = c->fds[i].rights;
    if (c->fds[i].fd < 0 || !rights || (rights & ~all)) return false;
    /* Credential-bearing packets must never use ordinary read/write. */
    if (rights & LF_FD_CONTROL) {
      if (rights & (LF_FD_READ | LF_FD_WRITE | LF_FD_EPOLL)) return false;
      control_count++;
    }
    for (size_t j = 0; j < i; j++)
      if (c->fds[j].fd == c->fds[i].fd) return false;
  }
  return main_seen && control_count == 1;
}

int lf_terminal_policy_build(const struct lf_terminal_catalog *c,
                             struct lf_terminal_policy *out) {
  if (!out) { errno = EINVAL; return -1; }
  memset(out, 0, sizeof(*out));
  if (!catalog_valid(c)) { errno = EINVAL; return -1; }
  struct builder b = {out, 0}; size_t skip;
  load(&b, offsetof(struct seccomp_data, arch));
  emit(&b, BPF_JMP | BPF_JEQ | BPF_K, 1, 0, AUDIT_ARCH_X86_64);
  result(&b, SECCOMP_RET_KILL_PROCESS);
  load(&b, offsetof(struct seccomp_data, nr));
  emit(&b, BPF_JMP | BPF_JSET | BPF_K, 0, 1, 0x40000000u);
  result(&b, SECCOMP_RET_KILL_PROCESS);

  io(&b, c, SYS_read, LF_FD_READ); io(&b, c, SYS_readv, LF_FD_READ);
  io(&b, c, SYS_write, LF_FD_WRITE); io(&b, c, SYS_writev, LF_FD_WRITE);
  skip = rule(&b, SYS_recvmsg);
  held_fd(&b, c, 0, LF_FD_CONTROL);
  flags(&b, 2, MSG_DONTWAIT | MSG_CMSG_CLOEXEC, MSG_CMSG_CLOEXEC);
  finish(&b, skip);
  skip = rule(&b, SYS_sendmsg);
  held_fd(&b, c, 0, LF_FD_CONTROL); flags(&b, 2, MSG_DONTWAIT, 0);
  finish(&b, skip);

  /* All original slots were genuinely closed before seal; no FD acquisition
   * or rebinding is allowed anywhere below. Ordinary teardown stays real. */
  pure(&b, SYS_close);
  const uint32_t commands[] = {F_GETFD, F_GETFL, F_SETFD, F_SETFL};
  skip = rule(&b, SYS_fcntl); held_fd(&b, c, 0, LF_FD_FLAGS);
  arg_u32(&b, 1); one_of(&b, commands, 4);
  /* GET commands ignore arg2; SET operations get separate guarded blocks. */
  arg_low(&b, 1);
  emit(&b, BPF_JMP | BPF_JEQ | BPF_K, 0, 1, F_GETFD);
  result(&b, SECCOMP_RET_ALLOW);
  emit(&b, BPF_JMP | BPF_JEQ | BPF_K, 0, 1, F_GETFL);
  result(&b, SECCOMP_RET_ALLOW);
  emit(&b, BPF_JMP | BPF_JEQ | BPF_K, 0, 1, F_SETFD);
  size_t setfd = emit(&b, BPF_JMP | BPF_JA, 0, 0, 0);
  flags(&b, 2, O_NONBLOCK | O_ACCMODE, 0);
  result(&b, SECCOMP_RET_ALLOW);
  if (!b.error) out->instructions[setfd].k =
      (uint32_t)(out->count - setfd - 1);
  flags(&b, 2, FD_CLOEXEC, 0); finish(&b, skip);

  io(&b, c, SYS_epoll_wait, LF_FD_EPOLL);
  io(&b, c, SYS_epoll_pwait, LF_FD_EPOLL);
#ifdef SYS_epoll_pwait2
  io(&b, c, SYS_epoll_pwait2, LF_FD_EPOLL);
#endif
  const uint32_t epoll_ops[] = {EPOLL_CTL_ADD, EPOLL_CTL_MOD, EPOLL_CTL_DEL};
  skip = rule(&b, SYS_epoll_ctl); held_fd(&b, c, 0, LF_FD_EPOLL);
  arg_u32(&b, 1); one_of(&b, epoll_ops, 3);
  held_fd(&b, c, 2, LF_FD_EPOLL_MEMBER); finish(&b, skip);

  skip = rule(&b, SYS_mmap);
  flags(&b, 2, PROT_READ | PROT_WRITE | PROT_EXEC, 0);
  flags(&b, 3, MAP_PRIVATE | MAP_ANONYMOUS | MAP_FIXED |
      MAP_NORESERVE | MAP_STACK | MAP_FIXED_NOREPLACE,
      MAP_PRIVATE | MAP_ANONYMOUS);
  arg_low(&b, 4); require_value(&b, UINT32_MAX);
  /* Kernel fd is int: accept only its two canonical -1 extensions. */
  const uint32_t minus_one_high[] = {0, UINT32_MAX};
  arg_high(&b, 4); one_of(&b, minus_one_high, 2); finish(&b, skip);
  pure(&b, SYS_brk); pure(&b, SYS_munmap); pure(&b, SYS_mprotect);
  pure(&b, SYS_madvise); pure(&b, SYS_mremap);

  skip = rule(&b, SYS_futex);
  arg_u32(&b, 1);
  emit(&b, BPF_JMP | BPF_JSET | BPF_K, 1, 0, FUTEX_PRIVATE_FLAG);
  result(&b, deny);
  emit(&b, BPF_ALU | BPF_AND | BPF_K, 0, 0, ~(FUTEX_PRIVATE_FLAG | FUTEX_CLOCK_REALTIME));
  const uint32_t futex_ops[] = {FUTEX_WAIT, FUTEX_WAKE, FUTEX_REQUEUE,
      FUTEX_CMP_REQUEUE, FUTEX_WAKE_OP, FUTEX_WAIT_BITSET, FUTEX_WAKE_BITSET};
  one_of(&b, futex_ops, sizeof(futex_ops) / sizeof(futex_ops[0]));
  finish(&b, skip);
#ifdef SYS_rseq
  pure(&b, SYS_rseq);
#endif
  pure(&b, SYS_set_robust_list);
  pure(&b, SYS_clock_gettime); pure(&b, SYS_gettimeofday); pure(&b, SYS_time);
  pure(&b, SYS_getrusage); pure(&b, SYS_getpid); pure(&b, SYS_getppid);
  pure(&b, SYS_gettid); pure(&b, SYS_getuid); pure(&b, SYS_geteuid);
  pure(&b, SYS_getgid); pure(&b, SYS_getegid); pure(&b, SYS_uname);
  pure(&b, SYS_sched_getaffinity); pure(&b, SYS_sched_yield);
  pure(&b, SYS_rt_sigaction); pure(&b, SYS_rt_sigprocmask);
  pure(&b, SYS_rt_sigpending); pure(&b, SYS_rt_sigsuspend);
  pure(&b, SYS_rt_sigtimedwait); pure(&b, SYS_rt_sigreturn);
  pure(&b, SYS_sigaltstack);
  skip = rule(&b, SYS_tgkill); arg_equal(&b, 0, (uint32_t)c->tgid);
  uint32_t tids[LF_POLICY_THREADS];
  for (size_t i = 0; i < c->tid_count; i++) tids[i] = (uint32_t)c->tids[i];
  arg_u32(&b, 1); one_of(&b, tids, c->tid_count);
  arg_u32(&b, 2); one_of(&b, c->signals, c->signal_count); finish(&b, skip);
  pure(&b, SYS_nanosleep); pure(&b, SYS_clock_nanosleep);
  /* Only admitted all-history non-original restart targets can reach install.
   * BPF itself cannot recover the kernel restart-block history. */
  pure(&b, SYS_restart_syscall);
  pure(&b, SYS_exit); pure(&b, SYS_exit_group);
  result(&b, deny);
  if (b.error || !out->count || out->count > USHRT_MAX) {
    out->count = 0; errno = b.error ? b.error : E2BIG; return -1;
  }
  return 0;
}

long lf_terminal_policy_install(const struct lf_terminal_policy *policy) {
  if (!policy || !policy->count || policy->count > LF_POLICY_INSNS) {
    errno = EINVAL; return -1;
  }
  const struct sock_fprog program = {
    (unsigned short)policy->count,
    (struct sock_filter *)policy->instructions
  };
  return syscall(SYS_seccomp, SECCOMP_SET_MODE_FILTER,
                 SECCOMP_FILTER_FLAG_TSYNC, &program);
}
