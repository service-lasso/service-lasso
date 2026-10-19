#define _GNU_SOURCE
#include "fd-census-linux.h"

#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <linux/kcmp.h>
#include <stdbool.h>
#include <string.h>
#include <sys/syscall.h>
#include <unistd.h>

static int decimal_fd(const char *name, int *value) {
  if (!name || !*name || (name[0] == '0' && name[1])) return -1;
  unsigned int number = 0;
  for (const unsigned char *p = (const unsigned char *)name; *p; p++) {
    if (*p < '0' || *p > '9') return -1;
    unsigned int digit = *p - '0';
    if (number > ((unsigned int)INT_MAX - digit) / 10) return -1;
    number = number * 10 + digit;
  }
  *value = (int)number; return 0;
}

static int failure(struct lf_fd_census_observation *observation,
                    long native_result, int native_error, int error) {
  observation->native_result = native_result;
  observation->native_error = native_error;
  errno = error; return -1;
}

int lf_fd_census(int held_pidfd, int held_proc_directory,
    const struct lf_fd_binding *bindings, size_t binding_count,
    struct lf_fd_census_record *records, size_t record_capacity,
    struct lf_fd_census_observation *observation) {
  if (!observation) { errno = EINVAL; return -1; }
  memset(observation, 0, sizeof(*observation));
  observation->stage = LF_CENSUS_INPUT;
  observation->workload_fd = -1;
  if (held_pidfd < 0 || held_proc_directory < 0 || !bindings ||
      !binding_count || binding_count > LF_POLICY_FDS ||
      !records || record_capacity < binding_count)
    return failure(observation, -1, 0, EINVAL);
  for (size_t i = 0; i < binding_count; i++) {
    if (bindings[i].workload_fd < 0 || bindings[i].held_fd < 0 ||
        !bindings[i].object_key || !bindings[i].rights)
      return failure(observation, -1, 0, EINVAL);
    for (size_t j = 0; j < i; j++)
      if (bindings[j].workload_fd == bindings[i].workload_fd)
        return failure(observation, -1, 0, EINVAL);
  }
  bool seen[LF_POLICY_FDS] = {false};
  observation->stage = LF_CENSUS_ENUMERATION;
  int enumeration_fd = openat(held_proc_directory, "fd",
      O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
  if (enumeration_fd < 0) return failure(observation, -1, errno, errno);
  DIR *directory = fdopendir(enumeration_fd);
  if (!directory) {
    int error = errno;
    if (close(enumeration_fd) < 0) observation->cleanup_error = errno;
    return failure(observation, -1, error, error);
  }
  int failed_error = 0, failed_native_error = 0;
  long failed_result = -1;
  for (;;) {
    observation->stage = LF_CENSUS_ENUMERATION;
    errno = 0;
    struct dirent *entry = readdir(directory);
    if (!entry) {
      if (errno) { failed_error = failed_native_error = errno; break; }
      bool complete = true;
      for (size_t i = 0; i < binding_count; i++) if (!seen[i]) complete = false;
      if (!complete) { failed_error = EPROTO; break; }
      break;
    }
    if (!strcmp(entry->d_name, ".") || !strcmp(entry->d_name, "..")) continue;
    int workload_fd;
    if (decimal_fd(entry->d_name, &workload_fd) < 0) {
      failed_error = EPROTO; break;
    }
    observation->workload_fd = workload_fd;
    size_t binding = 0;
    while (binding < binding_count &&
           bindings[binding].workload_fd != workload_fd) binding++;
    if (binding == binding_count || seen[binding] ||
        observation->record_count == record_capacity) {
      failed_error = EPROTO; break;
    }
    seen[binding] = true;
    struct lf_fd_census_record *record =
        &records[observation->record_count++];
    memset(record, 0, sizeof(*record));
    record->workload_fd = workload_fd;
    record->object_key = bindings[binding].object_key;
    record->rights = bindings[binding].rights;
    record->native_comparison = -1;
    observation->stage = LF_CENSUS_DUPLICATE;
    int duplicate = (int)syscall(SYS_pidfd_getfd, held_pidfd, workload_fd, 0);
    if (duplicate < 0) { failed_error = failed_native_error = errno; break; }
    observation->stage = LF_CENSUS_METADATA;
    if (fstat(duplicate, &record->actual_metadata) < 0) {
      failed_error = failed_native_error = errno;
    } else {
      observation->stage = LF_CENSUS_COMPARE;
      pid_t self = getpid();
      errno = 0;
      long actual = syscall(SYS_kcmp, self, self, KCMP_FILE,
                            (unsigned long)duplicate,
                            (unsigned long)bindings[binding].held_fd);
      record->native_comparison = actual;
      if (actual != 0) {
        failed_result = actual;
        failed_native_error = actual < 0 ? errno : 0;
        failed_error = failed_native_error ? failed_native_error : EPROTO;
      }
    }
    /* No retry: close may already release a slot even when it reports error. */
    if (close(duplicate) < 0) {
      record->duplicate_close_error = errno;
      if (!failed_error) {
        observation->stage = LF_CENSUS_CLOSE;
        failed_error = failed_native_error = errno;
      }
    }
    if (failed_error) break;
  }
  if (closedir(directory) < 0) {
    observation->cleanup_error = errno;
    if (!failed_error) {
      observation->stage = LF_CENSUS_CLOSE;
      failed_error = failed_native_error = errno;
    }
  }
  if (failed_error)
    return failure(observation, failed_result, failed_native_error, failed_error);
  observation->stage = LF_CENSUS_COMPLETE;
  observation->native_result = 0;
  return 0;
}
