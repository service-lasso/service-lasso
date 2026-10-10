#define _GNU_SOURCE
#include "sealing-linux.h"

#include <errno.h>
#include <linux/seccomp.h>
#include <string.h>
#include <sys/syscall.h>
#include <sys/uio.h>
#include <unistd.h>

#if !defined(__linux__) || !defined(__x86_64__)
#error "The admitted sealing ABI is Linux x86_64"
#endif

static int failed(struct lf_sealing *seal, struct lf_thread_history *history,
                  int native_error, int error) {
  seal->failed = true;
  seal->native_error = native_error;
  seal->rejection_error = error;
  history->failed = true;
  history->native_error = native_error;
  history->rejection_error = error;
  errno = error; return -1;
}
static struct lf_thread_history_entry *root(struct lf_thread_history *history) {
  for (size_t i = 0; i < history->thread_count; i++)
    if (history->threads[i].tid == history->root_tid) return &history->threads[i];
  return NULL;
}
static int read_memory(struct lf_sealing *seal, pid_t tid,
    uintptr_t address, void *buffer, size_t length) {
  struct lf_seal_memory_read *record = &seal->reads[seal->read_count++];
  record->address = address; record->requested = length;
  record->actual = -1;
  if (!address || length > UINTPTR_MAX - address) { errno = EOVERFLOW; return -1; }
  struct iovec local = {.iov_base = buffer, .iov_len = length};
  struct iovec remote = {.iov_base = (void *)address, .iov_len = length};
  errno = 0;
  record->actual = process_vm_readv(tid, &local, 1, &remote, 1, 0);
  record->native_error = record->actual < 0 ? errno : 0;
  if (record->actual < 0) return -1;
  if ((size_t)record->actual != length) { errno = EIO; return -1; }
  return 0;
}
static bool disjoint(const void *a, size_t a_size, const void *b, size_t b_size) {
  uintptr_t first = (uintptr_t)a, second = (uintptr_t)b;
  if (!a || !b || a_size > UINTPTR_MAX - first || b_size > UINTPTR_MAX - second)
    return false;
  return first + a_size <= second || second + b_size <= first;
}
static int inputs(const struct lf_sealing_inputs *in,
                   const struct lf_thread_history *history) {
  if (!in || in->held_proc_directory < 0 || in->held_workload_cgroup < 0 || !in->nonoriginals ||
      !in->nonoriginal_count || in->nonoriginal_count > LF_POLICY_FDS ||
      in->nonoriginal_count != history->entry_gate.nonoriginal_count ||
      in->fd_record_capacity < in->nonoriginal_count ||
      in->fd_record_capacity > LF_POLICY_FDS ||
      in->filter_record_capacity < history->thread_count * 3 ||
      in->filter_record_capacity > LF_POLICY_THREADS * 3)
    return -1;
  for (size_t i = 0; i < 2; i++)
    if (!in->early[i].instructions || !in->early[i].count ||
        in->early[i].count > LF_POLICY_INSNS) return -1;
  const void *buffers[] = {in->before_fd_records, in->after_fd_records,
                          in->before_filter_records, in->after_filter_records};
  size_t lengths[] = {in->fd_record_capacity * sizeof(*in->before_fd_records),
                      in->fd_record_capacity * sizeof(*in->after_fd_records),
                      in->filter_record_capacity * sizeof(*in->before_filter_records),
                      in->filter_record_capacity * sizeof(*in->after_filter_records)};
  for (size_t i = 0; i < 4; i++) {
    if (!buffers[i]) return -1;
    for (size_t j = 0; j < i; j++)
      if (!disjoint(buffers[i], lengths[i], buffers[j], lengths[j])) return -1;
  }
  for (size_t i = 0; i < in->nonoriginal_count; i++) {
    size_t matches = 0;
    for (size_t j = 0; j < history->entry_gate.nonoriginal_count; j++)
      if (in->nonoriginals[i].workload_fd == history->entry_gate.nonoriginals[j].fd &&
          in->nonoriginals[i].rights == history->entry_gate.nonoriginals[j].rights)
        matches++;
    if (matches != 1) return -1;
    for (size_t j = 0; j < i; j++)
      if (in->nonoriginals[j].workload_fd == in->nonoriginals[i].workload_fd)
        return -1;
  }
  return 0;
}

