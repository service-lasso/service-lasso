#define _GNU_SOURCE
#include "filter-inspection-linux.h"

#include <errno.h>
#include <linux/capability.h>
#include <linux/seccomp.h>
#include <string.h>
#include <sys/prctl.h>
#include <sys/ptrace.h>
#include <sys/syscall.h>
#include <unistd.h>

int lf_filter_inspector_privilege(void) {
  if (geteuid() != 0) { errno = EACCES; return -1; }
  int mode = prctl(PR_GET_SECCOMP, 0, 0, 0, 0);
  if (mode < 0) return -1;
  if (mode != SECCOMP_MODE_DISABLED) { errno = EACCES; return -1; }
  struct __user_cap_header_struct header;
  struct __user_cap_data_struct capabilities[2];
  memset(&header, 0, sizeof(header));
  memset(capabilities, 0, sizeof(capabilities));
  header.version = _LINUX_CAPABILITY_VERSION_3;
  if (syscall(SYS_capget, &header, capabilities) < 0) return -1;
  const unsigned int required[] = {CAP_SYS_ADMIN, CAP_SYS_PTRACE};
  for (size_t i = 0; i < sizeof(required) / sizeof(required[0]); i++) {
    unsigned int cap = required[i];
    if (!(capabilities[cap / 32].effective & (1u << (cap % 32)))) {
      errno = EACCES; return -1;
    }
  }
  return 0;
}

static int failed(struct lf_filter_inspection *observation,
                  long native_result, int native_error, int failure) {
  observation->native_result = native_result;
  observation->native_error = native_error;
  errno = failure; return -1;
}

int lf_filter_inspect_all(const pid_t *tids, size_t tid_count,
    const struct lf_filter_view *oldest_first, size_t filter_count,
    struct lf_filter_readback *records, size_t record_capacity,
    struct lf_filter_inspection *observation) {
  if (!observation) { errno = EINVAL; return -1; }
  memset(observation, 0, sizeof(*observation));
  observation->stage = LF_INSPECTION_INPUT;
  observation->native_result = -1;
  if (!tids || !tid_count || tid_count > LF_POLICY_THREADS ||
      !oldest_first || !filter_count || filter_count > LF_INSPECTION_FILTERS ||
      !records || tid_count > SIZE_MAX / filter_count ||
      record_capacity < tid_count * filter_count)
    return failed(observation, -1, 0, EINVAL);
  for (size_t i = 0; i < tid_count; i++) {
    if (tids[i] <= 0) return failed(observation, -1, 0, EINVAL);
    for (size_t j = 0; j < i; j++)
      if (tids[j] == tids[i]) return failed(observation, -1, 0, EINVAL);
  }
  for (size_t i = 0; i < filter_count; i++)
    if (!oldest_first[i].instructions || !oldest_first[i].count ||
        oldest_first[i].count > LF_POLICY_INSNS)
      return failed(observation, -1, 0, EINVAL);
  observation->stage = LF_INSPECTION_PRIVILEGE;
  if (lf_filter_inspector_privilege() < 0)
    return failed(observation, -1, errno, errno);

  for (size_t thread = 0; thread < tid_count; thread++) {
    observation->tid = tids[thread];
    for (size_t offset = 0; offset < filter_count; offset++) {
      observation->offset = offset;
      observation->stage = LF_INSPECTION_LENGTH;
      errno = 0;
      long length = ptrace(PTRACE_SECCOMP_GET_FILTER, tids[thread],
                            (void *)(uintptr_t)offset, NULL);
      if (length < 0) return failed(observation, length, errno, errno);
      if (!length || length > LF_POLICY_INSNS)
        return failed(observation, length, 0, EOVERFLOW);
      struct lf_filter_readback *record =
          &records[observation->readback_count];
      memset(record, 0, sizeof(*record));
      record->tid = tids[thread]; record->offset = offset;
      record->requested_count = (size_t)length;
      /* Retain even an attempted read's actual buffer/error. A failed read has
       * count0/unavailable bytes, never an omitted attempt or completed proof. */
      observation->readback_count++;
      observation->stage = LF_INSPECTION_BYTES;
      errno = 0;
      long actual = ptrace(PTRACE_SECCOMP_GET_FILTER, tids[thread],
                            (void *)(uintptr_t)offset, record->instructions);
      record->native_result = actual;
      if (actual < 0) return failed(observation, actual, errno, errno);
      if (actual != length || actual > LF_POLICY_INSNS)
        return failed(observation, actual, 0, EPROTO);
      record->count = (size_t)actual;
      observation->stage = LF_INSPECTION_COMPARE;
      if (record->count != oldest_first[offset].count ||
          memcmp(record->instructions, oldest_first[offset].instructions,
                  record->count * sizeof(struct sock_filter)) != 0)
        return failed(observation, actual, 0, EPROTO);
    }
    observation->offset = filter_count;
    observation->stage = LF_INSPECTION_NO_EXTRA;
    errno = 0;
    long extra = ptrace(PTRACE_SECCOMP_GET_FILTER, tids[thread],
                         (void *)(uintptr_t)filter_count, NULL);
    int actual_errno = errno;
    observation->native_result = extra;
    observation->native_error = actual_errno;
    if (extra != -1 || actual_errno != ENOENT)
      return failed(observation, extra, actual_errno,
                     actual_errno ? actual_errno : EPROTO);
  }
  observation->stage = LF_INSPECTION_COMPLETE;
  return 0;
}
