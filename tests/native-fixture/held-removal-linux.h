#ifndef SERVICE_LASSO_HELD_REMOVAL_LINUX_H
#define SERVICE_LASSO_HELD_REMOVAL_LINUX_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include <sys/stat.h>

#define LF_REMOVAL_ENTRIES 128u
#define LF_REMOVAL_COMPONENT_BYTES 256u

/* S alone constructs these from its actual held original inventory. No W0
 * pathname, descriptor, receipt, owner claim or request creates a binding.
 * Parent and object descriptors stay exclusively held for the transaction.
 * Removal order is deepest-first; parents must remain held through completion.
 * The complete no-writer/no-redirection/copy/O proof is a caller precondition,
 * not a Boolean supplied to this module and not inferred from these stats. */
struct lf_removal_binding {
  uint64_t object_key;
  int held_parent;
  int held_object;
  char component[LF_REMOVAL_COMPONENT_BYTES];
  struct stat bound_parent;
  struct stat bound_object;
};

enum lf_removal_stage {
  LF_REMOVAL_INPUT,
  LF_REMOVAL_PREFLIGHT,
  LF_REMOVAL_RECHECK,
  LF_REMOVAL_UNLINK,
  LF_REMOVAL_ABSENCE,
  LF_REMOVAL_COMPLETE
};

struct lf_removal_record {
  uint64_t object_key;
  enum lf_removal_stage stage;
  struct stat actual_parent;
  struct stat actual_held_object;
  struct stat actual_named_object;
  long native_result;
  int native_error;
  int rejection_error;
  bool actually_unlinked;
  bool actual_absence;
};

struct lf_removal_observation {
  enum lf_removal_stage stage;
  size_t record_count;
  size_t removed_count;
  int native_error;
  int rejection_error;
};

/* Pre-reserved records retain ALL preflight and removal attempts, actual errno
 * and partial outcome. Stop at the first error. No recursive named rm, retry,
 * forced absence, deletion of unexpected entries, cleanup or reset occurs.
 * A partial-fault recipe supplies only its already-approved finite journal
 * operation; complete original deletion requires the FULL approved plan.
 * This primitive does not establish inventory completeness or release handles.
 * Empty/duplicate/path-like plans reject before the first filesystem operation.
 */
int lf_held_remove(const struct lf_removal_binding *, size_t binding_count,
    struct lf_removal_record *, size_t record_capacity,
    struct lf_removal_observation *);

#endif
