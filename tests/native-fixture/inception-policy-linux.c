#define _GNU_SOURCE
#include "inception-policy-linux.h"

#include <errno.h>
#include <limits.h>
#include <linux/audit.h>
#include <linux/sched.h>
#include <linux/seccomp.h>
#include <stddef.h>
#include <string.h>
#include <sys/mman.h>
#include <sys/prctl.h>
#include <sys/socket.h>
#include <sys/syscall.h>
#include <unistd.h>

#if !defined(__x86_64__) || defined(__ILP32__)
#error This admitted inception source profile requires native x86_64
#endif

struct builder { struct lf_inception_policy *out; int error; };
static void emit(struct builder *b, unsigned short code, unsigned char yes,
                 unsigned char no, uint32_t k) {
  if (b->error) return;
  if (b->out->count == LF_INCEPTION_INSNS) { b->error = E2BIG; return; }
  b->out->instructions[b->out->count++] =
      (struct sock_filter){code, yes, no, k};
}
static void load(struct builder *b, size_t offset) {
  emit(b, BPF_LD | BPF_W | BPF_ABS, 0, 0, (uint32_t)offset);
}
static void result(struct builder *b, uint32_t verdict) {
  emit(b, BPF_RET | BPF_K, 0, 0, verdict);
}
static void require(struct builder *b, uint32_t value) {
  emit(b, BPF_JMP | BPF_JEQ | BPF_K, 1, 0, value);
  result(b, SECCOMP_RET_ERRNO | EPERM);
}
static void argument(struct builder *b, unsigned int index, uint32_t value) {
  load(b, offsetof(struct seccomp_data, args) + index * 8 + 4);
  require(b, 0);
  load(b, offsetof(struct seccomp_data, args) + index * 8);
  require(b, value);
}
static void mask(struct builder *b, unsigned int index,
                 uint32_t allowed, uint32_t required) {
  load(b, offsetof(struct seccomp_data, args) + index * 8 + 4);
  require(b, 0);
  load(b, offsetof(struct seccomp_data, args) + index * 8);
  emit(b, BPF_ALU | BPF_AND | BPF_K, 0, 0, ~allowed);
  require(b, 0);
  load(b, offsetof(struct seccomp_data, args) + index * 8);
  emit(b, BPF_ALU | BPF_AND | BPF_K, 0, 0, required);
  require(b, required);
}
static size_t rule(struct builder *b, uint32_t number) {
  load(b, offsetof(struct seccomp_data, nr));
  emit(b, BPF_JMP | BPF_JEQ | BPF_K, 1, 0, number);
  size_t branch = b->out->count;
  emit(b, BPF_JMP | BPF_JA, 0, 0, 0);
  return branch;
}
static void finish(struct builder *b, size_t branch) {
  result(b, SECCOMP_RET_ALLOW);
  if (!b->error)
    b->out->instructions[branch].k =
        (uint32_t)(b->out->count - branch - 1);
}
static void deny(struct builder *b, uint32_t number, int error) {
  load(b, offsetof(struct seccomp_data, nr));
  emit(b, BPF_JMP | BPF_JEQ | BPF_K, 0, 1, number);
  result(b, SECCOMP_RET_ERRNO | (uint32_t)error);
}
static void architecture(struct builder *b) {
  load(b, offsetof(struct seccomp_data, arch));
  emit(b, BPF_JMP | BPF_JEQ | BPF_K, 1, 0, AUDIT_ARCH_X86_64);
  result(b, SECCOMP_RET_KILL_PROCESS);
  load(b, offsetof(struct seccomp_data, nr));
  emit(b, BPF_JMP | BPF_JSET | BPF_K, 0, 1, 0x40000000u);
  result(b, SECCOMP_RET_KILL_PROCESS);
}
static int complete(struct builder *b) {
  result(b, SECCOMP_RET_ALLOW);
  if (b->error) {
    b->out->count = 0; errno = b->error; return -1;
  }
  return 0;
}

