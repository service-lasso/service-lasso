#include "git-inflate.h"
#include "protocol.h"
#include <string.h>

/*
 * U2 #1753 SOURCE ONLY / UNEXECUTED. Canonical-Huffman RFC1951 decoder with
 * explicit input/output bounds. Back-references may only address bytes this
 * stream already produced into the caller output (each PACK object is an
 * independent zlib stream). Structure follows the well-known reference
 * decoding order of RFC1951 section 3.2 without any external library.
 */

#define MAXBITS 15
#define MAXLCODES 286
#define MAXDCODES 30
#define MAXCODES (MAXLCODES + MAXDCODES)
#define FIXLCODES 288

/** Bounded bit reader and output cursor for one stream. */
struct inflate_state {
  const uint8_t *in;
  size_t in_length, in_pos;
  uint32_t bitbuf;
  unsigned bitcnt;
  uint8_t *out;
  size_t capacity, out_pos;
};

/** Canonical Huffman table: count per length and symbols ordered by code. */
struct huffman {
  uint16_t count[MAXBITS + 1];
  uint16_t symbol[FIXLCODES];
};

/** Read need (<=16) LSB-first bits. Returns F7_INCOMPLETE on input end. */
static int read_bits(struct inflate_state *s, unsigned need, uint32_t *value) {
  while (s->bitcnt < need) {
    if (s->in_pos >= s->in_length) return F7_INCOMPLETE;
    s->bitbuf |= (uint32_t)s->in[s->in_pos++] << s->bitcnt;
    s->bitcnt += 8u;
  }
  *value = s->bitbuf & ((need == 32u) ? 0xFFFFFFFFu : ((1u << need) - 1u));
  s->bitbuf >>= need;
  s->bitcnt -= need;
  return F7_OK;
}

/** Append one byte, enforcing the admitted output capacity. */
static int put_byte(struct inflate_state *s, uint8_t byte) {
  if (s->out_pos >= s->capacity) return F7_OVERFLOWED;
  s->out[s->out_pos++] = byte;
  return F7_OK;
}

/** RFC1951 3.2.4 stored block: discard partial byte, LEN/NLEN, raw copy. */
static int stored_block(struct inflate_state *s) {
  size_t length;
  s->bitbuf = 0u;
  s->bitcnt = 0u;
  if (s->in_length - s->in_pos < 4u) return F7_INCOMPLETE;
  length = (size_t)s->in[s->in_pos] | ((size_t)s->in[s->in_pos + 1u] << 8);
  if (s->in[s->in_pos + 2u] != (uint8_t)~s->in[s->in_pos] ||
      s->in[s->in_pos + 3u] != (uint8_t)~s->in[s->in_pos + 1u]) return F7_INVALID;
  s->in_pos += 4u;
  if (s->in_length - s->in_pos < length) return F7_INCOMPLETE;
  if (s->capacity - s->out_pos < length) {
    /* Retain the admissible prefix before reporting the size violation. */
    size_t room = s->capacity - s->out_pos;
    if (room != 0u) memcpy(s->out + s->out_pos, s->in + s->in_pos, room);
    s->out_pos += room;
    return F7_OVERFLOWED;
  }
  if (length != 0u) memcpy(s->out + s->out_pos, s->in + s->in_pos, length);
  s->out_pos += length;
  s->in_pos += length;
  return F7_OK;
}

/**
 * Build a canonical table from code lengths. Returns the number of unused
 * codes (0 = complete), or -1 when over-subscribed.
 */
static int construct(struct huffman *h, const uint16_t *length, unsigned n) {
  uint16_t offs[MAXBITS + 1];
  unsigned symbol, len;
  int left = 1;
  memset(h->count, 0, sizeof h->count);
  for (symbol = 0; symbol < n; ++symbol) h->count[length[symbol]]++;
  if (h->count[0] == n) return 0;
  for (len = 1; len <= MAXBITS; ++len) {
    left <<= 1;
    left -= (int)h->count[len];
    if (left < 0) return -1;
  }
  offs[1] = 0;
  for (len = 1; len < MAXBITS; ++len) offs[len + 1] = (uint16_t)(offs[len] + h->count[len]);
  for (symbol = 0; symbol < n; ++symbol)
    if (length[symbol] != 0u) h->symbol[offs[length[symbol]]++] = (uint16_t)symbol;
  return left;
}

/** Decode one symbol bit-by-bit (codes are stored MSB-first). */
static int decode(struct inflate_state *s, const struct huffman *h, unsigned *symbol) {
  int code = 0, first = 0, index = 0;
  unsigned len;
  for (len = 1; len <= MAXBITS; ++len) {
    uint32_t bit;
    int count, rc = read_bits(s, 1u, &bit);
    if (rc != F7_OK) return rc;
    code |= (int)bit;
    count = (int)h->count[len];
    if (code - count < first) {
      *symbol = h->symbol[index + (code - first)];
      return F7_OK;
    }
    index += count;
    first += count;
    first <<= 1;
    code <<= 1;
  }
  return F7_INVALID;
}

