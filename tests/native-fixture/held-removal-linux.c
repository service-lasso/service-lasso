#define _GNU_SOURCE
#include "held-removal-linux.h"

#include <errno.h>
#include <fcntl.h>
#include <string.h>
#include <unistd.h>

static bool same_object(const struct stat *actual, const struct stat *bound) {
  return actual->st_dev == bound->st_dev && actual->st_ino == bound->st_ino &&
      actual->st_uid == bound->st_uid && actual->st_gid == bound->st_gid &&
      actual->st_mode == bound->st_mode;
}

static bool same_content(const struct stat *actual, const struct stat *bound) {
  return same_object(actual, bound) && actual->st_nlink == 1 &&
      actual->st_nlink == bound->st_nlink &&
      actual->st_size == bound->st_size &&
      actual->st_mtim.tv_sec == bound->st_mtim.tv_sec &&
      actual->st_mtim.tv_nsec == bound->st_mtim.tv_nsec &&
      actual->st_ctim.tv_sec == bound->st_ctim.tv_sec &&
      actual->st_ctim.tv_nsec == bound->st_ctim.tv_nsec;
}

static bool component_valid(const char *component) {
  size_t bytes = strnlen(component, LF_REMOVAL_COMPONENT_BYTES);
  return bytes && bytes < LF_REMOVAL_COMPONENT_BYTES &&
      !strchr(component, '/') && strcmp(component, ".") &&
      strcmp(component, "..");
}

static int reject(struct lf_removal_record *record, int native_error,
                  int rejection_error) {
  record->native_result = -1;
  record->native_error = native_error;
  record->rejection_error = rejection_error;
  errno = rejection_error; return -1;
}

static int verify(const struct lf_removal_binding *binding,
                  struct lf_removal_record *record) {
  if (fstat(binding->held_parent, &record->actual_parent) < 0)
    return reject(record, errno, errno);
  if (!same_object(&record->actual_parent, &binding->bound_parent) ||
      !S_ISDIR(record->actual_parent.st_mode))
    return reject(record, 0, ESTALE);
  if (fstat(binding->held_object, &record->actual_held_object) < 0)
    return reject(record, errno, errno);
  if (fstatat(binding->held_parent, binding->component,
              &record->actual_named_object, AT_SYMLINK_NOFOLLOW) < 0)
    return reject(record, errno, errno);
  if (!same_object(&record->actual_held_object, &binding->bound_object) ||
      !same_object(&record->actual_named_object, &binding->bound_object))
    return reject(record, 0, ESTALE);
  if (S_ISREG(binding->bound_object.st_mode)) {
    if (!same_content(&record->actual_held_object, &binding->bound_object) ||
        !same_content(&record->actual_named_object, &binding->bound_object))
      return reject(record, 0, ESTALE);
  } else if (!S_ISDIR(binding->bound_object.st_mode)) {
    return reject(record, 0, EPROTO);
  }
  /* Directory mtime/ctime/nlink genuinely change as approved children unlink.
   * Their unchanged dev/ino/owner/mode binding, full approved inventory and
   * continuous writer exclusion remain mandatory; no metadata is rewritten. */
  record->native_result = 0;
  return 0;
}

static int fail(struct lf_removal_observation *observation,
                const struct lf_removal_record *record) {
  observation->stage = record->stage;
  observation->native_error = record->native_error;
  observation->rejection_error = record->rejection_error;
  errno = record->rejection_error; return -1;
}

