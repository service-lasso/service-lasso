#ifndef SERVICE_LASSO_HELD_COPY_LINUX_H
#define SERVICE_LASSO_HELD_COPY_LINUX_H

#include "held-removal-linux.h"

#define LF_COPY_FILE_BYTES (8u * 1024u * 1024u)
#define LF_COPY_CHUNK_BYTES 65536u

enum lf_copy_stage {
  LF_COPY_INPUT,
  LF_COPY_IDENTITY,
  LF_COPY_READ,
  LF_COPY_WRITE,
  LF_COPY_FLUSH,
  LF_COPY_READBACK,
  LF_COPY_FINAL_IDENTITY,
  LF_COPY_COMPLETE
};
struct lf_copy_record {
  enum lf_copy_stage stage;
  uint64_t offset;
  size_t requested_bytes;
  long native_result;
  int native_error;
};
struct lf_copy_observation {
  enum lf_copy_stage stage;
  size_t record_count;
  uint64_t copied_bytes;
  uint64_t verified_bytes;
  int native_error;
  int rejection_error;
  struct stat actual_original;
  struct stat actual_copy;
};

/* Actual S-held regular file, and separately created fresh private copy object.
 * The actual trusted creator owns/binds descriptors, copy parent/name and full
 * original/copy inventory. Continuous original writer exclusion precedes this
 * call. No W0-controlled path/FD or supplied stat creates object authority.
 * copy_binding binds a genuinely new empty regular file with one link, owner,
 * mode0600 and no role access beyond selected S/K custody. Existing nonempty
 * copy rejects; no truncation, ownership repair or overwriting sealed evidence.
 * Supplied scratch buffers/records were reserved before sensitive work; record
 * exhaustion retains the real prefix and fails. Every real read/write/fsync is
 * recorded, including short progress and errno; EINTR is a real failure here.
 * Caller still performs full-tree/manifest/hash/privacy checks and independent
 * K/O ALL-byte custody. Byte equality here never substitutes for those gates.
 * Descriptors remain held on success/failure for real independent readback.
 */
int lf_held_copy_file(const struct lf_removal_binding *original,
    const struct lf_removal_binding *copy_binding,
    unsigned char *original_buffer, unsigned char *copy_buffer,
    size_t buffer_capacity, struct lf_copy_record *, size_t record_capacity,
    struct lf_copy_observation *);

#endif