static const uint16_t length_base[29] = {
  3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31,
  35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258 };
static const uint16_t length_extra[29] = {
  0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2,
  3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0 };
static const uint16_t dist_base[30] = {
  1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193,
  257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145,
  8193, 12289, 16385, 24577 };
static const uint16_t dist_extra[30] = {
  0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6,
  7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13 };

/** Decode literal/length + distance symbols until end-of-block (256). */
static int codes(struct inflate_state *s, const struct huffman *lencode,
    const struct huffman *distcode) {
  for (;;) {
    unsigned symbol;
    int rc = decode(s, lencode, &symbol);
    if (rc != F7_OK) return rc;
    if (symbol < 256u) {
      rc = put_byte(s, (uint8_t)symbol);
      if (rc != F7_OK) return rc;
    } else if (symbol == 256u) {
      return F7_OK;
    } else {
      uint32_t extra;
      size_t length, distance, i;
      symbol -= 257u;
      if (symbol >= 29u) return F7_INVALID;
      rc = read_bits(s, length_extra[symbol], &extra);
      if (rc != F7_OK) return rc;
      length = (size_t)length_base[symbol] + extra;
      rc = decode(s, distcode, &symbol);
      if (rc != F7_OK) return rc;
      if (symbol >= 30u) return F7_INVALID;
      rc = read_bits(s, dist_extra[symbol], &extra);
      if (rc != F7_OK) return rc;
      distance = (size_t)dist_base[symbol] + extra;
      /* No preset dictionary: distance must stay within this stream's output. */
      if (distance > s->out_pos) return F7_INVALID;
      for (i = 0; i < length; ++i) {
        rc = put_byte(s, s->out[s->out_pos - distance]);
        if (rc != F7_OK) return rc;
      }
    }
  }
}

/** RFC1951 3.2.6 fixed Huffman block. */
static int fixed_block(struct inflate_state *s) {
  struct huffman lencode, distcode;
  uint16_t lengths[FIXLCODES];
  unsigned symbol;
  for (symbol = 0; symbol < 144u; ++symbol) lengths[symbol] = 8u;
  for (; symbol < 256u; ++symbol) lengths[symbol] = 9u;
  for (; symbol < 280u; ++symbol) lengths[symbol] = 7u;
  for (; symbol < FIXLCODES; ++symbol) lengths[symbol] = 8u;
  (void)construct(&lencode, lengths, FIXLCODES);
  for (symbol = 0; symbol < MAXDCODES; ++symbol) lengths[symbol] = 5u;
  (void)construct(&distcode, lengths, MAXDCODES);
  return codes(s, &lencode, &distcode);
}

/** RFC1951 3.2.7 dynamic Huffman block with complete-code validation. */
static int dynamic_block(struct inflate_state *s) {
  static const uint8_t order[19] = {
    16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15 };
  struct huffman lencode, distcode;
  uint16_t lengths[MAXCODES];
  uint32_t value;
  unsigned nlen, ndist, ncode, index;
  int rc, err;
  if ((rc = read_bits(s, 5u, &value)) != F7_OK) return rc;
  nlen = value + 257u;
  if ((rc = read_bits(s, 5u, &value)) != F7_OK) return rc;
  ndist = value + 1u;
  if ((rc = read_bits(s, 4u, &value)) != F7_OK) return rc;
  ncode = value + 4u;
  if (nlen > MAXLCODES || ndist > MAXDCODES) return F7_INVALID;
  for (index = 0; index < ncode; ++index) {
    if ((rc = read_bits(s, 3u, &value)) != F7_OK) return rc;
    lengths[order[index]] = (uint16_t)value;
  }
  for (; index < 19u; ++index) lengths[order[index]] = 0u;
  /* Code-length code must be complete. */
  if (construct(&lencode, lengths, 19u) != 0) return F7_INVALID;
  index = 0;
  while (index < nlen + ndist) {
    unsigned symbol, len = 0u, repeat;
    if ((rc = decode(s, &lencode, &symbol)) != F7_OK) return rc;
    if (symbol < 16u) {
      lengths[index++] = (uint16_t)symbol;
      continue;
    }
    if (symbol == 16u) {
      if (index == 0u) return F7_INVALID;
      len = lengths[index - 1u];
      if ((rc = read_bits(s, 2u, &value)) != F7_OK) return rc;
      repeat = 3u + value;
    } else if (symbol == 17u) {
      if ((rc = read_bits(s, 3u, &value)) != F7_OK) return rc;
      repeat = 3u + value;
    } else {
      if ((rc = read_bits(s, 7u, &value)) != F7_OK) return rc;
      repeat = 11u + value;
    }
    if (index + repeat > nlen + ndist) return F7_INVALID;
    while (repeat-- != 0u) lengths[index++] = (uint16_t)len;
  }
  /* End-of-block code 256 must be present. */
  if (lengths[256] == 0u) return F7_INVALID;
  err = construct(&lencode, lengths, nlen);
  if (err < 0 || (err > 0 && nlen != (unsigned)lencode.count[0] + lencode.count[1]))
    return F7_INVALID;
  err = construct(&distcode, lengths + nlen, ndist);
  if (err < 0 || (err > 0 && ndist != (unsigned)distcode.count[0] + distcode.count[1]))
    return F7_INVALID;
  return codes(s, &lencode, &distcode);
}

