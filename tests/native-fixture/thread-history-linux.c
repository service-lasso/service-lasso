#define _GNU_SOURCE
#include "thread-history-linux.h"

#include <errno.h>
#include <limits.h>
#include <linux/sched.h>
#include <sys/ptrace.h>
#include <sys/syscall.h>
#include <sys/wait.h>
#include <string.h>
#include <unistd.h>

static int fail(struct lf_thread_history *history, int native_error,
                int rejection_error) {
  history->failed = true;
  history->native_error = native_error;
  history->rejection_error = rejection_error;
  errno = rejection_error; return -1;
}
static struct lf_thread_history_entry *find(struct lf_thread_history *history,
                                           pid_t tid) {
  for (size_t i = 0; i < history->thread_count; i++)
    if (history->threads[i].tid == tid) return &history->threads[i];
  return NULL;
}
static bool birth_stop(const struct lf_trace_observation *actual) {
  return actual->stop == LF_TRACE_INTERRUPT_OR_GROUP &&
      (actual->stop_signal == SIGTRAP || actual->stop_signal == SIGSTOP);
}
static bool restart_result(int64_t value) {
  /* Genuine kernel -ERESTARTSYS/NOINTR/NOHAND/RESTARTBLOCK observations,
   * never reported as ordinary EINTR or cleared by the next sampled stop. */
  return value == -512 || value == -513 || value == -514 || value == -516;
}
static int accept(struct lf_thread_history *history,
    struct lf_thread_history_entry *thread,
    const struct lf_trace_observation *actual, uint64_t ordinal) {
  if (thread->actually_exited)
    return fail(history, 0, EPROTO);
  thread->currently_stopped = actual->stop != LF_TRACE_NATIVE_EXIT;
  if (thread->awaiting_birth_stop) {
    if (!birth_stop(actual)) return fail(history, 0, EPROTO);
    thread->last_observation = *actual;
    return 0;
  }
  switch (actual->stop) {
    case LF_TRACE_SYSCALL_ENTRY:
      if (thread->syscall_pending || thread->exit_announced)
        return fail(history, 0, EPROTO);
      thread->syscall_pending = true;
      thread->syscall_number = actual->syscall_number;
      memcpy(thread->arguments, actual->arguments, sizeof(thread->arguments));
      thread->entry_ordinal = ordinal;
      thread->pending_clone_tid = 0;
      break;
    case LF_TRACE_SECCOMP:
      if (!thread->syscall_pending || thread->exit_announced ||
          thread->syscall_number != actual->syscall_number ||
          memcmp(thread->arguments, actual->arguments, sizeof(thread->arguments)))
        return fail(history, 0, EPROTO);
      break;
    case LF_TRACE_SYSCALL_EXIT:
      if (!thread->syscall_pending || thread->exit_announced)
        return fail(history, 0, EPROTO);
      if (thread->pending_clone_tid &&
          (actual->syscall_is_error ||
           actual->syscall_result != thread->pending_clone_tid))
        return fail(history, 0, EPROTO);
      if (thread->inherited_clone_return_pending &&
          (actual->syscall_is_error || actual->syscall_result != 0))
        return fail(history, 0, EPROTO);
      thread->inherited_clone_return_pending = false;
      thread->syscall_pending = false;
      thread->exit_ordinal = ordinal;
      if (restart_result(actual->syscall_result)) {
        thread->has_restart_result = true;
        thread->restart_result = actual->syscall_result;
      }
      /* Restart history is sticky. A later entry does not certify drain or
       * erase an earlier mutable restart-block/original-effect obligation. */
      break;
    case LF_TRACE_CLONE: {
      if (!thread->syscall_pending || thread->syscall_number != SYS_clone ||
          thread->pending_clone_tid ||
          thread->arguments[0] != history->admitted_pthread_flags ||
          !actual->native_event_value || actual->native_event_value > INT_MAX ||
          history->thread_count == LF_POLICY_THREADS)
        return fail(history, 0, EPROTO);
      pid_t child = (pid_t)actual->native_event_value;
      if (find(history, child)) return fail(history, 0, EPROTO);
      errno = 0;
      pid_t group = getpgid(child);
      if (group < 0) return fail(history, errno, errno);
      if (group != history->held_process_group)
        return fail(history, 0, EPROTO);
      thread->pending_clone_tid = child;
      struct lf_thread_history_entry *born =
          &history->threads[history->thread_count++];
      memset(born, 0, sizeof(*born));
      born->tid = child; born->creator_tid = thread->tid;
      born->awaiting_birth_stop = true;
      /* The child is born INSIDE this genuinely observed parent clone. Its
       * tracing birth stop precedes returning from the same kernel call with
       * retval0. Do not invent an independent child entry stop or reject its
       * real first exit as an orphan. Preserve the actual causal ordinal. */
      born->syscall_pending = true;
      born->syscall_number = thread->syscall_number;
      memcpy(born->arguments, thread->arguments, sizeof(born->arguments));
      born->entry_ordinal = thread->entry_ordinal;
      born->inherited_clone_return_pending = true;
      size_t matches = 0;
      for (size_t i = 0; i < history->record_count; i++) {
        struct lf_thread_history_record *record = &history->records[i];
        if (!record->awaiting_creator_event || record->actual.tid != child)
          continue;
        if (++matches > 1 || !birth_stop(&record->actual))
          return fail(history, 0, EPROTO);
        born->last_observation = record->actual;
        born->currently_stopped = true;
        record->awaiting_creator_event = false;
      }
      break;
    }
    case LF_TRACE_EXIT_EVENT:
      if (thread->exit_announced) return fail(history, 0, EPROTO);
      thread->exit_announced = true;
      break;
    case LF_TRACE_NATIVE_EXIT:
      if (!thread->exit_announced) return fail(history, 0, EPROTO);
      thread->actually_exited = true;
      break;
    case LF_TRACE_SIGNAL:
    case LF_TRACE_INTERRUPT_OR_GROUP:
      break; /* Preserve pending syscall/effect history without settlement. */
    case LF_TRACE_EXEC:
    case LF_TRACE_FORK:
    case LF_TRACE_VFORK:
    case LF_TRACE_UNKNOWN:
    default:
      return fail(history, 0, EPROTO);
  }
  thread->last_observation = *actual;
  return 0;
}

