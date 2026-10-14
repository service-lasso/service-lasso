#include "git-sha1.h"
#include "protocol.h"
#include <string.h>

/* U2 #1753 SOURCE ONLY / UNEXECUTED. FIPS 180-4 SHA1 with explicit bounds. */

/** Rotate a 32-bit word left by n bits (0 < n < 32). */
static uint32_t rol32(uint32_t value, unsigned n) {
  return (value << n) | (value >> (32u - n));
}

/** Read a big-endian 32-bit word. */
static uint32_t be32(const uint8_t *p) {
  return ((uint32_t)p[0] << 24) | ((uint32_t)p[1] << 16) |
    ((uint32_t)p[2] << 8) | (uint32_t)p[3];
}

/** Process exactly one 64-byte block into the running state. */
static void sha1_block(struct f7_sha1 *s, const uint8_t block[64]) {
  uint32_t w[80];
  uint32_t a = s->h[0], b = s->h[1], c = s->h[2], d = s->h[3], e = s->h[4];
  unsigned i;
  for (i = 0; i < 16u; ++i) w[i] = be32(block + 4u * i);
  for (i = 16; i < 80u; ++i)
    w[i] = rol32(w[i - 3u] ^ w[i - 8u] ^ w[i - 14u] ^ w[i - 16u], 1u);
  for (i = 0; i < 80u; ++i) {
    uint32_t f, k, t;
    if (i < 20u) { f = (b & c) | (~b & d); k = 0x5A827999u; }
    else if (i < 40u) { f = b ^ c ^ d; k = 0x6ED9EBA1u; }
    else if (i < 60u) { f = (b & c) | (b & d) | (c & d); k = 0x8F1BBCDCu; }
    else { f = b ^ c ^ d; k = 0xCA62C1D6u; }
    t = rol32(a, 5u) + f + e + k + w[i];
    e = d; d = c; c = rol32(b, 30u); b = a; a = t;
  }
  s->h[0] += a; s->h[1] += b; s->h[2] += c; s->h[3] += d; s->h[4] += e;
}

void f7_sha1_init(struct f7_sha1 *s) {
  if (s == NULL) return;
  memset(s, 0, sizeof *s);
  s->h[0] = 0x67452301u; s->h[1] = 0xEFCDAB89u; s->h[2] = 0x98BADCFEu;
  s->h[3] = 0x10325476u; s->h[4] = 0xC3D2E1F0u;
}

int f7_sha1_update(struct f7_sha1 *s, const uint8_t *data, size_t length) {
  if (s == NULL || s->failed || (data == NULL && length != 0u)) {
    if (s != NULL) s->failed = 1u;
    return F7_INVALID;
  }
  /* Reject before mutation so a failed update never absorbs a partial prefix. */
  if ((uint64_t)length > F7_SHA1_BYTE_MAX - s->length) {
    s->failed = 1u;
    return F7_OVERFLOWED;
  }
  s->length += (uint64_t)length;
  while (length != 0u) {
    size_t take = 64u - s->used;
    if (take > length) take = length;
    memcpy(s->block + s->used, data, take);
    s->used += (uint32_t)take;
    data += take;
    length -= take;
    if (s->used == 64u) { sha1_block(s, s->block); s->used = 0u; }
  }
  return F7_OK;
}

int f7_sha1_final(struct f7_sha1 *s, uint8_t out[F7_SHA1_SIZE]) {
  uint64_t bits;
  unsigned i;
  if (s == NULL || out == NULL || s->failed) return F7_INVALID;
  bits = s->length * 8u;
  s->block[s->used++] = 0x80u;
  if (s->used > 56u) {
    memset(s->block + s->used, 0, 64u - s->used);
    sha1_block(s, s->block);
    s->used = 0u;
  }
  memset(s->block + s->used, 0, 56u - s->used);
  for (i = 0; i < 8u; ++i) s->block[63u - i] = (uint8_t)(bits >> (8u * i));
  sha1_block(s, s->block);
  for (i = 0; i < 5u; ++i) {
    out[4u * i] = (uint8_t)(s->h[i] >> 24);
    out[4u * i + 1u] = (uint8_t)(s->h[i] >> 16);
    out[4u * i + 2u] = (uint8_t)(s->h[i] >> 8);
    out[4u * i + 3u] = (uint8_t)s->h[i];
  }
  /* A finished state cannot be extended or finished twice. */
  s->failed = 1u;
  return F7_OK;
}