uint32_t f7_adler32(uint32_t adler, const uint8_t *data, size_t length) {
  uint32_t a = adler & 0xFFFFu, b = adler >> 16;
  size_t i;
  if (data == NULL) return adler;
  for (i = 0; i < length; ++i) {
    a = (a + data[i]) % 65521u;
    b = (b + a) % 65521u;
  }
  return (b << 16) | a;
}

int f7_zlib_inflate(const uint8_t *in, size_t in_length, uint8_t *output,
    size_t capacity, struct f7_inflate_result *result) {
  struct inflate_state s;
  uint32_t last, type, expected;
  int rc;
  if (result == NULL) return F7_INVALID;
  memset(result, 0, sizeof *result);
  if (in == NULL || (output == NULL && capacity != 0u)) return F7_INVALID;
  if (in_length < 2u) return F7_INCOMPLETE;
  /* RFC1950: CM=8 deflate, CINFO<=7, FCHECK multiple of 31, no FDICT. */
  if ((in[0] & 0x0Fu) != 8u || (in[0] >> 4) > 7u ||
      (((unsigned)in[0] << 8) | in[1]) % 31u != 0u || (in[1] & 0x20u) != 0u)
    return F7_INVALID;
  memset(&s, 0, sizeof s);
  s.in = in;
  s.in_length = in_length;
  s.in_pos = 2u;
  s.out = output;
  s.capacity = capacity;
  do {
    if ((rc = read_bits(&s, 1u, &last)) != F7_OK) break;
    if ((rc = read_bits(&s, 2u, &type)) != F7_OK) break;
    if (type == 0u) rc = stored_block(&s);
    else if (type == 1u) rc = fixed_block(&s);
    else if (type == 2u) rc = dynamic_block(&s);
    else rc = F7_INVALID;
  } while (rc == F7_OK && last == 0u);
  result->produced = s.out_pos;
  result->adler = f7_adler32(1u, output, s.out_pos);
  result->consumed = s.in_pos;
  if (rc != F7_OK) return rc;
  /* Remaining bits of the final byte are padding; Adler32 starts byte-aligned. */
  if (s.in_length - s.in_pos < 4u) return F7_INCOMPLETE;
  expected = ((uint32_t)in[s.in_pos] << 24) | ((uint32_t)in[s.in_pos + 1u] << 16) |
    ((uint32_t)in[s.in_pos + 2u] << 8) | (uint32_t)in[s.in_pos + 3u];
  result->consumed = s.in_pos + 4u;
  return expected == result->adler ? F7_OK : F7_INVALID;
}

size_t f7_zlib_stored_size(size_t length) {
  size_t blocks = length == 0u ? 1u : (length / F7_DEFLATE_STORED_MAX) +
    (length % F7_DEFLATE_STORED_MAX != 0u ? 1u : 0u);
  size_t framing;
  if (blocks > (SIZE_MAX - 6u) / 5u) return 0u;
  framing = 6u + 5u * blocks;
  if (length > SIZE_MAX - framing) return 0u;
  return length + framing;
}

int f7_zlib_store(const uint8_t *data, size_t length, uint8_t *out,
    size_t capacity, size_t *written) {
  size_t need = f7_zlib_stored_size(length), pos = 2u, done = 0u;
  uint32_t adler;
  if (written != NULL) *written = 0u;
  if (written == NULL || out == NULL || (data == NULL && length != 0u)) return F7_INVALID;
  if (need == 0u) return F7_OVERFLOWED;
  if (need > capacity) return F7_OVERFLOWED;
  out[0] = 0x78u;
  out[1] = 0x01u;
  do {
    size_t take = length - done;
    if (take > F7_DEFLATE_STORED_MAX) take = F7_DEFLATE_STORED_MAX;
    out[pos++] = (uint8_t)(done + take == length ? 1u : 0u);
    out[pos++] = (uint8_t)(take & 0xFFu);
    out[pos++] = (uint8_t)(take >> 8);
    out[pos++] = (uint8_t)(~take & 0xFFu);
    out[pos++] = (uint8_t)((~take >> 8) & 0xFFu);
    if (take != 0u) memcpy(out + pos, data + done, take);
    pos += take;
    done += take;
  } while (done < length);
  adler = f7_adler32(1u, data, length);
  out[pos++] = (uint8_t)(adler >> 24);
  out[pos++] = (uint8_t)(adler >> 16);
  out[pos++] = (uint8_t)(adler >> 8);
  out[pos++] = (uint8_t)adler;
  *written = pos;
  return pos == need ? F7_OK : F7_INVALID;
}
