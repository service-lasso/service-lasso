#define _GNU_SOURCE
#include "task-census-linux.h"

#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <linux/magic.h>
#include <poll.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

#if !defined(__linux__) || !defined(__x86_64__)
#error "The admitted task census ABI is Linux x86_64"
#endif

static int failed(struct lf_task_census *out, int native_error, int error) {
  out->failed = true; out->native_error = native_error;
  out->rejection_error = error; errno = error; return -1;
}
static int decimal(const unsigned char *bytes, size_t size, pid_t *tid) {
  if (!size || bytes[0] == '0') return -1;
  unsigned int value = 0;
  for (size_t i = 0; i < size; i++) {
    if (bytes[i] < '0' || bytes[i] > '9') return -1;
    unsigned int digit = bytes[i] - '0';
    if (value > ((unsigned int)INT_MAX - digit) / 10) return -1;
    value = value * 10 + digit;
  }
  *tid = (pid_t)value; return 0;
}
static int match(pid_t tid, const pid_t *expected, size_t count, bool *seen) {
  for (size_t i = 0; i < count; i++) {
    if (tid != expected[i]) continue;
    if (seen[i]) return -1;
    seen[i] = true; return 0;
  }
  return -1;
}
static int lifetime(int pidfd, struct lf_task_census *out, size_t index) {
  struct pollfd item = {.fd = pidfd, .events = POLLIN};
  errno = 0;
  int actual = poll(&item, 1, 0);
  int actual_errno = actual < 0 ? errno : 0;
  out->lifetime_results[index] = actual;
  out->lifetime_events[index] = item.revents;
  if (actual < 0) return failed(out, actual_errno, actual_errno);
  if (actual || item.revents) return failed(out, 0, ESRCH);
  return 0;
}
static int text(int directory, const char *component,
    const pid_t *expected, size_t count, struct lf_task_text *capture,
    struct lf_task_census *out) {
  int fd = openat(directory, component, O_RDONLY | O_CLOEXEC | O_NOFOLLOW | O_NONBLOCK);
  capture->opened_fd = fd;
  if (fd < 0) return failed(out, errno, errno);
  int native_error = 0, rejection = 0;
  if (fstat(fd, &capture->metadata) < 0 || fstatfs(fd, &capture->filesystem) < 0) {
    native_error = rejection = errno;
  } else if (!S_ISREG(capture->metadata.st_mode) ||
             capture->filesystem.f_type != CGROUP2_SUPER_MAGIC) {
    rejection = EPROTO;
  }
  while (!rejection) {
    if (capture->read_count == LF_TASK_READS) { rejection = ENOSPC; break; }
    struct lf_task_read *record = &capture->reads[capture->read_count++];
    record->offset = capture->byte_count;
    record->requested = sizeof(capture->bytes) - capture->byte_count;
    errno = 0;
    record->actual = read(fd, capture->bytes + record->offset, record->requested);
    record->native_error = record->actual < 0 ? errno : 0;
    if (record->actual < 0) { native_error = rejection = record->native_error; break; }
    if (!record->actual) { capture->actual_eof = true; break; }
    capture->byte_count += (size_t)record->actual;
    if (capture->byte_count > LF_TASK_TEXT_BYTES) { rejection = EOVERFLOW; break; }
  }
  if (close(fd) < 0) {
    capture->close_error = errno;
    if (!rejection) native_error = rejection = errno;
  }
  if (rejection) return failed(out, native_error, rejection);
  bool seen[LF_POLICY_THREADS] = {false};
  size_t position = 0, found = 0;
  while (position < capture->byte_count) {
    size_t start = position;
    while (position < capture->byte_count && capture->bytes[position] != '\n') position++;
    pid_t tid;
    if (position == capture->byte_count ||
        decimal(capture->bytes + start, position - start, &tid) < 0 ||
        match(tid, expected, count, seen) < 0)
      return failed(out, 0, EPROTO);
    position++; found++;
  }
  if (!capture->actual_eof || found != count) return failed(out, 0, EPROTO);
  return 0;
}

