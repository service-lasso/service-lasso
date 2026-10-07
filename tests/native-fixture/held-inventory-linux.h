#ifndef SERVICE_LASSO_HELD_INVENTORY_LINUX_H
#define SERVICE_LASSO_HELD_INVENTORY_LINUX_H

#include "held-copy-linux.h"

#define LF_INVENTORY_DEPTH 64u
#define LF_INVENTORY_TOTAL_BYTES (64u * 1024u * 1024u)

struct lf_inventory_entry {
  struct lf_removal_binding binding;
  size_t parent_index; /* SIZE_MAX for root, whose outside parent stays held. */
  unsigned int depth;
  bool owns_object_fd;
  uint64_t held_mount_id;
  uint64_t named_mount_id;
  int enumeration_close_error;
  int object_close_error;
};
enum lf_inventory_stage {
  LF_INVENTORY_INPUT,
  LF_INVENTORY_ROOT,
  LF_INVENTORY_ENUMERATION,
  LF_INVENTORY_ENTRY,
  LF_INVENTORY_CLOSE,
  LF_INVENTORY_COMPLETE
};
struct lf_inventory_observation {
  enum lf_inventory_stage stage;
  size_t entry_count;
  size_t current_entry;
  uint64_t regular_bytes;
  int native_error;
  int rejection_error;
};

/* S supplies its actual inception-created, still exclusively held root/name
 * binding AFTER complete no-writer proof. Root must have private0700 mode and
 * unchanged owner; the approved parent's no-redirection proof is upstream.
 * Every descendant is genuinely enumerated/opened relative to held parents,
 * then name/held metadata is compared. No links, special objects, mount/device
 * changes, other owners, hardlink aliases, duplicate identities or truncation.
 * Raw Linux component bytes are retained unchanged. Keys are assigned within
 * THIS S-held inventory only and need the canonical invocation correlation.
 * All opened objects stay held, including after partial failure. Root/parent
 * descriptors remain borrowed and are never closed by release below.
 * Numeric ceilings are bounded construction limits, not positive admission.
 */
int lf_held_inventory(const struct lf_removal_binding *root,
    struct lf_inventory_entry *, size_t entry_capacity,
    struct lf_inventory_observation *);

/* Only for a successfully completed, still-held actual inventory. Emits every
 * binding deepest-first. This generates a plan, not copy/O/delete permission.
 */
int lf_inventory_removal_plan(const struct lf_inventory_entry *, size_t count,
    const struct lf_inventory_observation *, struct lf_removal_binding *,
    size_t plan_capacity);

/* Genuinely close ONLY module-owned object descriptors, deepest-first. Every
 * close result remains in the original entry. No retry on close error and no
 * synthetic success/reset. Preserve records through independent O capture.
 */
int lf_inventory_release(struct lf_inventory_entry *, size_t count);

#endif
