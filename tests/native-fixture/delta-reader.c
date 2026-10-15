#include "delta-reader.h"
#include "protocol.h"
#include <string.h>

/* U2 #1753 SOURCE ONLY / UNEXECUTED. Bounded Git delta reconstruction. */

/** Read one little-endian base-128 varint with 64-bit overflow rejection. */
static int read_size(const uint8_t *in, size_t length, size_t *pos, uint64_t *value) {
  uint64_t result = 0u;
  unsigned shift = 0u;
  for (;;) {
    uint8_t byte;
    if (*pos >= length) return F7_INCOMPLETE;
    byte = in[(*pos)++];
    if (shift >= 64u || (shift == 63u && (byte & 0x7Eu) != 0u)) return F7_INVALID;
    result |= (uint64_t)(byte & 0x7Fu) << shift;
    if ((byte & 0x80u) == 0u) break;
    shift += 7u;
  }
  *value = result;
  return F7_OK;
}

int f7_delta_header_read(const uint8_t *delta, size_t length,
    struct f7_delta_header *header) {
  size_t pos = 0u;
  int rc;
  if (header == NULL) return F7_INVALID;
  memset(header, 0, sizeof *header);
  if (delta == NULL) return F7_INVALID;
  rc = read_size(delta, length, &pos, &header->source_size);
  if (rc == F7_OK) rc = read_size(delta, length, &pos, &header->result_size);
  header->instructions_offset = pos;
  return rc;
}

int f7_delta_apply(const uint8_t *base, size_t base_length,
    const uint8_t *delta, size_t delta_length, uint8_t *output,
    size_t capacity, size_t *produced) {
  struct f7_delta_header header;
  size_t pos, out = 0u;
  int rc;
  if (produced != NULL) *produced = 0u;
  if (produced == NULL || (base == NULL && base_length != 0u) || delta == NULL ||
      (output == NULL && capacity != 0u)) return F7_INVALID;
  rc = f7_delta_header_read(delta, delta_length, &header);
  if (rc != F7_OK) return rc;
  if (header.source_size != (uint64_t)base_length) return F7_INVALID;
  if (header.result_size > (uint64_t)capacity) return F7_OVERFLOWED;
  pos = header.instructions_offset;
  while (pos < delta_length) {
    uint8_t op = delta[pos++];
    if ((op & 0x80u) != 0u) {
      uint64_t offset = 0u, size = 0u;
      unsigned bit;
      /* Offset bytes flagged by bits 0..3, size bytes by bits 4..6. */
      for (bit = 0; bit < 4u; ++bit) {
        if ((op & (1u << bit)) == 0u) continue;
        if (pos >= delta_length) { *produced = out; return F7_INCOMPLETE; }
        offset |= (uint64_t)delta[pos++] << (8u * bit);
      }
      for (bit = 0; bit < 3u; ++bit) {
        if ((op & (0x10u << bit)) == 0u) continue;
        if (pos >= delta_length) { *produced = out; return F7_INCOMPLETE; }
        size |= (uint64_t)delta[pos++] << (8u * bit);
      }
      if (size == 0u) size = 0x10000u;
      if (offset > (uint64_t)base_length || size > (uint64_t)base_length - offset ||
          size > header.result_size - (uint64_t)out) {
        *produced = out;
        return F7_INVALID;
      }
      memcpy(output + out, base + (size_t)offset, (size_t)size);
      out += (size_t)size;
    } else if (op != 0u) {
      size_t size = op;
      if (size > delta_length - pos || (uint64_t)size > header.result_size - (uint64_t)out) {
        *produced = out;
        return size > delta_length - pos ? F7_INCOMPLETE : F7_INVALID;
      }
      memcpy(output + out, delta + pos, size);
      pos += size;
      out += size;
    } else {
      /* Opcode 0 is reserved by the Git pack format. */
      *produced = out;
      return F7_INVALID;
    }
  }
  *produced = out;
  return (uint64_t)out == header.result_size ? F7_OK : F7_INVALID;
}
