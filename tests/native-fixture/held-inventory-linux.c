#define _GNU_SOURCE
#include "held-inventory-linux.h"

#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <string.h>
#include <unistd.h>

static bool same_identity(const struct stat *a, const struct stat *b) {
  return a->st_dev == b->st_dev && a->st_ino == b->st_ino &&
      a->st_uid == b->st_uid && a->st_gid == b->st_gid &&
      a->st_mode == b->st_mode;
}
static bool same(const struct stat *a, const struct stat *b) {
  return a->st_dev == b->st_dev && a->st_ino == b->st_ino &&
      a->st_uid == b->st_uid && a->st_gid == b->st_gid &&
      a->st_mode == b->st_mode && a->st_nlink == b->st_nlink &&
      a->st_size == b->st_size &&
      a->st_mtim.tv_sec == b->st_mtim.tv_sec &&
      a->st_mtim.tv_nsec == b->st_mtim.tv_nsec &&
      a->st_ctim.tv_sec == b->st_ctim.tv_sec &&
      a->st_ctim.tv_nsec == b->st_ctim.tv_nsec;
}
static int failure(struct lf_inventory_observation *observation,
    int native_error, int rejection_error) {
  observation->native_error = native_error;
  observation->rejection_error = rejection_error;
  errno = rejection_error; return -1;
}
static bool component(const char *name) {
  size_t bytes = strnlen(name, LF_REMOVAL_COMPONENT_BYTES);
  return bytes && bytes < LF_REMOVAL_COMPONENT_BYTES && !strchr(name, '/') &&
      strcmp(name, ".") && strcmp(name, "..");
}
static int mounts(struct lf_inventory_entry *entry, uint64_t root_mount,
                  struct lf_inventory_observation *observation) {
  struct statx held, named;
  if (statx(entry->binding.held_object, "", AT_EMPTY_PATH | AT_SYMLINK_NOFOLLOW,
            STATX_MNT_ID, &held) < 0 ||
      statx(entry->binding.held_parent, entry->binding.component,
            AT_SYMLINK_NOFOLLOW, STATX_MNT_ID, &named) < 0)
    return failure(observation, errno, errno);
  entry->held_mount_id = held.stx_mnt_id;
  entry->named_mount_id = named.stx_mnt_id;
  if (!(held.stx_mask & STATX_MNT_ID) || !(named.stx_mask & STATX_MNT_ID))
    return failure(observation, 0, EOPNOTSUPP);
  if (!held.stx_mnt_id || !named.stx_mnt_id)
    return failure(observation, 0, EPROTO);
  if (held.stx_mnt_id != named.stx_mnt_id ||
      (root_mount && held.stx_mnt_id != root_mount))
    return failure(observation, 0, ESTALE);
  return 0;
}
static int enumerate(size_t parent_index, struct lf_inventory_entry *entries,
    size_t capacity, struct lf_inventory_observation *observation) {
  struct lf_inventory_entry *parent = &entries[parent_index];
  observation->current_entry = parent_index;
  observation->stage = LF_INVENTORY_ENUMERATION;
  int fd = openat(parent->binding.held_object, ".",
      O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
  if (fd < 0) return failure(observation, errno, errno);
  int primary_native = 0, primary_rejection = 0;
  if (fstat(fd, &parent->actual_enumeration_directory) < 0) {
    primary_native = primary_rejection = errno;
  } else if (!same(&parent->actual_enumeration_directory,
                   &parent->binding.bound_object)) {
    primary_rejection = ESTALE;
  }
  DIR *directory = NULL;
  if (!primary_rejection) {
    directory = fdopendir(fd);
    if (!directory) primary_native = primary_rejection = errno;
  }
  if (!directory) {
    if (close(fd) < 0) parent->enumeration_close_error = errno;
    return failure(observation, primary_native, primary_rejection);
  }
  for (;;) {
    observation->current_entry = parent_index;
    observation->stage = LF_INVENTORY_ENUMERATION;
    errno = 0;
    struct dirent *item = readdir(directory);
    if (!item) {
      if (errno) primary_native = primary_rejection = errno;
      break;
    }
    if (!strcmp(item->d_name, ".") || !strcmp(item->d_name, "..")) continue;
    if (!component(item->d_name) || observation->entry_count == capacity ||
        parent->depth == LF_INVENTORY_DEPTH) {
      primary_rejection = EOVERFLOW; break;
    }
    size_t index = observation->entry_count++;
    struct lf_inventory_entry *entry = &entries[index];
    memset(entry, 0, sizeof(*entry));
    entry->binding.object_key = index + 1;
    entry->binding.held_parent = parent->binding.held_object;
    entry->binding.held_object = -1;
    entry->parent_index = parent_index;
    entry->depth = parent->depth + 1;
    memcpy(entry->binding.component, item->d_name, strlen(item->d_name) + 1);
    observation->current_entry = index;
    observation->stage = LF_INVENTORY_ENTRY;
    if (fstat(entry->binding.held_parent, &entry->actual_parent) < 0 ||
        fstatat(entry->binding.held_parent, entry->binding.component,
                &entry->binding.bound_object, AT_SYMLINK_NOFOLLOW) < 0) {
      primary_native = primary_rejection = errno; break;
    }
    entry->binding.bound_parent = entry->actual_parent;
    const struct stat *original = &entries[0].binding.bound_object;
    const struct stat *bound = &entry->binding.bound_object;
    if (!same(&entry->binding.bound_parent, &parent->binding.bound_object) ||
        bound->st_dev != original->st_dev || bound->st_uid != original->st_uid ||
        bound->st_gid != original->st_gid ||
        (!S_ISDIR(bound->st_mode) && !S_ISREG(bound->st_mode)) ||
        (S_ISREG(bound->st_mode) && (bound->st_nlink != 1 ||
          bound->st_size < 0 || bound->st_size > LF_COPY_FILE_BYTES))) {
      primary_rejection = EPROTO; break;
    }
    for (size_t prior = 0; prior < index; prior++) {
      const struct stat *seen = &entries[prior].binding.bound_object;
      if (seen->st_dev == bound->st_dev && seen->st_ino == bound->st_ino) {
        primary_rejection = EPROTO; break;
      }
    }
    if (primary_rejection) break;
    if (S_ISREG(bound->st_mode)) {
      uint64_t bytes = (uint64_t)bound->st_size;
      if (bytes > LF_INVENTORY_TOTAL_BYTES - observation->regular_bytes) {
        primary_rejection = EOVERFLOW; break;
      }
      observation->regular_bytes += bytes;
    }
    int flags = O_RDONLY | O_NOFOLLOW | O_CLOEXEC | O_NONBLOCK;
    if (S_ISDIR(bound->st_mode)) flags |= O_DIRECTORY;
    entry->binding.held_object = openat(entry->binding.held_parent,
                                        entry->binding.component, flags);
    if (entry->binding.held_object < 0) {
      primary_native = primary_rejection = errno; break;
    }
    entry->owns_object_fd = true;
    if (fstat(entry->binding.held_object, &entry->actual_held_object) < 0 ||
        fstatat(entry->binding.held_parent, entry->binding.component,
                &entry->actual_named_object,
                AT_SYMLINK_NOFOLLOW) < 0) {
      primary_native = primary_rejection = errno; break;
    }
    if (!same(&entry->actual_held_object, bound) ||
        !same(&entry->actual_named_object, bound)) {
      primary_rejection = ESTALE; break;
    }
    if (mounts(entry, entries[0].held_mount_id, observation) < 0) {
      primary_native = observation->native_error;
      primary_rejection = observation->rejection_error; break;
    }
    if (S_ISDIR(bound->st_mode) && enumerate(index, entries, capacity,
                                            observation) < 0) {
      primary_native = observation->native_error;
      primary_rejection = observation->rejection_error;
      break;
    }
  }
  if (!primary_rejection) {
    if (fstat(parent->binding.held_object, &parent->actual_held_object) < 0 ||
        fstatat(parent->binding.held_parent, parent->binding.component,
                &parent->actual_named_object,
                AT_SYMLINK_NOFOLLOW) < 0) {
      primary_native = primary_rejection = errno;
    } else if (!same(&parent->actual_held_object, &parent->binding.bound_object) ||
               !same(&parent->actual_named_object, &parent->binding.bound_object)) {
      primary_rejection = ESTALE;
    } else if (mounts(parent, entries[0].held_mount_id, observation) < 0) {
      primary_native = observation->native_error;
      primary_rejection = observation->rejection_error;
    }
  }
  if (closedir(directory) < 0) {
    parent->enumeration_close_error = errno;
    if (!primary_rejection) {
      observation->stage = LF_INVENTORY_CLOSE;
      observation->current_entry = parent_index;
      primary_native = primary_rejection = errno;
    }
  }
  if (primary_rejection)
    return failure(observation, primary_native, primary_rejection);
  return 0;
}

int lf_held_inventory(const struct lf_removal_binding *root,
    struct lf_inventory_entry *entries, size_t capacity,
    struct lf_inventory_observation *observation) {
  if (!observation) { errno = EINVAL; return -1; }
  memset(observation, 0, sizeof(*observation));
  observation->stage = LF_INVENTORY_INPUT;
  if (!root || root->held_parent < 0 || root->held_object < 0 ||
      !component(root->component) || !S_ISDIR(root->bound_parent.st_mode) ||
      !S_ISDIR(root->bound_object.st_mode) ||
      (root->bound_object.st_mode & 07777) != 0700 || !entries || !capacity ||
      capacity > LF_REMOVAL_ENTRIES)
    return failure(observation, 0, EINVAL);
  memset(&entries[0], 0, sizeof(entries[0]));
  entries[0].binding = *root;
  entries[0].binding.object_key = 1;
  entries[0].parent_index = SIZE_MAX;
  observation->entry_count = 1;
  observation->stage = LF_INVENTORY_ROOT;
  struct lf_inventory_entry *entry = &entries[0];
  if (fstat(root->held_parent, &entry->actual_parent) < 0 ||
      fstat(root->held_object, &entry->actual_held_object) < 0 ||
      fstatat(root->held_parent, root->component, &entry->actual_named_object,
              AT_SYMLINK_NOFOLLOW) < 0)
    return failure(observation, errno, errno);
  if (!same_identity(&entry->actual_parent, &root->bound_parent) ||
      !same_identity(&entry->actual_held_object, &root->bound_object) ||
      !same(&entry->actual_named_object, &entry->actual_held_object))
    return failure(observation, 0, ESTALE);
  /* Creator object identity remains fixed. Capture genuine current inventory
   * metadata after drain; normal fixture writes changed root metadata. */
  entry->binding.bound_parent = entry->actual_parent;
  entry->binding.bound_object = entry->actual_held_object;
  if (mounts(&entries[0], 0, observation) < 0) return -1;
  if (enumerate(0, entries, capacity, observation) < 0) return -1;
  observation->stage = LF_INVENTORY_COMPLETE;
  return 0;
}

int lf_inventory_removal_plan(const struct lf_inventory_entry *entries,
    size_t count, const struct lf_inventory_observation *observation,
    struct lf_removal_binding *plan, size_t capacity) {
  if (!entries || !observation || observation->stage != LF_INVENTORY_COMPLETE ||
      count != observation->entry_count || !count || count > LF_REMOVAL_ENTRIES ||
      !plan || capacity < count) { errno = EINVAL; return -1; }
  size_t output = 0;
  for (unsigned int depth = LF_INVENTORY_DEPTH + 1; depth > 0; depth--) {
    for (size_t i = count; i > 0; i--) {
      if (entries[i - 1].depth == depth - 1)
        plan[output++] = entries[i - 1].binding;
    }
  }
  if (output != count) { errno = EPROTO; return -1; }
  return 0;
}

int lf_inventory_release(struct lf_inventory_entry *entries, size_t count) {
  if (!entries || !count || count > LF_REMOVAL_ENTRIES) {
    errno = EINVAL; return -1;
  }
  int first_error = 0;
  for (size_t i = count; i > 0; i--) {
    struct lf_inventory_entry *entry = &entries[i - 1];
    if (entry->object_close_error && !first_error)
      first_error = entry->object_close_error;
    if (!entry->owns_object_fd) continue;
    entry->owns_object_fd = false;
    int actual = close(entry->binding.held_object);
    entry->binding.held_object = -1;
    if (actual < 0) {
      entry->object_close_error = errno;
      if (!first_error) first_error = errno;
    }
  }
  if (first_error) { errno = first_error; return -1; }
  return 0;
}