int lf_bootstrap_policy_build(pid_t tgid, uint64_t pthread_flags, int control_fd,
                              struct lf_inception_policy *out) {
  if (!out) { errno = EINVAL; return -1; }
  memset(out, 0, sizeof(*out));
  uint64_t required = CLONE_VM | CLONE_FS | CLONE_FILES | CLONE_SIGHAND |
      CLONE_THREAD | CLONE_SYSVSEM | CLONE_SETTLS;
  uint64_t allowed = required | CLONE_PARENT_SETTID | CLONE_CHILD_SETTID |
      CLONE_CHILD_CLEARTID;
  if (tgid <= 0 || control_fd < 0 || (pthread_flags & required) != required ||
      (pthread_flags & ~allowed) || pthread_flags > UINT32_MAX) {
    errno = EINVAL; return -1;
  }
  struct builder b = {out, 0}; architecture(&b);
  const uint32_t prohibited[] = {
    SYS_fork, SYS_vfork, SYS_execveat, SYS_setsid, SYS_setpgid,
    SYS_unshare, SYS_setns, SYS_mount, SYS_umount2, SYS_pivot_root, SYS_chroot,
    SYS_ptrace, SYS_process_vm_readv, SYS_process_vm_writev,
    SYS_pidfd_open, SYS_pidfd_getfd, SYS_pidfd_send_signal, SYS_kcmp,
    SYS_io_setup, SYS_io_destroy, SYS_io_submit, SYS_io_cancel, SYS_io_getevents,
    SYS_io_pgetevents, SYS_io_uring_setup, SYS_io_uring_enter, SYS_io_uring_register,
    SYS_userfaultfd, SYS_bpf, SYS_perf_event_open,
    SYS_shmget, SYS_shmat, SYS_shmdt, SYS_shmctl, SYS_remap_file_pages,
    SYS_semget, SYS_semop, SYS_semctl, SYS_semtimedop,
    SYS_msgget, SYS_msgsnd, SYS_msgrcv, SYS_msgctl,
    SYS_mq_open, SYS_mq_unlink, SYS_mq_timedsend, SYS_mq_timedreceive,
    SYS_mq_notify, SYS_mq_getsetattr,
    SYS_tkill, SYS_rt_sigqueueinfo,
    SYS_fanotify_init, SYS_fanotify_mark, SYS_inotify_init, SYS_inotify_init1,
    SYS_inotify_add_watch, SYS_inotify_rm_watch,
    SYS_ioctl, SYS_mknod, SYS_mknodat, SYS_link, SYS_linkat,
    SYS_setuid, SYS_setgid, SYS_setreuid, SYS_setregid, SYS_setresuid,
    SYS_setresgid, SYS_setfsuid, SYS_setfsgid, SYS_setgroups, SYS_capset,
    SYS_keyctl, SYS_add_key, SYS_request_key,
    SYS_poll, SYS_ppoll, SYS_select, SYS_pselect6,
    SYS_reboot, SYS_kexec_load, SYS_kexec_file_load, SYS_init_module,
    SYS_finit_module, SYS_delete_module, SYS_swapon, SYS_swapoff,
    SYS_open_by_handle_at, SYS_name_to_handle_at,
    SYS_open_tree, SYS_move_mount, SYS_fsopen, SYS_fsconfig, SYS_fsmount,
    SYS_fspick, SYS_mount_setattr, SYS_close_range,
    SYS_iopl, SYS_ioperm, SYS_acct, SYS_sethostname, SYS_setdomainname,
    SYS_personality, SYS_settimeofday, SYS_clock_settime, SYS_clock_adjtime,
    SYS_adjtimex, SYS_quotactl, SYS_lookup_dcookie
  };
  for (size_t i = 0; i < sizeof(prohibited) / sizeof(prohibited[0]); i++)
    deny(&b, prohibited[i], EPERM);
  deny(&b, SYS_clone3, ENOSYS);
  size_t branch = rule(&b, SYS_clone);
  argument(&b, 0, (uint32_t)pthread_flags); finish(&b, branch);
  branch = rule(&b, SYS_kill);
  argument(&b, 0, (uint32_t)tgid); finish(&b, branch);
  branch = rule(&b, SYS_tgkill);
  argument(&b, 0, (uint32_t)tgid); finish(&b, branch);
  branch = rule(&b, SYS_rt_tgsigqueueinfo);
  argument(&b, 0, (uint32_t)tgid); finish(&b, branch);
  branch = rule(&b, SYS_seccomp);
  argument(&b, 0, SECCOMP_SET_MODE_FILTER);
  mask(&b, 1, SECCOMP_FILTER_FLAG_TSYNC, 0); finish(&b, branch);
  branch = rule(&b, SYS_sendmsg);
  argument(&b, 0, (uint32_t)control_fd);
  mask(&b, 2, MSG_DONTWAIT | MSG_NOSIGNAL, 0); finish(&b, branch);
  branch = rule(&b, SYS_recvmsg);
  argument(&b, 0, (uint32_t)control_fd);
  mask(&b, 2, MSG_DONTWAIT | MSG_CMSG_CLOEXEC, MSG_CMSG_CLOEXEC);
  finish(&b, branch);
  deny(&b, SYS_sendmmsg, EPERM); deny(&b, SYS_recvmmsg, EPERM);
  branch = rule(&b, SYS_prctl);
  load(&b, offsetof(struct seccomp_data, args) + 4); require(&b, 0);
  load(&b, offsetof(struct seccomp_data, args));
  const uint32_t prctl_options[] = {PR_SET_NAME, PR_GET_NAME,
      PR_GET_NO_NEW_PRIVS, PR_GET_SECCOMP};
  for (size_t i = 0; i < sizeof(prctl_options) / sizeof(prctl_options[0]); i++) {
    emit(&b, BPF_JMP | BPF_JEQ | BPF_K, 0, 1, prctl_options[i]);
    result(&b, SECCOMP_RET_ALLOW);
  }
  result(&b, SECCOMP_RET_ERRNO | EPERM);
  if (!b.error) out->instructions[branch].k =
      (uint32_t)(out->count - branch - 1);
  return complete(&b);
}

