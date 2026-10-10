#define _GNU_SOURCE
#include "held-copy-linux.h"

#include <errno.h>
#include <fcntl.h>
#include <string.h>
#include <unistd.h>

static bool same_identity(const struct stat *a, const struct stat *b) {
  return a->st_dev == b->st_dev && a->st_ino == b->st_ino &&
      a->st_uid == b->st_uid && a->st_gid == b->st_gid &&
      a->st_mode == b->st_mode && a->st_nlink == 1 && b->st_nlink == 1 &&
      S_ISREG(a->st_mode) && S_ISREG(b->st_mode);
}
static bool same_content(const struct stat *a, const struct stat *b) {
  return same_identity(a, b) && a->st_size == b->st_size &&
      a->st_mtim.tv_sec == b->st_mtim.tv_sec &&
      a->st_mtim.tv_nsec == b->st_mtim.tv_nsec &&
      a->st_ctim.tv_sec == b->st_ctim.tv_sec &&
      a->st_ctim.tv_nsec == b->st_ctim.tv_nsec;
}
static int failure(struct lf_copy_observation *observation, int native_error,
                   int rejection_error) {
  observation->native_error = native_error;
  observation->rejection_error = rejection_error;
  errno = rejection_error; return -1;
}
static bool binding_valid(const struct lf_removal_binding *binding) {
  if (!binding || binding->held_parent < 0 || binding->held_object < 0 ||
      !binding->object_key || !S_ISDIR(binding->bound_parent.st_mode) ||
      !S_ISREG(binding->bound_object.st_mode) ||
      binding->bound_object.st_nlink != 1) return false;
  size_t bytes = strnlen(binding->component, LF_REMOVAL_COMPONENT_BYTES);
  return bytes && bytes < LF_REMOVAL_COMPONENT_BYTES &&
      !strchr(binding->component, '/') && strcmp(binding->component, ".") &&
      strcmp(binding->component, "..");
}
static int identity(const struct lf_removal_binding *binding,
                    struct stat *actual, bool unchanged_content,
                    struct lf_copy_observation *observation) {
  struct stat parent, named;
  if (fstat(binding->held_parent, &parent) < 0 ||
      fstat(binding->held_object, actual) < 0 ||
      fstatat(binding->held_parent, binding->component, &named,
              AT_SYMLINK_NOFOLLOW) < 0)
    return failure(observation, errno, errno);
  const struct stat *bound_parent = &binding->bound_parent;
  if (!S_ISDIR(parent.st_mode) || parent.st_dev != bound_parent->st_dev ||
      parent.st_ino != bound_parent->st_ino ||
      parent.st_uid != bound_parent->st_uid ||
      parent.st_gid != bound_parent->st_gid ||
      parent.st_mode != bound_parent->st_mode ||
      !same_identity(actual, &binding->bound_object) ||
      !same_content(actual, &named) ||
      (unchanged_content && !same_content(actual, &binding->bound_object)))
    return failure(observation, 0, ESTALE);
  return 0;
}
static struct lf_copy_record *reserve(struct lf_copy_observation *observation,
    struct lf_copy_record *records, size_t capacity, uint64_t offset,
    size_t requested_bytes) {
  if (observation->record_count == capacity) {
    failure(observation, 0, ENOSPC); return NULL;
  }
  struct lf_copy_record *record = &records[observation->record_count++];
  memset(record, 0, sizeof(*record));
  record->stage = observation->stage;
  record->offset = offset;
  record->requested_bytes = requested_bytes;
  return record;
}
static ssize_t read_at(int fd, unsigned char *buffer, size_t bytes,
    uint64_t offset, struct lf_copy_record *records, size_t capacity,
    struct lf_copy_observation *observation) {
  struct lf_copy_record *record = reserve(observation, records, capacity,
                                         offset, bytes);
  if (!record) return -1;
  ssize_t actual = pread(fd, buffer, bytes, (off_t)offset);
  record->native_result = actual;
  if (actual < 0) {
    record->native_error = errno;
    return failure(observation, errno, errno);
  }
  return actual;
}

