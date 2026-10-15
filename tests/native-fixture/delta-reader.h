#ifndef SERVICE_LASSO_F7_DELTA_READER_H
#define SERVICE_LASSO_F7_DELTA_READER_H
#include <stddef.h>
#include <stdint.h>
#ifdef __cplusplus
extern "C" {
#endif

/*
 * U2 #1753 Git PACK delta instruction decoder (SPEC-010 F7-05). The delta's
 * PACK header size is its inflated instruction-stream length; the result
 * varint here is separately the reconstructed body length. Both sizes,
 * every copy/insert bound and the base length are checked before writing.
 * SOURCE ONLY / UNEXECUTED until different whole U2 review and NEW ROOT.
 */

/** Parsed delta header facts, retained for private capture on any outcome. */
struct f7_delta_header {
  uint64_t source_size;
  uint64_t result_size;
  size_t instructions_offset; /* first opcode byte within the delta stream */
};

/**
 * Decode the two little-endian base-128 size varints. Overflow beyond 64 bits
 * or truncation is F7_INVALID / F7_INCOMPLETE.
 */
int f7_delta_header_read(const uint8_t *delta, size_t length,
  struct f7_delta_header *header);

/**
 * Apply delta to base into output[0..capacity).
 *  - source_size must equal base_length exactly;
 *  - result_size must not exceed capacity (admitted per-object ceiling);
 *  - opcode 0 is reserved and rejected; copies must stay inside base and
 *    inserts inside the delta; output must equal result_size exactly with no
 *    trailing instruction bytes.
 * *produced always reports bytes written before success or rejection.
 */
int f7_delta_apply(const uint8_t *base, size_t base_length,
  const uint8_t *delta, size_t delta_length, uint8_t *output,
  size_t capacity, size_t *produced);

#ifdef __cplusplus
}
#endif
#endif
