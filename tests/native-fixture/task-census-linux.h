#ifndef SERVICE_LASSO_TASK_CENSUS_LINUX_H
#define SERVICE_LASSO_TASK_CENSUS_LINUX_H

#include "terminal-policy-linux.h"
#include <stdbool.h>
#include <sys/vfs.h>
#include <sys/stat.h>

#define LF_TASK_TEXT_BYTES (LF_POLICY_THREADS * 12u)
#define LF_TASK_READS (LF_TASK_TEXT_BYTES + 1u)
#define LF_TASK_NAMES (LF_POLICY_THREADS + 3u)

struct lf_task_read {
  size_t offset;
  size_t requested;
  ssize_t actual;
  int native_error;
};
struct lf_task_text {
  int opened_fd;
  int close_error;
  struct stat metadata;
  struct statfs filesystem;
  unsigned char bytes[LF_TASK_TEXT_BYTES + 1u];
  size_t byte_count;
  struct lf_task_read reads[LF_TASK_READS];
  size_t read_count;
  bool actual_eof;
};
struct lf_task_name {
  char raw[256];
  size_t length;
  unsigned char native_type;
  unsigned long long native_inode;
  pid_t tid;
};
enum lf_task_census_stage {
  LF_TASK_INPUT, LF_TASK_LIFETIME_BEFORE, LF_TASK_PROCFS, LF_TASK_DIRECTORY,
  LF_TASK_ENUMERATION, LF_TASK_CGROUPFS, LF_TASK_THREADS, LF_TASK_PROCESSES,
  LF_TASK_LIFETIME_AFTER, LF_TASK_COMPLETE
};
struct lf_task_census {
  bool begun;
  bool failed;
  enum lf_task_census_stage stage;
  int native_error;
  int rejection_error;
  int task_directory_fd;
  int directory_close_error;
  struct statfs proc_filesystem;
  struct statfs task_filesystem;
  struct statfs cgroup_filesystem;
  struct lf_task_name names[LF_TASK_NAMES];
  size_t name_count;
  bool directory_eof;
  int lifetime_results[2];
  short lifetime_events[2];
  struct lf_task_text cgroup_threads;
  struct lf_task_text cgroup_processes;
};

/* Trusted S supplies creator-bound held pidfd/proc/dedicated cgroup objects in
 * the SAME admitted PID namespace as the actual traced TIDs. Root and every
 * original thread remain stopped; no birth/acquisition/exit is in flight and
 * nobody else can move tasks or change these mounts/groups. Numeric handles,
 * filesystem magic, names or matching sets do not establish creator authority.
 * Actual /proc task names and full cgroup.threads/cgroup.procs native text must
 * match the complete living inception ledger, including exactly one TGID.
 * Fixed component-relative reads never reopen a caller PID/path. Every read,
 * prefix/EOF, name, lifetime poll and close error is retained. No retries,
 * reaping, stopping, signalling, membership writes or inferred native exit.
 * Zero-initialize this private pre-reserved output once; never reuse it.
 * This corroborates task membership, not FD/effect/mapping/custody/reset proof.
 */
int lf_task_census_check(int held_pidfd, int held_proc_directory,
    int held_workload_cgroup, pid_t root_tid, const pid_t *actual_living_tids,
    size_t tid_count, struct lf_task_census *);

#endif