static bool capture_buffers_disjoint(const struct lf_sealing_inputs *in,
    const struct lf_sealing *seal, const struct lf_thread_history *history) {
  if (!history->records ||
      history->record_capacity > SIZE_MAX / sizeof(*history->records)) return false;
  const void *outputs[] = {in->before_fd_records, in->after_fd_records,
                          in->before_filter_records, in->after_filter_records};
  size_t output_sizes[] = {
    in->fd_record_capacity * sizeof(*in->before_fd_records),
    in->fd_record_capacity * sizeof(*in->after_fd_records),
    in->filter_record_capacity * sizeof(*in->before_filter_records),
    in->filter_record_capacity * sizeof(*in->after_filter_records)};
  const void *sources[] = {seal, history, history->records, in, in->nonoriginals,
                          in->early[0].instructions, in->early[1].instructions};
  size_t source_sizes[] = {sizeof(*seal), sizeof(*history),
    history->record_capacity * sizeof(*history->records), sizeof(*in),
    in->nonoriginal_count * sizeof(*in->nonoriginals),
    in->early[0].count * sizeof(struct sock_filter),
    in->early[1].count * sizeof(struct sock_filter)};
  if (!disjoint(seal, sizeof(*seal), history, sizeof(*history)) ||
      !disjoint(seal, sizeof(*seal), history->records, source_sizes[2]) ||
      !disjoint(seal, sizeof(*seal), in, sizeof(*in)) ||
      !disjoint(seal, sizeof(*seal), in->nonoriginals, source_sizes[4]) ||
      !disjoint(seal, sizeof(*seal), sources[5], source_sizes[5]) ||
      !disjoint(seal, sizeof(*seal), sources[6], source_sizes[6])) return false;
  for (size_t i = 0; i < 4; i++)
    for (size_t j = 0; j < 7; j++)
      if (!disjoint(outputs[i], output_sizes[i], sources[j], source_sizes[j]))
        return false;
  return true;
}

