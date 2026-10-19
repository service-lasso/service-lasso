#ifndef SERVICE_LASSO_F7_GIT_READER_H
#define SERVICE_LASSO_F7_GIT_READER_H
#include <stddef.h>
#include <stdint.h>
#include "pack-reader.h"
#ifdef __cplusplus
extern "C" {
#endif

/*
 * U2 #1753 G original-body readback verifier (SPEC-010 B2 / F7-05).
 * Consumes a scanned+resolved ORIGINAL pack and the independently admitted
 * expected inventory bound before network use. HTTP/TLS transport, read
 * broker, held persistent capture and admission records are U2 integration
 * and remain ABSENT; this unit never fetches, never falls back to REST/JSON
 * reconstruction and never treats a provider SHA label as a body.
 * SOURCE ONLY / UNEXECUTED until different whole U2 review and NEW ROOT.
 */

#define F7_GIT_SHA256_SIZE 32u

/** One admitted expected original body (bound before fetch). */
struct f7_git_expected {
  uint8_t type;                         /* enum f7_git_type commit/tree/blob */
  uint8_t oid[F7_SHA1_SIZE];
  uint64_t length;
  uint8_t sha256[F7_GIT_SHA256_SIZE];   /* SHA256 over the ORIGINAL body */
  const uint8_t *body;                  /* optional exact original bytes */
};

/** Retained per-object readback facts with original pack provenance. */
struct f7_git_readback_record {
  uint8_t oid[F7_SHA1_SIZE];
  uint8_t type, pack_type, depth, reachable;
  uint64_t length, pack_offset, compressed_length;
  uint8_t body_sha256[F7_GIT_SHA256_SIZE];
  uint8_t framed_sha256[F7_GIT_SHA256_SIZE];
};

/**
 * Sum expected body lengths with checked u64 arithmetic and report the
 * largest; feeds f7_pack_limits_derive. Duplicate expected OIDs reject.
 */
int f7_git_expected_sum(const struct f7_git_expected *expected, uint32_t count,
  uint64_t *sum, uint64_t *largest);

/**
 * Verify the resolved pack equals the admitted inventory exactly:
 *  - object count equals expected count; every expected OID present once
 *    with equal type, length, SHA256 and (when supplied) identical bytes;
 *  - want is a commit with exactly one "tree" header first and NO parent;
 *  - that tree is flat: only "100644 <name>\0<20>" blob entries, names
 *    non-empty, slash-free and strictly ascending; every blob present;
 *  - every pack object is reachable from want (no extras).
 * records[i] is filled for each pack entry i (capacity >= entry count).
 */
int f7_git_readback_verify(const struct f7_pack_entry *entries,
  const struct f7_pack_accounting *accounting, const struct f7_pack_arena *arena,
  const struct f7_git_expected *expected, uint32_t expected_count,
  const uint8_t want[F7_SHA1_SIZE], struct f7_git_readback_record *records,
  size_t record_capacity);

#ifdef __cplusplus
}
#endif
#endif
