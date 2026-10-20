#ifndef SERVICE_LASSO_TERMINAL_POLICY_LINUX_H
#define SERVICE_LASSO_TERMINAL_POLICY_LINUX_H

#include <linux/filter.h>
#include <stddef.h>
#include <stdint.h>
#include <sys/types.h>

/* S derives this catalog from held objects and the complete parked census.
 * No caller JSON, PID or descriptor number can establish these predicates.
 * These ceilings bound policy construction, not positive recipe sufficiency. */
#define LF_POLICY_FDS 128u
#define LF_POLICY_THREADS 128u
#define LF_POLICY_SIGNALS 64u
#define LF_POLICY_INSNS 4096u

enum lf_fd_right {
  LF_FD_READ = 1u,
  LF_FD_WRITE = 2u,
  LF_FD_CONTROL = 4u,
  LF_FD_EPOLL = 8u,
  LF_FD_EPOLL_MEMBER = 16u,
  LF_FD_FLAGS = 32u
};

struct lf_policy_fd { int fd; uint32_t rights; };
struct lf_terminal_catalog {
  pid_t tgid;
  const pid_t *tids;
  size_t tid_count;
  const unsigned int *signals;
  size_t signal_count;
  const struct lf_policy_fd *fds;
  size_t fd_count;
};

struct lf_terminal_policy {
  struct sock_filter instructions[LF_POLICY_INSNS];
  size_t count;
};

/* Builds exact classic BPF without installing it. Failure leaves count zero.
 * The supervisor must independently match every installed thread/filter byte
 * and held object; successful build/install is never census or deletion proof. */
int lf_terminal_policy_build(const struct lf_terminal_catalog *,
                             struct lf_terminal_policy *);
/* Returns the actual seccomp result: 0, positive unsynchronized TID, or -1 with
 * errno. Only 0 plus independent per-thread inspection can advance SEALING. */
long lf_terminal_policy_install(const struct lf_terminal_policy *);

#endif