int lf_sealing_begin(struct lf_sealing *seal, struct lf_thread_history *history,
                      const struct lf_sealing_inputs *in) {
  if (!seal || !history) { errno = EINVAL; return -1; }
  if (seal->failed) { errno = seal->rejection_error; return -1; }
  if (history->failed) { errno = history->rejection_error; return -1; }
  if (seal->begun || !history->initialized || !history->entry_gate.closed ||
      history->entry_gate.failed || history->sealing_hold || inputs(in, history) < 0 ||
      !capture_buffers_disjoint(in, seal, history))
    return failed(seal, history, 0, EPROTO);
  seal->begun = true;
  history->sealing_hold = true;
  seal->held_inputs = *in;
  memcpy(seal->held_nonoriginals, in->nonoriginals,
         in->nonoriginal_count * sizeof(*in->nonoriginals));
  seal->held_inputs.nonoriginals = seal->held_nonoriginals;
  struct lf_thread_history_entry *barrier = root(history);
  if (!barrier || barrier->actually_exited || !barrier->currently_stopped ||
      !barrier->syscall_pending || barrier->last_observation.stop != LF_TRACE_SYSCALL_ENTRY ||
      barrier->syscall_number != SYS_seccomp ||
      barrier->arguments[0] != SECCOMP_SET_MODE_FILTER ||
      barrier->arguments[1] != SECCOMP_FILTER_FLAG_TSYNC || !barrier->arguments[2] ||
      !barrier->entry_ordinal || barrier->entry_ordinal > history->record_count)
    return failed(seal, history, 0, EPROTO);
  for (size_t i = 0; i < history->thread_count; i++) {
    const struct lf_thread_history_entry *thread = &history->threads[i];
    if (thread->actually_exited) continue;
    if (!thread->currently_stopped || thread->exit_announced ||
        thread->awaiting_birth_stop || thread->has_restart_result ||
        thread->inherited_clone_return_pending)
      return failed(seal, history, 0, EPROTO);
    if (thread->tid != history->root_tid) {
      if (!thread->syscall_pending || !thread->entry_ordinal ||
          thread->entry_ordinal > history->record_count)
        return failed(seal, history, 0, EPROTO);
      const struct lf_trace_observation *entry =
          &history->records[thread->entry_ordinal - 1].actual;
      if (entry->tid != thread->tid || entry->stop != LF_TRACE_SYSCALL_ENTRY)
        return failed(seal, history, 0, EPROTO);
      if (thread->last_observation.stop == LF_TRACE_SYSCALL_ENTRY) {
        uint32_t verdict;
        if (lf_policy_entry_verdict(&history->entry_gate.policy, entry, &verdict) < 0)
          return failed(seal, history, 0, errno);
        if (verdict != SECCOMP_RET_ALLOW) return failed(seal, history, 0, EPERM);
      } else {
        if (thread->last_observation.stop != LF_TRACE_INTERRUPT_OR_GROUP ||
            thread->last_observation.stop_signal != SIGTRAP ||
            !history->records[thread->entry_ordinal - 1].gate_checked)
          return failed(seal, history, 0, EPROTO);
        struct lf_gate_observation *wait = &seal->wait_observations[seal->tid_count];
        if (lf_parked_wait_check(entry, &history->entry_gate.policy,
            history->entry_gate.held_pidfd, in->nonoriginals,
            in->nonoriginal_count, wait) < 0)
          return failed(seal, history, wait->native_error, wait->rejection_error);
      }
    }
    seal->tids[seal->tid_count++] = thread->tid;
  }
  for (size_t i = 0; i < history->record_count; i++)
    if (history->records[i].awaiting_creator_event)
      return failed(seal, history, 0, EPROTO);
  if (lf_close_return_check(history, &seal->original_close_returns) < 0)
    return failed(seal, history, 0, errno);
  if (lf_task_census_check(history->entry_gate.held_pidfd, in->held_proc_directory,
      in->held_workload_cgroup, history->root_tid, seal->tids, seal->tid_count,
      &seal->before_tasks) < 0)
    return failed(seal, history, seal->before_tasks.native_error, errno);
  for (size_t i = 0; i < 2; i++) {
    seal->early[i].count = in->early[i].count;
    memcpy(seal->early[i].instructions, in->early[i].instructions,
           in->early[i].count * sizeof(struct sock_filter));
  }
  struct lf_filter_view early[2] = {
    {seal->early[0].instructions, seal->early[0].count},
    {seal->early[1].instructions, seal->early[1].count}
  };
  if (lf_filter_inspect_all(seal->tids, seal->tid_count, early, 2,
      in->before_filter_records, in->filter_record_capacity, &seal->before_filters) < 0)
    return failed(seal, history, seal->before_filters.native_error, errno);
  if (lf_fd_census(history->entry_gate.held_pidfd, in->held_proc_directory,
      in->nonoriginals, in->nonoriginal_count, in->before_fd_records,
      in->fd_record_capacity, &seal->before_fds) < 0)
    return failed(seal, history, seal->before_fds.native_error, errno);
  if (read_memory(seal, history->root_tid, (uintptr_t)barrier->arguments[2],
                   &seal->actual_program, sizeof(seal->actual_program)) < 0)
    return failed(seal, history, seal->reads[seal->read_count - 1].native_error, errno);
  if (seal->actual_program.len != history->entry_gate.policy.count ||
      !seal->actual_program.filter)
    return failed(seal, history, 0, EPROTO);
  size_t length = seal->actual_program.len * sizeof(struct sock_filter);
  if (read_memory(seal, history->root_tid, (uintptr_t)seal->actual_program.filter,
                   seal->actual_instructions, length) < 0)
    return failed(seal, history, seal->reads[seal->read_count - 1].native_error, errno);
  if (memcmp(seal->actual_instructions, history->entry_gate.policy.instructions, length))
    return failed(seal, history, 0, EPROTO);
  struct lf_thread_history_record *record = &history->records[barrier->entry_ordinal - 1];
  if (record->gate_checked || record->actual.tid != history->root_tid ||
      record->actual.stop != LF_TRACE_SYSCALL_ENTRY)
    return failed(seal, history, 0, EPROTO);
  uint32_t verdict;
  if (lf_policy_entry_verdict(&history->entry_gate.policy, &record->actual, &verdict) < 0)
    return failed(seal, history, 0, errno);
  record->gate_checked = true;
  record->sealing_exception = true;
  record->gate_observation.tid = history->root_tid;
  record->gate_observation.syscall_number = SYS_seccomp;
  record->gate_observation.policy_verdict = verdict;
  seal->entry_ordinal = barrier->entry_ordinal;
  seal->start_record_count = history->record_count;
  if (lf_trace_resume(&barrier->last_observation, 0) < 0)
    return failed(seal, history, errno, errno);
  barrier->currently_stopped = false;
  return 0;
}

