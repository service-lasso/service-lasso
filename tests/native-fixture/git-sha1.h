#ifndef SERVICE_LASSO_F7_GIT_SHA1_H
#define SERVICE_LASSO_F7_GIT_SHA1_H
#include <stddef.h>
#include <stdint.h>
#ifdef __cplusplus
extern "C" {
#endif

/*
 * U2 #1753 source-owned SHA1 (FIPS 180-4) for Git object identities and PACK
 * trailers only. SHA1 is integrity/identity, never signer or custody authority.
 * libsodium (U1) supplies no SHA1; no ambient Git, zlib or OS hash is used.
 * SOURCE ONLY / UNEXECUTED until different whole U2 review and NEW exact ROOT.
 */
#define F7_SHA1_SIZE 20u
#define F7_SHA1_HEX_SIZE 40u
/* SHA1 message length is a 64-bit bit count: at most 2^61-1 bytes. */
#define F7_SHA1_BYTE_MAX ((UINT64_C(1) << 61) - 1u)

/** Incremental SHA1 state; caller-owned, no hidden allocation. */
struct f7_sha1 {
  uint32_t h[5];
  uint64_t length;
  uint8_t block[64];
  uint32_t used;
  uint32_t failed;
};

/** Git object types as encoded in PACK v2 object headers. */
enum f7_git_type {
  F7_GIT_COMMIT = 1, F7_GIT_TREE = 2, F7_GIT_BLOB = 3, F7_GIT_TAG = 4,
  F7_GIT_OFS_DELTA = 6, F7_GIT_REF_DELTA = 7
};

/** Reset state to the FIPS 180-4 initial hash value. */
void f7_sha1_init(struct f7_sha1 *s);
/**
 * Absorb bytes. Returns F7_OK, F7_INVALID for null data with nonzero length, or
 * F7_OVERFLOWED when the total would exceed F7_SHA1_BYTE_MAX (state latches failed).
 */
int f7_sha1_update(struct f7_sha1 *s, const uint8_t *data, size_t length);
/** Finish into out. Returns F7_INVALID if any earlier update failed. */
int f7_sha1_final(struct f7_sha1 *s, uint8_t out[F7_SHA1_SIZE]);
/**
 * Git framed object identity: SHA1("<type> <minimal decimal length>\0" + body).
 * Only commit/tree/blob/tag types are accepted.
 */
int f7_git_object_oid(enum f7_git_type type, const uint8_t *body,
  size_t length, uint8_t out[F7_SHA1_SIZE]);
/**
 * Write the framed header "<type> <decimal>\0" into out. *written receives
 * its length. Returns F7_OVERFLOWED when capacity is insufficient.
 */
int f7_git_object_header(enum f7_git_type type, uint64_t length,
  uint8_t *out, size_t capacity, size_t *written);
/** Lowercase forty-hex encoding of a binary identity. */
void f7_sha1_hex(char out[F7_SHA1_HEX_SIZE], const uint8_t oid[F7_SHA1_SIZE]);
/** Strict lowercase forty-hex decode; uppercase or other bytes are F7_INVALID. */
int f7_sha1_from_hex(uint8_t out[F7_SHA1_SIZE], const uint8_t *hex, size_t length);

#ifdef __cplusplus
}
#endif
#endif
