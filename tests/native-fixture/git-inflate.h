#ifndef SERVICE_LASSO_F7_GIT_INFLATE_H
#define SERVICE_LASSO_F7_GIT_INFLATE_H
#include <stddef.h>
#include <stdint.h>
#ifdef __cplusplus
extern "C" {
#endif

/*
 * U2 #1753 source-owned bounded RFC1950 zlib / RFC1951 deflate decoder and a
 * deterministic stored-block zlib encoder. Replaces an unadmitted zlib input.
 * Caller-owned output only: no allocation, no window outside the output, no
 * preset dictionary. SOURCE ONLY / UNEXECUTED until whole review and NEW ROOT.
 */

/** Largest single stored deflate block payload (RFC1951 LEN is 16-bit). */
#define F7_DEFLATE_STORED_MAX 65535u
/** zlib header (2) + per-block header (5) + Adler32 (4) for one stored block. */
#define F7_ZLIB_STORED_OVERHEAD 11u

/** Outcome facts of one bounded inflate; retained on success and failure. */
struct f7_inflate_result {
  size_t consumed;  /* exact zlib stream bytes consumed, including Adler32 */
  size_t produced;  /* inflated bytes written to the caller output */
  uint32_t adler;   /* Adler32 computed over produced bytes */
};

/** Adler32 continuation (RFC1950); start with adler = 1. */
uint32_t f7_adler32(uint32_t adler, const uint8_t *data, size_t length);

/**
 * Inflate exactly one zlib stream starting at in[0].
 *  - in_length bounds readable input; the stream may end before it and
 *    result->consumed reports its exact end so PACK parsing can continue.
 *  - output receives at most capacity bytes; producing more is F7_OVERFLOWED
 *    (admitted per-object size exceeded) with the produced prefix retained.
 *  - truncated input is F7_INCOMPLETE; malformed header/blocks/codes/
 *    distances/Adler32 are F7_INVALID.
 */
int f7_zlib_inflate(const uint8_t *in, size_t in_length, uint8_t *output,
  size_t capacity, struct f7_inflate_result *result);

/** Exact stored-zlib size for length bytes, or 0 on size_t overflow. */
size_t f7_zlib_stored_size(size_t length);

/**
 * Encode data as one deterministic zlib stream of stored blocks:
 * CMF 0x78, FLG 0x01, ceil(length/65535) stored blocks (one empty final block
 * when length is zero), then big-endian Adler32. *written receives the size.
 */
int f7_zlib_store(const uint8_t *data, size_t length, uint8_t *out,
  size_t capacity, size_t *written);

#ifdef __cplusplus
}
#endif
#endif
