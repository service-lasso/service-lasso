#ifndef SERVICE_LASSO_FD_CENSUS_LINUX_H
#define SERVICE_LASSO_FD_CENSUS_LINUX_H

#include "terminal-policy-linux.h"
#include <sys/stat.h>

/* Bindings originate from actual S creation/inception capture BEFORE originals
 * and survive under held native ownership. No original object is admissible.
 * held_fd is an independently retained S duplicate of the SAME open-file
 * description, never an fd inferred from inode/type alone. */
struct lf_fd_binding {
  int workload_fd;
  int held_fd;
  uint64_t object_key;
  uint32_t rights;
};
struct lf_fd_census_record {
  int workload_fd;
  uint64_t object_key;
  uint32_t rights;
  long native_comparison;
  struct stat actual_metadata;
  int duplicate_close_error;
};
enum lf_fd_census_stage {
  LF_CENSUS_INPUT,
  LF_CENSUS_ENUMERATION,
  LF_CENSUS_DUPLICATE,
  LF_CENSUS_METADATA,
  LF_CENSUS_COMPARE,
  LF_CENSUS_CLOSE,
  LF_CENSUS_COMPLETE
};
struct lf_fd_census_observation {
  enum lf_fd_census_stage stage;
  int workload_fd;
  long native_result;
  int native_error;
  int cleanup_error;
  size_t record_count;
};

/* Actual tracer has all original W0 threads continuously parked and complete
 * inception/acquisition/close/effect history. held_pidfd and held_proc_directory
 * belong to that SAME still-held W0 lifetime, never PID/name reopening.
 * The supplied finite bindings are exactly live admitted NON-ORIGINAL objects;
 * unknown/additional/missing/substituted slots fail. Original cwd/root/mappings,
 * deferred effects and independent persistence are separate mandatory gates.
 * pidfd_getfd + actual KCMP_FILE equality verifies open-description identity.
 * Every inspection duplicate is genuinely closed; no duplicate closes W0's
 * slot and none may keep its original pipe writer alive for EOF acceptance. */
int lf_fd_census(int held_pidfd, int held_proc_directory,
    const struct lf_fd_binding *bindings, size_t binding_count,
    struct lf_fd_census_record *records, size_t record_capacity,
    struct lf_fd_census_observation *observation);

#endif
