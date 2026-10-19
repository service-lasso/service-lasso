#ifndef SERVICE_LASSO_F7_PACK_READER_H
#define SERVICE_LASSO_F7_PACK_READER_H
#include <stddef.h>
#include <stdint.h>
#include "git-sha1.h"
#ifdef __cplusplus
extern "C" {
#endif

/*
 * U2 #1753 original PACK v2 reader (SPEC-010 F7-05, D8 limit scopes).
 * Reads the ORIGINAL channel-1 pack bytes already held in private capture;
 * never re-encodes them. All storage is caller-owned; no allocation.
 * SOURCE ONLY / UNEXECUTED until different whole U2 review and NEW ROOT.
 */

#define F7_PACK_HEADER_SIZE 12u
#define F7_PACK_DEPTH_MAX 64u
#define F7_PACK_OBJECTS_MAX 4100u
#define F7_PACK_SLACK UINT64_C(16777216)

/** Checked per-fetch ceilings derived from admitted expected inventory sum S. */
struct f7_pack_limits {
  uint64_t pack_max;      /* 2*S + 16MiB channel-1 ceiling */
  uint64_t work_max;      /* 65*S + 16MiB inflated payload + delta result work */
  uint64_t object_max;    /* largest admitted expected body length */
  uint32_t object_count;  /* exact distinct expected OID count */
  uint32_t depth_max;     /* <= F7_PACK_DEPTH_MAX */
};

enum f7_pack_entry_state { F7_PACK_SCANNED = 1, F7_PACK_RESOLVED = 2 };

/** One original pack object with provenance and resolved body location. */
struct f7_pack_entry {
  uint64_t offset;            /* object header offset within the pack */
  uint64_t data_offset;       /* first zlib byte (after header/base field) */
  uint64_t compressed_length; /* exact zlib stream bytes consumed */
  uint64_t declared_size;     /* header size: body or delta instruction length */
  uint64_t base_offset;       /* OFS_DELTA absolute base object offset */
  uint8_t base_oid[F7_SHA1_SIZE]; /* REF_DELTA base identity */
  uint8_t oid[F7_SHA1_SIZE];  /* framed SHA1 of the resolved body */
  size_t payload_offset, payload_length; /* inflated payload in arena */
  size_t body_offset, body_length;       /* resolved logical body in arena */
  uint8_t pack_type;          /* original enum f7_git_type from the header */
  uint8_t body_type;          /* commit/tree/blob after resolution */
  uint8_t state;              /* enum f7_pack_entry_state */
  uint8_t depth;              /* 0 for whole objects, base depth + 1 for deltas */
};

/** Caller-owned bump arena for inflated payloads and delta results. */
struct f7_pack_arena {
  uint8_t *bytes;
  size_t capacity;
  size_t used;
};

/** Running checked accounting retained across scan/resolve. */
struct f7_pack_accounting {
  uint64_t work;          /* inflated + reconstructed bytes so far */
  uint32_t declared_count;
  uint32_t scanned_count;
  uint32_t resolved_count;
  uint8_t trailer[F7_SHA1_SIZE];
};

/**
 * Derive ceilings from checked expected-body sum S. Rejects S == 0, count
 * outside 1..F7_PACK_OBJECTS_MAX, object_max > S and any u64 overflow.
 */
int f7_pack_limits_derive(uint64_t expected_sum, uint32_t object_count,
  uint64_t object_max, struct f7_pack_limits *limits);

/**
 * Validate PACK magic, version 2, declared count == limits->object_count,
 * every object header/base field, complete zlib consumption with exact
 * declared inflated length, then exactly one 20-byte SHA1 trailer over all
 * preceding original bytes and no trailing data. Whole objects are hashed;
 * deltas remain F7_PACK_SCANNED for f7_pack_resolve.
 */
int f7_pack_scan(const uint8_t *pack, size_t length,
  const struct f7_pack_limits *limits, struct f7_pack_entry *entries,
  size_t entry_capacity, struct f7_pack_arena *arena,
  struct f7_pack_accounting *accounting);

/**
 * Resolve OFS_DELTA/REF_DELTA objects using ONLY bases in the same pack.
 * External/thin bases, cycles, depth > limits->depth_max, per-object result
 * > object_max, work > work_max and duplicate resolved OIDs are rejected.
 */
int f7_pack_resolve(struct f7_pack_entry *entries,
  const struct f7_pack_limits *limits, struct f7_pack_arena *arena,
  struct f7_pack_accounting *accounting);

/** Locate a resolved entry by identity; returns NULL when absent. */
const struct f7_pack_entry *f7_pack_find(const struct f7_pack_entry *entries,
  uint32_t count, const uint8_t oid[F7_SHA1_SIZE]);

#ifdef __cplusplus
}
#endif
#endif
