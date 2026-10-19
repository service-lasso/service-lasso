#ifndef SERVICE_LASSO_F7_SEED_OBJECTS_H
#define SERVICE_LASSO_F7_SEED_OBJECTS_H
#include <stddef.h>
#include <stdint.h>
#include "git-sha1.h"
#ifdef __cplusplus
extern "C" {
#endif

/*
 * U2 #1753 exact SPEC-010 B1 bootstrap seed and its precise push pack.
 * Bodies are constructed from the selected text, never parameterized, and
 * must reproduce the pinned OIDs below. The pack encoding selected here is
 * PACK v2, objects commit/tree/blob in that order, each a single stored
 * deflate block (deterministic, no zlib input). Pack admission still needs
 * DIFFERENT whole review and NEW ROOT; no provisioning or push is authorized.
 * SOURCE ONLY / UNEXECUTED.
 */

#define F7_SEED_BLOB_SIZE 30u
#define F7_SEED_TREE_SIZE 41u
#define F7_SEED_COMMIT_SIZE 168u
#define F7_SEED_OBJECT_COUNT 3u
/* 12 header + (181 + 54 + 43) objects + 20 trailer; see f7_seed_pack_write. */
#define F7_SEED_PACK_SIZE 310u
#define F7_SHA256_SIZE 32u

/* Pinned SPEC-010 identities (independently re-derived 2026-10-13). */
#define F7_SEED_BLOB_OID "eb9948ee8c6f71914854d43bf23ff58f1a09893b"
#define F7_SEED_TREE_OID "eb5775d1a323d243f4102a0f3e72f7330104245f"
#define F7_SEED_COMMIT_OID "de155770084ea0e037058ebbdb6313f21b3cddc9"
#define F7_SEED_BLOB_SHA256 "c5922ad8f47a1c9f9bb9cdf07e3e3bb3f5c644e4cce19c7287e2cefdb634fc18"
#define F7_SEED_TREE_SHA256 "6e70d96667e9a3a47c6524b334047b1dcaea4c7fcbf5e7bccc0a4532a2a5a441"
#define F7_SEED_COMMIT_SHA256 "dad95587e01c9218e4afd71e0d9631758af4b28c5ce6ac03ba390fdbd8d006d1"
/* Selected exact seed pack (independent derivation 2026-10-13, not admitted). */
#define F7_SEED_PACK_SHA256 "d8f6eff5cc59fc0a806bd7b53dca7d8848fe4c6fbb1ecdff3924c8ddfdb8965f"
#define F7_SEED_PACK_TRAILER "4a7455b5439f0626c0f39539a3146f36724b2825"

/** Exact seed originals and their framed SHA1 identities. */
struct f7_seed {
  uint8_t blob[F7_SEED_BLOB_SIZE];
  uint8_t tree[F7_SEED_TREE_SIZE];
  uint8_t commit[F7_SEED_COMMIT_SIZE];
  uint8_t blob_oid[F7_SHA1_SIZE];
  uint8_t tree_oid[F7_SHA1_SIZE];
  uint8_t commit_oid[F7_SHA1_SIZE];
};

/**
 * Construct the three bodies from SPEC-010 B1 text and verify all three OIDs
 * equal the pinned constants. Mismatch is F7_IDENTITY_MISMATCH.
 */
int f7_seed_build(struct f7_seed *seed);

/**
 * Encode a PACK v2 object header (type bits 4..6, base-128 size) into out.
 * Only commit/tree/blob are accepted for writing.
 */
int f7_pack_object_header(enum f7_git_type type, uint64_t size, uint8_t *out,
  size_t capacity, size_t *written);

/**
 * Write the exact F7_SEED_PACK_SIZE-byte seed pack from a built seed,
 * including its SHA1 trailer over all preceding bytes.
 */
int f7_seed_pack_write(const struct f7_seed *seed, uint8_t *out,
  size_t capacity, size_t *written);

#ifdef __cplusplus
}
#endif
#endif
