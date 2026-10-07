#include "close-return-linux.h"

#include <errno.h>
#include <limits.h>
#include <sys/syscall.h>

#if !defined(__linux__) || !defined(__x86_64__)
#error "The admitted close-return ABI is Linux x86_64"
#endif

static int failed(struct lf_close_return *out, int error) {
  out->failed = true; out->rejection_error = error;
  errno = error; return -1;
}
static bool disjoint(const void *a, size_t a_size, const void *b, size_t b_size) {
  uintptr_t first = (uintptr_t)a, second = (uintptr_t)b;
  if (!a || !b || a_size > UINTPTR_MAX - first || b_size > UINTPTR_MAX - second)
    return false;
  return first + a_size <= second || second + b_size <= first;
}
int lf_close_return_check(const struct lf_thread_history *history,
                           struct lf_close_return *out) {
  if (!history || !out) { errno = EINVAL; return -1; }
  if (out->failed) { errno = out->rejection_error; return -1; }
  if (out->begun) { errno = EALREADY; return -1; }
  if (!history->records || history->record_capacity > SIZE_MAX / sizeof(*history->records) ||
      !disjoint(history, sizeof(*history), out, sizeof(*out)) ||
      !disjoint(history->records, history->record_capacity * sizeof(*history->records),
                out, sizeof(*out))) { errno = EINVAL; return -1; }
  out->begun = true;
  if (!history->initialized || history->failed || !history->entry_gate.closed ||
      history->entry_gate.failed || history->record_count > history->record_capacity ||
      history->entry_gate.original_count > LF_POLICY_FDS)
    return failed(out, EPROTO);
  for (size_t binding = 0; binding < history->entry_gate.original_count; binding++) {
    const struct lf_fd_binding *original = &history->entry_gate.originals[binding];
    struct lf_close_return_record *record = &out->records[out->record_count++];
    record->object_key = original->object_key;
    record->workload_fd = original->workload_fd;
    if (!history->entry_gate.original_close_entered[binding]) return failed(out, EPROTO);
    for (size_t i = 0; i < history->record_count; i++) {
      const struct lf_thread_history_record *observed = &history->records[i];
      const struct lf_trace_observation *actual = &observed->actual;
      if (actual->stop != LF_TRACE_SYSCALL_ENTRY || actual->syscall_number != SYS_close ||
          actual->arguments[0] > INT_MAX || (int)actual->arguments[0] != original->workload_fd ||
          !observed->gate_checked || observed->gate_closed_during_memory_wait ||
          observed->sealing_exception || observed->gate_observation.original_fd != original->workload_fd)
        continue;
      if (record->entry_ordinal || observed->causal_entry_ordinal != i + 1 ||
          observed->gate_observation.actual_comparison != 0 ||
          observed->gate_observation.native_error || observed->gate_observation.rejection_error ||
          observed->gate_observation.duplicate_close_error || actual->native_error)
        return failed(out, EPROTO);
      record->entry_ordinal = i + 1;
      record->closing_tid = actual->tid;
    }
    if (!record->entry_ordinal) return failed(out, EPROTO);
    for (size_t i = (size_t)record->entry_ordinal; i < history->record_count; i++) {
      const struct lf_thread_history_record *observed = &history->records[i];
      const struct lf_trace_observation *actual = &observed->actual;
      if (actual->tid != record->closing_tid) continue;
      if (actual->stop == LF_TRACE_SYSCALL_EXIT &&
          observed->causal_entry_ordinal == record->entry_ordinal) {
        if (record->exit_ordinal) return failed(out, EPROTO);
        record->actual_exit = *actual;
        record->exit_ordinal = i + 1;
        if (actual->native_error || actual->syscall_is_error || actual->syscall_result != 0)
          return failed(out, EPROTO);
      } else if (actual->stop == LF_TRACE_SYSCALL_ENTRY) {
        if (!record->exit_ordinal || observed->causal_entry_ordinal != i + 1 || actual->native_error)
          return failed(out, EPROTO);
        record->next_entry_ordinal = i + 1;
        break;
      } else if (actual->stop == LF_TRACE_EXIT_EVENT || actual->stop == LF_TRACE_NATIVE_EXIT)
        return failed(out, EPROTO);
    }
    if (!record->exit_ordinal || !record->next_entry_ordinal) return failed(out, EPROTO);
  }
  out->complete = true;
  return 0;
}