int lf_thread_history_begin(struct lf_thread_history *history, pid_t root_tid,
    pid_t held_process_group, uint64_t admitted_pthread_flags,
    struct lf_thread_history_record *records, size_t capacity) {
  if (!history) { errno = EINVAL; return -1; }
  if (history->failed) { errno = history->rejection_error; return -1; }
  if (history->initialized) return fail(history, 0, EPROTO);
  memset(history, 0, sizeof(*history));
  history->initialized = true;
  uint64_t required = CLONE_VM | CLONE_FS | CLONE_FILES | CLONE_SIGHAND |
      CLONE_THREAD | CLONE_SYSVSEM | CLONE_SETTLS;
  uint64_t allowed = required | CLONE_PARENT_SETTID | CLONE_CHILD_SETTID |
      CLONE_CHILD_CLEARTID;
  if (root_tid <= 0 || held_process_group <= 0 || !records || !capacity ||
      (admitted_pthread_flags & required) != required ||
      (admitted_pthread_flags & ~allowed))
    return fail(history, 0, EINVAL);
  errno = 0;
  pid_t actual_group = getpgid(root_tid);
  if (actual_group < 0) return fail(history, errno, errno);
  if (actual_group != held_process_group)
    return fail(history, 0, EPROTO);
  history->root_tid = root_tid;
  history->held_process_group = held_process_group;
  history->admitted_pthread_flags = admitted_pthread_flags;
  history->records = records; history->record_capacity = capacity;
  history->thread_count = 1;
  history->threads[0].tid = root_tid;
  return 0;
}