int lf_sealing_finish(struct lf_sealing *seal, struct lf_thread_history *history) {
  if (!seal || !history) { errno = EINVAL; return -1; }
  if (seal->failed) { errno = seal->rejection_error; return -1; }
  if (history->failed) { errno = history->rejection_error; return -1; }
  const struct lf_sealing_inputs *in = &seal->held_inputs;
  if (!seal->begun || seal->verified || !history->sealing_hold || inputs(in, history) < 0)
    return failed(seal, history, 0, EPROTO);
  if (history->record_count == seal->start_record_count) return 0;
  if (history->record_count != seal->start_record_count + 1)
    return failed(seal, history, 0, EPROTO);
  struct lf_thread_history_entry *barrier = root(history);
  const struct lf_trace_observation *actual =
      &history->records[seal->start_record_count].actual;
  seal->actual_install_exit = *actual;
  if (!barrier || actual->tid != history->root_tid ||
      actual->stop != LF_TRACE_SYSCALL_EXIT || actual->native_error ||
      actual->syscall_is_error || actual->syscall_result != 0 ||
      barrier->entry_ordinal != seal->entry_ordinal || barrier->syscall_pending)
    return failed(seal, history, actual->native_error, EPROTO);
  size_t living = 0;
  for (size_t i = 0; i < history->thread_count; i++) {
    const struct lf_thread_history_entry *thread = &history->threads[i];
    if (thread->actually_exited) continue;
    if (!thread->currently_stopped || thread->exit_announced ||
        living >= seal->tid_count || thread->tid != seal->tids[living++])
      return failed(seal, history, 0, EPROTO);
  }
  if (living != seal->tid_count) return failed(seal, history, 0, EPROTO);
  if (lf_task_census_check(history->entry_gate.held_pidfd, in->held_proc_directory,
      in->held_workload_cgroup, history->root_tid, seal->tids, seal->tid_count,
      &seal->after_tasks) < 0)
    return failed(seal, history, seal->after_tasks.native_error, errno);
  struct lf_filter_view chain[3] = {
    {seal->early[0].instructions, seal->early[0].count},
    {seal->early[1].instructions, seal->early[1].count},
    {history->entry_gate.policy.instructions, history->entry_gate.policy.count}
  };
  if (lf_filter_inspect_all(seal->tids, seal->tid_count, chain, 3,
      in->after_filter_records, in->filter_record_capacity, &seal->after_filters) < 0)
    return failed(seal, history, seal->after_filters.native_error, errno);
  if (lf_fd_census(history->entry_gate.held_pidfd, in->held_proc_directory,
      in->nonoriginals, in->nonoriginal_count, in->after_fd_records,
      in->fd_record_capacity, &seal->after_fds) < 0)
    return failed(seal, history, seal->after_fds.native_error, errno);
  seal->verified = true;
  history->sealing_hold = false;
  return 1;
}