int lf_held_remove(const struct lf_removal_binding *bindings,
    size_t binding_count, struct lf_removal_record *records,
    size_t record_capacity, struct lf_removal_observation *observation) {
  if (!observation) { errno = EINVAL; return -1; }
  memset(observation, 0, sizeof(*observation));
  observation->stage = LF_REMOVAL_INPUT;
  if (!bindings || !binding_count || binding_count > LF_REMOVAL_ENTRIES ||
      !records || record_capacity < 2 * binding_count) {
    observation->rejection_error = EINVAL; errno = EINVAL; return -1;
  }
  for (size_t i = 0; i < binding_count; i++) {
    const struct lf_removal_binding *binding = &bindings[i];
    if (!binding->object_key || binding->held_parent < 0 ||
        binding->held_object < 0 || !component_valid(binding->component) ||
        !S_ISDIR(binding->bound_parent.st_mode) ||
        (!S_ISDIR(binding->bound_object.st_mode) &&
         !S_ISREG(binding->bound_object.st_mode)) ||
        (S_ISREG(binding->bound_object.st_mode) &&
         binding->bound_object.st_nlink != 1) ||
        (binding->bound_parent.st_dev == binding->bound_object.st_dev &&
         binding->bound_parent.st_ino == binding->bound_object.st_ino)) {
      observation->rejection_error = EINVAL; errno = EINVAL; return -1;
    }
    for (size_t j = 0; j < i; j++) {
      const struct lf_removal_binding *prior = &bindings[j];
      if (prior->object_key == binding->object_key ||
          (prior->bound_object.st_dev == binding->bound_object.st_dev &&
           prior->bound_object.st_ino == binding->bound_object.st_ino) ||
          (prior->bound_parent.st_dev == binding->bound_parent.st_dev &&
           prior->bound_parent.st_ino == binding->bound_parent.st_ino &&
           !strcmp(prior->component, binding->component))) {
        observation->rejection_error = EINVAL; errno = EINVAL; return -1;
      }
    }
    for (size_t j = i + 1; j < binding_count; j++) {
      if (binding->bound_object.st_dev == bindings[j].bound_parent.st_dev &&
          binding->bound_object.st_ino == bindings[j].bound_parent.st_ino) {
        /* Every child must precede its parent, including directory children. */
        observation->rejection_error = EINVAL; errno = EINVAL; return -1;
      }
    }
  }
  /* Verify every approved object before mutation; do not discover a bad later
   * plan entry only after deleting earlier entries. Independent current copy
   * verification and complete inventory are required upstream before this. */
  observation->stage = LF_REMOVAL_PREFLIGHT;
  for (size_t i = 0; i < binding_count; i++) {
    struct lf_removal_record *record = &records[observation->record_count++];
    memset(record, 0, sizeof(*record));
    record->object_key = bindings[i].object_key;
    record->stage = LF_REMOVAL_PREFLIGHT;
    if (verify(&bindings[i], record) < 0) return fail(observation, record);
  }
  for (size_t i = 0; i < binding_count; i++) {
    const struct lf_removal_binding *binding = &bindings[i];
    struct lf_removal_record *record = &records[observation->record_count++];
    memset(record, 0, sizeof(*record));
    record->object_key = binding->object_key;
    record->stage = LF_REMOVAL_RECHECK;
    if (verify(binding, record) < 0) return fail(observation, record);
    record->stage = LF_REMOVAL_UNLINK;
    int actual = unlinkat(binding->held_parent, binding->component,
        S_ISDIR(binding->bound_object.st_mode) ? AT_REMOVEDIR : 0);
    record->native_result = actual;
    if (actual < 0) {
      record->native_error = record->rejection_error = errno;
      return fail(observation, record);
    }
    record->actually_unlinked = true;
    observation->removed_count++;
    record->stage = LF_REMOVAL_ABSENCE;
    actual = fstatat(binding->held_parent, binding->component,
        &record->actual_named_object, AT_SYMLINK_NOFOLLOW);
    record->native_result = actual;
    record->native_error = actual < 0 ? errno : 0;
    if (actual != -1 || record->native_error != ENOENT) {
      record->rejection_error = actual < 0 ? record->native_error : ESTALE;
      return fail(observation, record);
    }
    record->actual_absence = true;
    record->stage = LF_REMOVAL_COMPLETE;
  }
  observation->stage = LF_REMOVAL_COMPLETE;
  return 0;
}