int lf_held_copy_file(const struct lf_removal_binding *original,
    const struct lf_removal_binding *copy_binding,
    unsigned char *original_buffer, unsigned char *copy_buffer,
    size_t buffer_capacity, struct lf_copy_record *records,
    size_t record_capacity, struct lf_copy_observation *observation) {
  if (!observation) { errno = EINVAL; return -1; }
  memset(observation, 0, sizeof(*observation));
  observation->stage = LF_COPY_INPUT;
  if (!binding_valid(original) || !binding_valid(copy_binding) ||
      !original_buffer || !copy_buffer || original_buffer == copy_buffer ||
      buffer_capacity < LF_COPY_CHUNK_BYTES || !records || !record_capacity ||
      original->bound_object.st_size < 0 ||
      original->bound_object.st_size > LF_COPY_FILE_BYTES ||
      copy_binding->bound_object.st_size != 0 ||
      (copy_binding->bound_object.st_mode & 07777) != 0600 ||
      original->object_key == copy_binding->object_key ||
      (original->bound_object.st_dev == copy_binding->bound_object.st_dev &&
       original->bound_object.st_ino == copy_binding->bound_object.st_ino))
    return failure(observation, 0, EINVAL);
  uintptr_t original_address = (uintptr_t)original_buffer;
  uintptr_t copy_address = (uintptr_t)copy_buffer;
  uintptr_t separation = original_address < copy_address ?
      copy_address - original_address : original_address - copy_address;
  if (separation < LF_COPY_CHUNK_BYTES)
    return failure(observation, 0, EINVAL);
  observation->stage = LF_COPY_IDENTITY;
  int original_flags = fcntl(original->held_object, F_GETFL);
  if (original_flags < 0) return failure(observation, errno, errno);
  int copy_flags = fcntl(copy_binding->held_object, F_GETFL);
  if (copy_flags < 0) return failure(observation, errno, errno);
  /* Linux pwrite on O_APPEND ignores the supplied offset. Reject it instead
   * of modifying the shared OFD flags or claiming an exact copied position. */
  if ((original_flags & O_PATH) || (copy_flags & (O_PATH | O_APPEND)) ||
      (original_flags & O_ACCMODE) == O_WRONLY ||
      (copy_flags & O_ACCMODE) != O_RDWR)
    return failure(observation, 0, EINVAL);
  if (identity(original, &observation->actual_original, true, observation) < 0 ||
      identity(copy_binding, &observation->actual_copy, true, observation) < 0)
    return -1;
  uint64_t size = (uint64_t)original->bound_object.st_size;
  while (observation->copied_bytes < size) {
    uint64_t offset = observation->copied_bytes;
    size_t bytes = size - offset > LF_COPY_CHUNK_BYTES ? LF_COPY_CHUNK_BYTES :
        (size_t)(size - offset);
    observation->stage = LF_COPY_READ;
    ssize_t actual = read_at(original->held_object, original_buffer, bytes,
        offset, records, record_capacity, observation);
    if (actual < 0) return -1;
    if (!actual) return failure(observation, 0, EIO);
    size_t written = 0;
    while (written < (size_t)actual) {
      observation->stage = LF_COPY_WRITE;
      struct lf_copy_record *record = reserve(observation, records,
          record_capacity, offset + written, (size_t)actual - written);
      if (!record) return -1;
      ssize_t result = pwrite(copy_binding->held_object,
          original_buffer + written, (size_t)actual - written,
          (off_t)(offset + written));
      record->native_result = result;
      if (result < 0) {
        record->native_error = errno;
        return failure(observation, errno, errno);
      }
      if (!result) return failure(observation, 0, EIO);
      written += (size_t)result;
      observation->copied_bytes += (uint64_t)result;
    }
  }
  observation->stage = LF_COPY_FLUSH;
  struct lf_copy_record *flush = reserve(observation, records, record_capacity,
                                       size, 0);
  if (!flush) return -1;
  int actual_flush = fsync(copy_binding->held_object);
  flush->native_result = actual_flush;
  if (actual_flush < 0) {
    flush->native_error = errno;
    return failure(observation, errno, errno);
  }
  observation->stage = LF_COPY_READBACK;
  while (observation->verified_bytes < size) {
    uint64_t offset = observation->verified_bytes;
    size_t bytes = size - offset > LF_COPY_CHUNK_BYTES ? LF_COPY_CHUNK_BYTES :
        (size_t)(size - offset);
    ssize_t left = read_at(original->held_object, original_buffer, bytes,
        offset, records, record_capacity, observation);
    if (left < 0) return -1;
    if (!left) return failure(observation, 0, EIO);
    size_t read_copy = 0;
    while (read_copy < (size_t)left) {
      ssize_t right = read_at(copy_binding->held_object,
          copy_buffer + read_copy, (size_t)left - read_copy, offset + read_copy,
          records, record_capacity, observation);
      if (right < 0) return -1;
      if (!right) return failure(observation, 0, EIO);
      read_copy += (size_t)right;
    }
    if (memcmp(original_buffer, copy_buffer, (size_t)left))
      return failure(observation, 0, EBADMSG);
    observation->verified_bytes += (uint64_t)left;
  }
  /* Check real EOF on BOTH current objects, including zero-byte originals. */
  ssize_t original_tail = read_at(original->held_object, original_buffer, 1,
      size, records, record_capacity, observation);
  if (original_tail < 0) return -1;
  if (original_tail) return failure(observation, 0, ESTALE);
  ssize_t copy_tail = read_at(copy_binding->held_object, copy_buffer, 1,
      size, records, record_capacity, observation);
  if (copy_tail < 0) return -1;
  if (copy_tail) return failure(observation, 0, ESTALE);
  observation->stage = LF_COPY_FINAL_IDENTITY;
  if (identity(original, &observation->actual_original, true, observation) < 0 ||
      identity(copy_binding, &observation->actual_copy, false, observation) < 0)
    return -1;
  if ((uint64_t)observation->actual_copy.st_size != size)
    return failure(observation, 0, ESTALE);
  observation->stage = LF_COPY_COMPLETE;
  return 0;
}