int lf_thread_history_next(struct lf_thread_history *history) {
  if (!history) { errno = EINVAL; return -1; }
  if (history->failed) { errno = history->rejection_error; return -1; }
  /* Reserve BEFORE wait: exhausted capacity must not reap an uncaptured event. */
  if (history->record_count == history->record_capacity)
    return fail(history, 0, ENOSPC);
  int status = 0;
  errno = 0;
  pid_t tid = waitpid(-history->held_process_group, &status, __WALL | WNOHANG);
  if (tid < 0) return fail(history, errno, errno);
  if (!tid) return 0;
  struct lf_thread_history_record *record =
      &history->records[history->record_count++];
  memset(record, 0, sizeof(*record));
  if (lf_trace_observe(tid, status, &record->actual) < 0)
    return fail(history, record->actual.native_error,
                 record->actual.native_error ? record->actual.native_error : EPROTO);
  struct lf_thread_history_entry *thread = find(history, tid);
  if (!thread) {
    if (!birth_stop(&record->actual)) return fail(history, 0, EPROTO);
    for (size_t i = 0; i + 1 < history->record_count; i++)
      if (history->records[i].awaiting_creator_event &&
          history->records[i].actual.tid == tid)
        return fail(history, 0, EPROTO);
    record->awaiting_creator_event = true;
    return 1;
  }
  record->causal_entry_ordinal = record->actual.stop == LF_TRACE_SYSCALL_ENTRY ?
      history->record_count : (thread->syscall_pending ? thread->entry_ordinal : 0);
  if (accept(history, thread, &record->actual, history->record_count) < 0)
    return -1;
  return 1;
}

int lf_thread_history_resume(struct lf_thread_history *history, pid_t tid) {
  if (!history) { errno = EINVAL; return -1; }
  if (history->failed) { errno = history->rejection_error; return -1; }
  if (history->sealing_hold) return fail(history, 0, EPROTO);
  struct lf_thread_history_entry *thread = find(history, tid);
  if (!thread || thread->actually_exited || !thread->currently_stopped ||
      thread->last_observation.tid != tid)
    return fail(history, 0, EPROTO);
  const struct lf_trace_observation *actual = &thread->last_observation;
  if (history->entry_gate.closed && thread->syscall_pending &&
      actual->stop != LF_TRACE_SYSCALL_ENTRY) {
    if (!thread->entry_ordinal || thread->entry_ordinal > history->record_count ||
        !history->records[thread->entry_ordinal - 1].gate_checked)
      return fail(history, 0, EPROTO);
  }
  if (history->entry_gate.closed && actual->stop == LF_TRACE_SYSCALL_ENTRY) {
    if (!thread->entry_ordinal || thread->entry_ordinal > history->record_count)
      return fail(history, 0, EPROTO);
    struct lf_thread_history_record *record =
        &history->records[thread->entry_ordinal - 1];
    if (record->gate_checked || record->actual.tid != tid ||
        record->actual.stop != LF_TRACE_SYSCALL_ENTRY)
      return fail(history, 0, EPROTO);
    int permitted = lf_entry_gate_check(&history->entry_gate, actual);
    record->gate_checked = true;
    record->gate_observation = history->entry_gate.last_observation;
    if (permitted < 0)
      return fail(history, record->gate_observation.native_error,
                  record->gate_observation.rejection_error);
  }
  int result;
  if (thread->awaiting_birth_stop) {
    if (!birth_stop(actual)) return fail(history, 0, EPROTO);
    result = (int)ptrace(PTRACE_SYSCALL, tid, NULL, NULL);
    if (!result) thread->awaiting_birth_stop = false;
  } else if (actual->stop == LF_TRACE_EXIT_EVENT) {
    /* Continue actual terminal task teardown; its later native wait exit is
     * still mandatory and does not certify original descriptor/effect drain. */
    result = (int)ptrace(PTRACE_CONT, tid, NULL, NULL);
  } else {
    int signal = actual->stop == LF_TRACE_SIGNAL ?
        actual->actual_signal_info.si_signo : 0;
    result = lf_trace_resume(actual, signal);
  }
  if (result < 0) return fail(history, errno, errno);
  thread->currently_stopped = false;
  return 0;
}