int lf_mapping_policy_build(struct lf_inception_policy *out) {
  if (!out) { errno = EINVAL; return -1; }
  memset(out, 0, sizeof(*out));
  struct builder b = {out, 0}; architecture(&b);
  deny(&b, SYS_execve, EPERM); deny(&b, SYS_execveat, EPERM);
  size_t branch = rule(&b, SYS_mmap);
  mask(&b, 2, PROT_READ | PROT_WRITE | PROT_EXEC, 0);
  mask(&b, 3, MAP_PRIVATE | MAP_ANONYMOUS | MAP_FIXED | MAP_NORESERVE |
      MAP_STACK | MAP_FIXED_NOREPLACE, MAP_PRIVATE | MAP_ANONYMOUS);
  load(&b, offsetof(struct seccomp_data, args) + 4 * 8); require(&b, UINT32_MAX);
  load(&b, offsetof(struct seccomp_data, args) + 4 * 8 + 4);
  emit(&b, BPF_JMP | BPF_JEQ | BPF_K, 2, 0, 0);
  emit(&b, BPF_JMP | BPF_JEQ | BPF_K, 1, 0, UINT32_MAX);
  result(&b, SECCOMP_RET_ERRNO | EPERM);
  finish(&b, branch);
  return complete(&b);
}

long lf_inception_policy_install(const struct lf_inception_policy *policy,
                                uint32_t flags) {
  if (!policy || !policy->count || policy->count > LF_INCEPTION_INSNS ||
      policy->count > USHRT_MAX ||
      (flags != 0 && flags != SECCOMP_FILTER_FLAG_TSYNC)) {
    errno = EINVAL; return -1;
  }
  const struct sock_fprog program = {(unsigned short)policy->count,
      (struct sock_filter *)policy->instructions};
  return syscall(SYS_seccomp, SECCOMP_SET_MODE_FILTER, flags, &program);
}