int lf_task_census_check(int pidfd, int proc, int cgroup, pid_t root_tid,
    const pid_t *tids, size_t count, struct lf_task_census *out) {
  if (!out) { errno = EINVAL; return -1; }
  if (out->failed) { errno = out->rejection_error; return -1; }
  if (out->begun) { errno = EALREADY; return -1; }
  /* Preserve the caller's actual immutable ledger even on a storage mistake.
   * The owning sealing transaction makes this rejection absorbing. */
  if (tids && count && count <= LF_POLICY_THREADS) {
    uintptr_t output = (uintptr_t)out, input = (uintptr_t)tids;
    size_t size = count * sizeof(*tids);
    if (sizeof(*out) > UINTPTR_MAX - output || size > UINTPTR_MAX - input ||
        !(output + sizeof(*out) <= input || input + size <= output)) {
      errno = EINVAL; return -1;
    }
  }
  out->begun = true;
  out->task_directory_fd = -1;
  out->cgroup_threads.opened_fd = out->cgroup_processes.opened_fd = -1;
  if (pidfd < 0 || proc < 0 || cgroup < 0 || root_tid <= 0 || !tids ||
      !count || count > LF_POLICY_THREADS) return failed(out, 0, EINVAL);
  size_t roots = 0;
  for (size_t i = 0; i < count; i++) {
    if (tids[i] <= 0) return failed(out, 0, EINVAL);
    if (tids[i] == root_tid) roots++;
    for (size_t j = 0; j < i; j++)
      if (tids[j] == tids[i]) return failed(out, 0, EINVAL);
  }
  if (roots != 1) return failed(out, 0, EINVAL);
  out->stage = LF_TASK_LIFETIME_BEFORE;
  if (lifetime(pidfd, out, 0) < 0) return -1;
  out->stage = LF_TASK_PROCFS;
  if (fstatfs(proc, &out->proc_filesystem) < 0) return failed(out, errno, errno);
  if (out->proc_filesystem.f_type != PROC_SUPER_MAGIC) return failed(out, 0, EPROTO);
  out->stage = LF_TASK_DIRECTORY;
  int fd = openat(proc, "task", O_RDONLY | O_DIRECTORY | O_CLOEXEC | O_NOFOLLOW);
  out->task_directory_fd = fd;
  if (fd < 0) return failed(out, errno, errno);
  int native_error = 0, rejection = 0;
  if (fstatfs(fd, &out->task_filesystem) < 0) native_error = rejection = errno;
  else if (out->task_filesystem.f_type != PROC_SUPER_MAGIC) rejection = EPROTO;
  DIR *directory = NULL;
  if (!rejection) {
    directory = fdopendir(fd);
    if (!directory) native_error = rejection = errno;
  }
  bool seen[LF_POLICY_THREADS] = {false};
  size_t found = 0;
  out->stage = LF_TASK_ENUMERATION;
  while (!rejection) {
    if (out->name_count == LF_TASK_NAMES) { rejection = ENOSPC; break; }
    errno = 0;
    struct dirent *entry = readdir(directory);
    if (!entry) {
      if (errno) native_error = rejection = errno;
      else out->directory_eof = true;
      break;
    }
    struct lf_task_name *record = &out->names[out->name_count++];
    record->length = strnlen(entry->d_name, sizeof(record->raw));
    record->native_type = entry->d_type;
    record->native_inode = entry->d_ino;
    if (record->length == sizeof(record->raw)) { rejection = EOVERFLOW; break; }
    memcpy(record->raw, entry->d_name, record->length + 1);
    if (!strcmp(record->raw, ".") || !strcmp(record->raw, "..")) continue;
    if (decimal((const unsigned char *)record->raw, record->length, &record->tid) < 0 ||
        match(record->tid, tids, count, seen) < 0) { rejection = EPROTO; break; }
    found++;
  }
  int closed = directory ? closedir(directory) : close(fd);
  if (closed < 0) {
    out->directory_close_error = errno;
    if (!rejection) native_error = rejection = errno;
  }
  if (rejection) return failed(out, native_error, rejection);
  if (!out->directory_eof || found != count) return failed(out, 0, EPROTO);
  out->stage = LF_TASK_CGROUPFS;
  if (fstatfs(cgroup, &out->cgroup_filesystem) < 0) return failed(out, errno, errno);
  if (out->cgroup_filesystem.f_type != CGROUP2_SUPER_MAGIC) return failed(out, 0, EPROTO);
  out->stage = LF_TASK_THREADS;
  if (text(cgroup, "cgroup.threads", tids, count, &out->cgroup_threads, out) < 0) return -1;
  out->stage = LF_TASK_PROCESSES;
  if (text(cgroup, "cgroup.procs", &root_tid, 1, &out->cgroup_processes, out) < 0) return -1;
  out->stage = LF_TASK_LIFETIME_AFTER;
  if (lifetime(pidfd, out, 1) < 0) return -1;
  out->stage = LF_TASK_COMPLETE;
  return 0;
}