/** Return the exact Git type token for a non-delta object type, or NULL. */
static const char *type_name(enum f7_git_type type) {
  switch (type) {
    case F7_GIT_COMMIT: return "commit";
    case F7_GIT_TREE: return "tree";
    case F7_GIT_BLOB: return "blob";
    case F7_GIT_TAG: return "tag";
    default: return NULL;
  }
}

int f7_git_object_header(enum f7_git_type type, uint64_t length,
    uint8_t *out, size_t capacity, size_t *written) {
  const char *name = type_name(type);
  char digits[20];
  size_t name_length, count = 0u, need, i;
  if (written != NULL) *written = 0u;
  if (name == NULL || out == NULL || written == NULL) return F7_INVALID;
  /* Minimal decimal: no leading zeros; zero is the single digit '0'. */
  do { digits[count++] = (char)('0' + (int)(length % 10u)); length /= 10u; }
  while (length != 0u);
  name_length = strlen(name);
  need = name_length + 1u + count + 1u;
  if (need > capacity) return F7_OVERFLOWED;
  memcpy(out, name, name_length);
  out[name_length] = (uint8_t)' ';
  for (i = 0; i < count; ++i) out[name_length + 1u + i] = (uint8_t)digits[count - 1u - i];
  out[need - 1u] = 0u;
  *written = need;
  return F7_OK;
}

int f7_git_object_oid(enum f7_git_type type, const uint8_t *body,
    size_t length, uint8_t out[F7_SHA1_SIZE]) {
  uint8_t header[32];
  size_t header_length = 0u;
  struct f7_sha1 s;
  int rc;
  if (out == NULL || (body == NULL && length != 0u)) return F7_INVALID;
  rc = f7_git_object_header(type, (uint64_t)length, header, sizeof header, &header_length);
  if (rc != F7_OK) return rc;
  f7_sha1_init(&s);
  rc = f7_sha1_update(&s, header, header_length);
  if (rc == F7_OK) rc = f7_sha1_update(&s, body, length);
  if (rc == F7_OK) rc = f7_sha1_final(&s, out);
  return rc;
}

void f7_sha1_hex(char out[F7_SHA1_HEX_SIZE], const uint8_t oid[F7_SHA1_SIZE]) {
  static const char hex[] = "0123456789abcdef";
  unsigned i;
  for (i = 0; i < F7_SHA1_SIZE; ++i) {
    out[2u * i] = hex[oid[i] >> 4];
    out[2u * i + 1u] = hex[oid[i] & 15u];
  }
}

/** Decode one strict lowercase hex digit; returns -1 for anything else. */
static int hex_digit(uint8_t c) {
  if (c >= (uint8_t)'0' && c <= (uint8_t)'9') return c - (uint8_t)'0';
  if (c >= (uint8_t)'a' && c <= (uint8_t)'f') return c - (uint8_t)'a' + 10;
  return -1;
}

int f7_sha1_from_hex(uint8_t out[F7_SHA1_SIZE], const uint8_t *hex, size_t length) {
  uint8_t value[F7_SHA1_SIZE];
  unsigned i;
  if (out == NULL || hex == NULL || length != F7_SHA1_HEX_SIZE) return F7_INVALID;
  for (i = 0; i < F7_SHA1_SIZE; ++i) {
    int hi = hex_digit(hex[2u * i]), lo = hex_digit(hex[2u * i + 1u]);
    if (hi < 0 || lo < 0) return F7_INVALID;
    value[i] = (uint8_t)((hi << 4) | lo);
  }
  /* Output is written only after the whole input validated. */
  memcpy(out, value, sizeof value);
  return F7_OK;
}