int lf_thread_history_close_acquisition(struct lf_thread_history *history,
    int pidfd, const struct lf_terminal_catalog *catalog,
    const struct lf_fd_binding *originals, size_t original_count,
    const struct lf_fd_binding *nonoriginals, size_t nonoriginal_count) {
  if (!history) { errno = EINVAL; return -1; }
  if (history->failed) { errno = history->rejection_error; return -1; }
  if (!history->initialized || history->entry_gate.closed || !catalog ||
      catalog->tgid != history->root_tid || !catalog->tids ||
      !catalog->tid_count || catalog->tid_count > LF_POLICY_THREADS ||
      !nonoriginals || !nonoriginal_count || nonoriginal_count > LF_POLICY_FDS ||
      nonoriginal_count != catalog->fd_count)
    return fail(history, 0, EPROTO);
  struct lf_terminal_policy policy;
  if (lf_terminal_policy_build(catalog, &policy) < 0)
    return fail(history, 0, errno);
  for (size_t i = 0; i < nonoriginal_count; i++) {
    if (nonoriginals[i].held_fd < 0 || !nonoriginals[i].object_key)
      return fail(history, 0, EPROTO);
    size_t matches = 0;
    for (size_t j = 0; j < catalog->fd_count; j++)
      if (nonoriginals[i].workload_fd == catalog->fds[j].fd &&
          nonoriginals[i].rights == catalog->fds[j].rights) matches++;
    if (matches != 1) return fail(history, 0, EPROTO);
    for (size_t j = 0; j < i; j++)
      if (nonoriginals[j].workload_fd == nonoriginals[i].workload_fd)
        return fail(history, 0, EPROTO);
  }
  for (size_t i = 0; i < history->record_count; i++)
    if (history->records[i].awaiting_creator_event)
      return fail(history, 0, EPROTO);
  size_t living = 0;
  for (size_t i = 0; i < history->thread_count; i++) {
    struct lf_thread_history_entry *thread = &history->threads[i];
    if (thread->actually_exited) continue;
    if (!thread->currently_stopped || thread->awaiting_birth_stop ||
        thread->exit_announced || thread->has_restart_result ||
        thread->inherited_clone_return_pending || !thread->syscall_pending)
      return fail(history, 0, EPROTO);
    if (thread->last_observation.stop != LF_TRACE_SYSCALL_ENTRY) {
      if (thread->last_observation.stop != LF_TRACE_INTERRUPT_OR_GROUP ||
          thread->last_observation.stop_signal != SIGTRAP ||
          !thread->entry_ordinal || thread->entry_ordinal > history->record_count)
        return fail(history, 0, EPROTO);
      const struct lf_trace_observation *entry =
          &history->records[thread->entry_ordinal - 1].actual;
      if (entry->tid != thread->tid ||
          lf_parked_wait_check(entry, &policy, pidfd, nonoriginals,
              nonoriginal_count, &thread->wait_observation) < 0)
        return fail(history, thread->wait_observation.native_error,
                    thread->wait_observation.rejection_error ?
                    thread->wait_observation.rejection_error : EPROTO);
      thread->acquisition_closed_in_wait = true;
    }
    size_t matches = 0;
    for (size_t j = 0; j < catalog->tid_count; j++)
      if (catalog->tids[j] == thread->tid) matches++;
    if (matches != 1) return fail(history, 0, EPROTO);
    living++;
  }
  if (living != catalog->tid_count) return fail(history, 0, EPROTO);
  if (lf_entry_gate_close(&history->entry_gate, pidfd, catalog,
                          originals, original_count) < 0)
    return fail(history, history->entry_gate.last_observation.native_error,
                history->entry_gate.last_observation.rejection_error);
  for (size_t i = 0; i < history->thread_count; i++) {
    const struct lf_thread_history_entry *thread = &history->threads[i];
    if (!thread->acquisition_closed_in_wait) continue;
    struct lf_thread_history_record *record =
        &history->records[thread->entry_ordinal - 1];
    /* Explicitly distinguish closure DURING a proved non-original wait from
     * permission issued before its original entry. Never backdate the gate. */
    record->gate_closed_during_memory_wait = true;
    record->gate_checked = true;
    record->gate_observation = thread->wait_observation;
  }
  return 0;
}
