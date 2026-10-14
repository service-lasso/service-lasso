/* U2 #1753 source-authored transport codec regression. UNEXECUTED: different
   whole U2 source review and NEW exact actual-input ROOT are prerequisites;
   this file is not a native receipt, provider readback or custody proof.
   Requires assert enabled (no NDEBUG). Vectors: SPEC-010 seed text; zlib
   streams independently produced on 2026-10-13 for review cross-checking. */
#include "protocol.h"
#include "git-sha1.h"
#include "git-inflate.h"
#include "delta-reader.h"
#include "pack-reader.h"
#include "git-protocol.h"
#include "seed-objects.h"
#include "git-reader.h"
#include <sodium.h>
#include <assert.h>
#include <string.h>
#include <stdint.h>

/** Decode a pinned lowercase hex constant of n bytes. */
static void unhex(uint8_t *out, const char *hex, size_t n) {
  size_t i;
  for (i = 0; i < n; ++i) {
    unsigned hi = (unsigned)(hex[2 * i] <= '9' ? hex[2 * i] - '0' : hex[2 * i] - 'a' + 10);
    unsigned lo = (unsigned)(hex[2 * i + 1] <= '9' ? hex[2 * i + 1] - '0' : hex[2 * i + 1] - 'a' + 10);
    out[i] = (uint8_t)((hi << 4) | lo);
  }
}

/** SHA1 known-answer vectors including the 56-byte padding boundary. */
static void sha1_vectors(void) {
  static const char *inputs[3] = { "", "abc",
    "abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq" };
  static const char *digests[3] = { "da39a3ee5e6b4b0d3255bfef95601890afd80709",
    "a9993e364706816aba3e25717850c26c9cd0d89d", "84983e441c3bd26ebaae4aa1f95129e5e54670f1" };
  unsigned i;
  for (i = 0; i < 3u; ++i) {
    struct f7_sha1 s;
    uint8_t out[F7_SHA1_SIZE], want[F7_SHA1_SIZE];
    f7_sha1_init(&s);
    assert(f7_sha1_update(&s, (const uint8_t *)inputs[i], strlen(inputs[i])) == F7_OK);
    assert(f7_sha1_final(&s, out) == F7_OK);
    unhex(want, digests[i], F7_SHA1_SIZE);
    assert(memcmp(out, want, F7_SHA1_SIZE) == 0);
    /* A finished state cannot be extended or reused. */
    assert(f7_sha1_update(&s, (const uint8_t *)"x", 1u) == F7_INVALID);
  }
  {
    uint8_t oid[F7_SHA1_SIZE];
    assert(f7_sha1_from_hex(oid, (const uint8_t *)"EB9948EE8C6F71914854D43BF23FF58F1A09893B", 40u) == F7_INVALID);
    assert(f7_git_object_oid(F7_GIT_OFS_DELTA, (const uint8_t *)"x", 1u, oid) == F7_INVALID);
  }
}

static const uint8_t fixed_vector[53] = {
  0x78,0x01,0x2b,0x4e,0x2d,0x2a,0xcb,0x4c,0x4e,0xd5,0xcd,0x49,0x2c,0x2e,0xce,0x57,
  0x70,0x33,0x57,0x28,0x29,0x4a,0xcc,0x2b,0x2e,0xc8,0x2f,0x2a,0x51,0x28,0x4a,0x4d,
  0x2f,0x4a,0x2d,0x2e,0xce,0xcc,0xcf,0x53,0x28,0x1e,0xd2,0xaa,0x52,0xf3,0x52,0xb8,
  0x00,0x13,0x94,0x57,0xc4 };
static const uint8_t dynamic_vector[82] = {
  0x78,0xda,0xed,0x8d,0xc1,0x09,0xc0,0x30,0x0c,0x03,0x67,0x35,0xf8,0x20,0x85,0xd2,
  0x80,0xac,0xec,0x5f,0xa7,0x53,0xf4,0x11,0x83,0x41,0x08,0x71,0x07,0x04,0x52,0x32,
  0xc2,0x33,0xcd,0xc2,0x0a,0xbb,0x50,0x8d,0x15,0xe4,0xcd,0x45,0x97,0x4f,0x7f,0xa7,
  0x3b,0x89,0x35,0x4a,0x94,0x1d,0xfa,0xd6,0x39,0x1d,0x83,0x94,0x9a,0xd3,0x57,0x66,
  0x13,0x9a,0xaa,0x9d,0x6a,0x77,0x47,0x70,0x04,0x47,0xf0,0x4f,0xc1,0x0b,0x46,0xaa,
  0xaa,0x2a };

/** Fixed, dynamic and stored zlib streams plus closed failure cases. */
static void inflate_vectors(void) {
  static const char alphabet[] = "eeeeeettaaoinshrdlu";
  uint8_t text[1024], out[1100], stream[1200], bad[82];
  struct f7_inflate_result r;
  size_t i, n = 0u;
  /* Fixed Huffman: "service-lasso F7 transport regression " x6 + "end\n". */
  for (i = 0; i < 6u; ++i) { memcpy(text + n, "service-lasso F7 transport regression ", 38u); n += 38u; }
  memcpy(text + n, "end\n", 4u); n += 4u;
  assert(f7_zlib_inflate(fixed_vector, sizeof fixed_vector, out, n, &r) == F7_OK);
  assert(r.produced == n && r.consumed == sizeof fixed_vector && memcmp(out, text, n) == 0);
  /* Output beyond the admitted size retains the prefix and rejects. */
  assert(f7_zlib_inflate(fixed_vector, sizeof fixed_vector, out, n - 1u, &r) == F7_OVERFLOWED);
  assert(r.produced == n - 1u);
  /* Dynamic Huffman over a procedurally generated 1024-byte text. */
  for (i = 0; i < 1024u; ++i) text[i] = (uint8_t)alphabet[((i * i * 31u + i * 7u) % 97u) % 19u];
  assert(f7_zlib_inflate(dynamic_vector, sizeof dynamic_vector, out, 1024u, &r) == F7_OK);
  assert(r.produced == 1024u && r.consumed == sizeof dynamic_vector && memcmp(out, text, 1024u) == 0);
  /* Consumption stops at the stream end even when more input follows. */
  memcpy(stream, dynamic_vector, sizeof dynamic_vector);
  stream[sizeof dynamic_vector] = 0xEEu;
  assert(f7_zlib_inflate(stream, sizeof dynamic_vector + 1u, out, 1024u, &r) == F7_OK);
  assert(r.consumed == sizeof dynamic_vector);
  /* Corrupted Adler32, truncation, FDICT and wrong method reject. */
  memcpy(bad, dynamic_vector, sizeof bad);
  bad[81] ^= 1u;
  assert(f7_zlib_inflate(bad, sizeof bad, out, 1024u, &r) == F7_INVALID);
  assert(f7_zlib_inflate(dynamic_vector, 40u, out, 1024u, &r) == F7_INCOMPLETE);
  assert(f7_zlib_inflate((const uint8_t *)"\x78\xbb", 2u, out, 1u, &r) == F7_INVALID);
  assert(f7_zlib_inflate((const uint8_t *)"\x79\x01", 2u, out, 1u, &r) == F7_INVALID);
  /* Stored writer round trip, including the empty stream and a multi-block body. */
  assert(f7_zlib_store(text, 0u, stream, sizeof stream, &n) == F7_OK && n == 11u);
  assert(f7_zlib_inflate(stream, n, out, 0u, &r) == F7_OK && r.produced == 0u);
  assert(f7_zlib_store(text, 1024u, stream, sizeof stream, &n) == F7_OK && n == 1024u + 11u);
  assert(f7_zlib_inflate(stream, n, out, 1024u, &r) == F7_OK && memcmp(out, text, 1024u) == 0);
  stream[4] ^= 1u; /* NLEN no longer complements LEN */
  assert(f7_zlib_inflate(stream, n, out, 1024u, &r) == F7_INVALID);
  assert(f7_zlib_stored_size(65535u) == 65535u + 11u && f7_zlib_stored_size(65536u) == 65536u + 16u);
}

/** Delta instruction bounds: copy/insert/opcode0/source/result checks. */
static void delta_vectors(void) {
  static const uint8_t base[] = "hello world!";
  static const uint8_t delta[] = { 0x0C, 0x12, 0x90, 0x06, 0x05, 't', 'h', 'e', 'r', 'e',
    0x91, 0x05, 0x07 };
  uint8_t out[32], d[sizeof delta];
  size_t produced;
  struct f7_delta_header h;
  assert(f7_delta_header_read(delta, sizeof delta, &h) == F7_OK);
  assert(h.source_size == 12u && h.result_size == 18u && h.instructions_offset == 2u);
  assert(f7_delta_apply(base, 12u, delta, sizeof delta, out, sizeof out, &produced) == F7_OK);
  assert(produced == 18u && memcmp(out, "hello there world!", 18u) == 0);
  assert(f7_delta_apply(base, 11u, delta, sizeof delta, out, sizeof out, &produced) == F7_INVALID);
  assert(f7_delta_apply(base, 12u, delta, sizeof delta, out, 17u, &produced) == F7_OVERFLOWED);
  memcpy(d, delta, sizeof d); d[12] = 0x08; /* copy 5+8 beyond base */
  assert(f7_delta_apply(base, 12u, d, sizeof d, out, sizeof out, &produced) == F7_INVALID);
  memcpy(d, delta, sizeof d); d[4] = 0x00; /* reserved opcode */
  assert(f7_delta_apply(base, 12u, d, sizeof d, out, sizeof out, &produced) == F7_INVALID && produced == 6u);
  memcpy(d, delta, sizeof d); d[1] = 0x13; /* result shortfall */
  assert(f7_delta_apply(base, 12u, d, sizeof d, out, sizeof out, &produced) == F7_INVALID);
  assert(f7_delta_apply(base, 12u, delta, 8u, out, sizeof out, &produced) == F7_INCOMPLETE);
  {
    static const uint8_t overflow[] = { 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0x7F, 0x00 };
    assert(f7_delta_header_read(overflow, sizeof overflow, &h) == F7_INVALID);
  }
}

/** Test-only pack builder state. */
struct builder { uint8_t bytes[4096]; size_t pos; };

static void raw_header(struct builder *b, unsigned type, uint64_t size) {
  uint8_t c = (uint8_t)((type << 4) | (size & 15u));
  size >>= 4;
  while (size != 0u) { b->bytes[b->pos++] = (uint8_t)(c | 0x80u); c = (uint8_t)(size & 0x7Fu); size >>= 7; }
  b->bytes[b->pos++] = c;
}

static void pack_begin(struct builder *b, uint32_t count) {
  memcpy(b->bytes, "PACK\0\0\0\2", 8u);
  b->bytes[8] = (uint8_t)(count >> 24); b->bytes[9] = (uint8_t)(count >> 16);
  b->bytes[10] = (uint8_t)(count >> 8); b->bytes[11] = (uint8_t)count;
  b->pos = 12u;
}

static void zbody(struct builder *b, const uint8_t *data, size_t n) {
  size_t w;
  assert(f7_zlib_store(data, n, b->bytes + b->pos, sizeof b->bytes - b->pos, &w) == F7_OK);
  b->pos += w;
}

static size_t whole(struct builder *b, unsigned type, const uint8_t *body, size_t n) {
  size_t at = b->pos;
  raw_header(b, type, n);
  zbody(b, body, n);
  return at;
}

static size_t ofs(struct builder *b, const uint8_t *delta, size_t n, size_t base) {
  uint8_t enc[16];
  size_t at = b->pos, i = sizeof enc - 1u, distance = at - base;
  raw_header(b, F7_GIT_OFS_DELTA, n);
  enc[i] = (uint8_t)(distance & 0x7Fu);
  while ((distance >>= 7) != 0u) enc[--i] = (uint8_t)(0x80u | (--distance & 0x7Fu));
  memcpy(b->bytes + b->pos, enc + i, sizeof enc - i);
  b->pos += sizeof enc - i;
  zbody(b, delta, n);
  return at;
}

static void ref(struct builder *b, const uint8_t *delta, size_t n, const uint8_t oid[F7_SHA1_SIZE]) {
  raw_header(b, F7_GIT_REF_DELTA, n);
  memcpy(b->bytes + b->pos, oid, F7_SHA1_SIZE);
  b->pos += F7_SHA1_SIZE;
  zbody(b, delta, n);
}

static void pack_end(struct builder *b) {
  struct f7_sha1 s;
  f7_sha1_init(&s);
  assert(f7_sha1_update(&s, b->bytes, b->pos) == F7_OK);
  assert(f7_sha1_final(&s, b->bytes + b->pos) == F7_OK);
  b->pos += F7_SHA1_SIZE;
}

static struct f7_pack_entry entries[80];
static uint8_t arena_bytes[16384];

/** Scan + resolve a built pack with exact limits; returns the first failure. */
static int read_pack(const struct builder *b, uint32_t count, uint64_t sum, uint64_t max,
    struct f7_pack_arena *arena, struct f7_pack_accounting *acc) {
  struct f7_pack_limits limits;
  int rc;
  assert(f7_pack_limits_derive(sum, count, max, &limits) == F7_OK);
  arena->bytes = arena_bytes; arena->capacity = sizeof arena_bytes; arena->used = 0u;
  rc = f7_pack_scan(b->bytes, b->pos, &limits, entries, 80u, arena, acc);
  if (rc != F7_OK) return rc;
  return f7_pack_resolve(entries, &limits, arena, acc);
}

/** OFS/REF same-pack deltas, depth limit, thin/external and misaligned bases. */
static void pack_vectors(void) {
  static const uint8_t base[] = "hello world!";
  static const uint8_t delta[] = { 0x0C, 0x12, 0x90, 0x06, 0x05, 't', 'h', 'e', 'r', 'e',
    0x91, 0x05, 0x07 };
  struct builder b;
  struct f7_pack_arena arena;
  struct f7_pack_accounting acc;
  uint8_t oid[F7_SHA1_SIZE], foreign[F7_SHA1_SIZE];
  size_t b0, i;
  /* OFS_DELTA against an earlier same-pack base. */
  pack_begin(&b, 2u);
  b0 = whole(&b, F7_GIT_BLOB, base, 12u);
  (void)ofs(&b, delta, sizeof delta, b0);
  pack_end(&b);
  assert(read_pack(&b, 2u, 30u, 18u, &arena, &acc) == F7_OK);
  assert(f7_git_object_oid(F7_GIT_BLOB, (const uint8_t *)"hello there world!", 18u, oid) == F7_OK);
  {
    const struct f7_pack_entry *e = f7_pack_find(entries, 2u, oid);
    assert(e != NULL && e->depth == 1u && e->pack_type == F7_GIT_OFS_DELTA && e->body_length == 18u);
  }
  /* Declared count must equal admitted distinct count. */
  assert(read_pack(&b, 3u, 30u, 18u, &arena, &acc) == F7_INVALID);
  /* Trailer corruption and trailing bytes reject. */
  b.bytes[b.pos - 1u] ^= 1u;
  assert(read_pack(&b, 2u, 30u, 18u, &arena, &acc) == F7_INVALID);
  b.bytes[b.pos - 1u] ^= 1u;
  b.bytes[b.pos++] = 0u;
  assert(read_pack(&b, 2u, 30u, 18u, &arena, &acc) == F7_INVALID);
  /* Result above the admitted per-object maximum rejects. */
  b.pos--;
  assert(read_pack(&b, 2u, 30u, 17u, &arena, &acc) == F7_OVERFLOWED);
  /* REF_DELTA to an in-pack base resolves; an external (thin) base rejects. */
  assert(f7_git_object_oid(F7_GIT_BLOB, base, 12u, oid) == F7_OK);
  pack_begin(&b, 2u);
  (void)whole(&b, F7_GIT_BLOB, base, 12u);
  ref(&b, delta, sizeof delta, oid);
  pack_end(&b);
  assert(read_pack(&b, 2u, 30u, 18u, &arena, &acc) == F7_OK);
  memset(foreign, 0x11, sizeof foreign);
  pack_begin(&b, 2u);
  (void)whole(&b, F7_GIT_BLOB, base, 12u);
  ref(&b, delta, sizeof delta, foreign);
  pack_end(&b);
  assert(read_pack(&b, 2u, 30u, 18u, &arena, &acc) == F7_INVALID);
  /* OFS_DELTA naming an offset that is not an object start rejects. */
  pack_begin(&b, 2u);
  b0 = whole(&b, F7_GIT_BLOB, base, 12u);
  (void)ofs(&b, delta, sizeof delta, b0 + 1u);
  pack_end(&b);
  assert(read_pack(&b, 2u, 30u, 18u, &arena, &acc) == F7_INVALID);
  /* Depth: 64 chained deltas accepted, 65 rejected. */
  for (i = 64u; i <= 65u; ++i) {
    size_t prev, k;
    pack_begin(&b, (uint32_t)(i + 1u));
    prev = whole(&b, F7_GIT_BLOB, base, 12u);
    for (k = 1u; k <= i; ++k) {
      uint8_t step[6] = { 0x0C, 0x0C, 0x90, 0x0B, 0x01, 0 };
      /* 0x80+k never equals the base's final '!' byte, so no level duplicates. */
      step[5] = (uint8_t)(0x80u + k);
      prev = ofs(&b, step, sizeof step, prev);
    }
    pack_end(&b);
    assert(read_pack(&b, (uint32_t)(i + 1u), 12u * (i + 1u), 12u, &arena, &acc) ==
      (i == 64u ? F7_OK : F7_INVALID));
  }
  /* Duplicate objects reject even when every byte is otherwise valid. */
  pack_begin(&b, 2u);
  (void)whole(&b, F7_GIT_BLOB, base, 12u);
  (void)whole(&b, F7_GIT_BLOB, base, 12u);
  pack_end(&b);
  assert(read_pack(&b, 2u, 24u, 12u, &arena, &acc) == F7_INVALID);
  /* Tags are outside every F7 inventory. */
  pack_begin(&b, 1u);
  (void)whole(&b, F7_GIT_TAG, base, 12u);
  pack_end(&b);
  assert(read_pack(&b, 1u, 12u, 12u, &arena, &acc) == F7_INVALID);
}

/** Expected inventory entry from body bytes. */
static void expect(struct f7_git_expected *x, uint8_t type, const uint8_t *body, size_t n) {
  memset(x, 0, sizeof *x);
  x->type = type;
  x->length = n;
  x->body = body;
  assert(f7_git_object_oid((enum f7_git_type)type, body, n, x->oid) == F7_OK);
  assert(crypto_hash_sha256(x->sha256, body, n) == 0);
}

/** Exact seed construction, selected pack bytes and complete readback. */
static void seed_vectors(void) {
  static struct f7_git_readback_record records[8];
  struct f7_seed seed;
  struct f7_git_expected expected[4];
  struct f7_pack_arena arena;
  struct f7_pack_accounting acc;
  struct builder b;
  uint8_t digest[32], pinned[32], extra_blob[] = "extra\n";
  uint64_t sum, max;
  size_t written;
  assert(f7_seed_build(&seed) == F7_OK);
  expect(&expected[0], F7_GIT_COMMIT, seed.commit, F7_SEED_COMMIT_SIZE);
  expect(&expected[1], F7_GIT_TREE, seed.tree, F7_SEED_TREE_SIZE);
  expect(&expected[2], F7_GIT_BLOB, seed.blob, F7_SEED_BLOB_SIZE);
  unhex(pinned, F7_SEED_COMMIT_SHA256, 32u); assert(memcmp(pinned, expected[0].sha256, 32u) == 0);
  unhex(pinned, F7_SEED_TREE_SHA256, 32u); assert(memcmp(pinned, expected[1].sha256, 32u) == 0);
  unhex(pinned, F7_SEED_BLOB_SHA256, 32u); assert(memcmp(pinned, expected[2].sha256, 32u) == 0);
  assert(f7_seed_pack_write(&seed, b.bytes, sizeof b.bytes, &written) == F7_OK);
  assert(written == F7_SEED_PACK_SIZE);
  b.pos = written;
  assert(crypto_hash_sha256(digest, b.bytes, written) == 0);
  unhex(pinned, F7_SEED_PACK_SHA256, 32u);
  assert(memcmp(pinned, digest, 32u) == 0);
  unhex(pinned, F7_SEED_PACK_TRAILER, 20u);
  assert(memcmp(pinned, b.bytes + written - 20u, 20u) == 0);
  assert(f7_seed_pack_write(&seed, b.bytes, F7_SEED_PACK_SIZE - 1u, &written) == F7_OVERFLOWED);
  /* Complete readback of the selected seed pack against exactly three originals. */
  assert(f7_git_expected_sum(expected, 3u, &sum, &max) == F7_OK && sum == 239u && max == 168u);
  b.pos = F7_SEED_PACK_SIZE;
  assert(f7_seed_pack_write(&seed, b.bytes, sizeof b.bytes, &written) == F7_OK);
  assert(read_pack(&b, 3u, sum, max, &arena, &acc) == F7_OK);
  assert(f7_git_readback_verify(entries, &acc, &arena, expected, 3u, seed.commit_oid, records, 8u) == F7_OK);
  assert(records[0].type == F7_GIT_COMMIT && records[0].reachable && records[0].pack_offset == 12u);
  /* Wrong want, wrong digest and missing originals reject. */
  assert(f7_git_readback_verify(entries, &acc, &arena, expected, 3u, seed.tree_oid, records, 8u) == F7_INVALID);
  expected[2].sha256[0] ^= 1u;
  assert(f7_git_readback_verify(entries, &acc, &arena, expected, 3u, seed.commit_oid, records, 8u) == F7_IDENTITY_MISMATCH);
  expected[2].sha256[0] ^= 1u;
  assert(f7_git_readback_verify(entries, &acc, &arena, expected, 2u, seed.commit_oid, records, 8u) == F7_INVALID);
  /* An extra unreachable object rejects even when admitted in the inventory. */
  pack_begin(&b, 4u);
  (void)whole(&b, F7_GIT_COMMIT, seed.commit, F7_SEED_COMMIT_SIZE);
  (void)whole(&b, F7_GIT_TREE, seed.tree, F7_SEED_TREE_SIZE);
  (void)whole(&b, F7_GIT_BLOB, seed.blob, F7_SEED_BLOB_SIZE);
  (void)whole(&b, F7_GIT_BLOB, extra_blob, 6u);
  pack_end(&b);
  expect(&expected[3], F7_GIT_BLOB, extra_blob, 6u);
  assert(f7_git_expected_sum(expected, 4u, &sum, &max) == F7_OK);
  assert(read_pack(&b, 4u, sum, max, &arena, &acc) == F7_OK);
  assert(f7_git_readback_verify(entries, &acc, &arena, expected, 4u, seed.commit_oid, records, 8u) == F7_INVALID);
  /* A commit with a parent header rejects. */
  {
    uint8_t commit[256];
    size_t n = 0u;
    memcpy(commit, seed.commit, 46u); n = 46u;
    memcpy(commit + n, "parent ", 7u); n += 7u;
    f7_sha1_hex((char *)commit + n, seed.commit_oid); n += 40u;
    commit[n++] = '\n';
    memcpy(commit + n, seed.commit + 46u, F7_SEED_COMMIT_SIZE - 46u); n += F7_SEED_COMMIT_SIZE - 46u;
    pack_begin(&b, 3u);
    (void)whole(&b, F7_GIT_COMMIT, commit, n);
    (void)whole(&b, F7_GIT_TREE, seed.tree, F7_SEED_TREE_SIZE);
    (void)whole(&b, F7_GIT_BLOB, seed.blob, F7_SEED_BLOB_SIZE);
    pack_end(&b);
    expect(&expected[0], F7_GIT_COMMIT, commit, n);
    assert(f7_git_expected_sum(expected, 3u, &sum, &max) == F7_OK);
    assert(read_pack(&b, 3u, sum, max, &arena, &acc) == F7_OK);
    assert(f7_git_readback_verify(entries, &acc, &arena, expected, 3u, expected[0].oid, records, 8u) == F7_INVALID);
  }
}

/** Append one data pkt-line holding text of n bytes. */
static void pkt(uint8_t *out, size_t *pos, const void *text, size_t n) {
  size_t w;
  assert(f7_pkt_encode((const uint8_t *)text, n, out + *pos, 70000u - *pos, &w) == F7_OK);
  *pos += w;
}

static void flush(uint8_t *out, size_t *pos) { memcpy(out + *pos, "0000", 4u); *pos += 4u; }

/** Strict pkt-line, advertisement, request, sideband and report-status codecs. */
static void protocol_vectors(void) {
  static uint8_t buf[70000], packbuf[400], progress[64], error[64], request[512];
  struct f7_advert_ref refs[4];
  struct f7_advert advert;
  struct f7_upload_response response;
  struct f7_report_status status;
  struct f7_seed seed;
  enum f7_pkt_kind kind;
  char hex[40];
  uint8_t line[400], seedpack[F7_SEED_PACK_SIZE];
  size_t pos, off, n, w, len;
  assert(f7_seed_build(&seed) == F7_OK);
  assert(f7_seed_pack_write(&seed, seedpack, sizeof seedpack, &w) == F7_OK);
  f7_sha1_hex(hex, seed.commit_oid);
  /* pkt-line framing. */
  pos = 0u; assert(f7_pkt_next((const uint8_t *)"0000", 4u, &pos, &kind, &off, &n) == F7_OK && kind == F7_PKT_FLUSH);
  pos = 0u; assert(f7_pkt_next((const uint8_t *)"0001", 4u, &pos, &kind, &off, &n) == F7_INVALID);
  pos = 0u; assert(f7_pkt_next((const uint8_t *)"0002", 4u, &pos, &kind, &off, &n) == F7_INVALID);
  pos = 0u; assert(f7_pkt_next((const uint8_t *)"0004", 4u, &pos, &kind, &off, &n) == F7_INVALID);
  pos = 0u; assert(f7_pkt_next((const uint8_t *)"000Aabcdef", 10u, &pos, &kind, &off, &n) == F7_INVALID);
  pos = 0u; assert(f7_pkt_next((const uint8_t *)"fff1", 4u, &pos, &kind, &off, &n) == F7_INVALID);
  pos = 0u; assert(f7_pkt_next((const uint8_t *)"0009ab", 6u, &pos, &kind, &off, &n) == F7_INCOMPLETE && pos == 0u);
  assert(f7_pkt_encode((const uint8_t *)"", 0u, buf, 8u, &w) == F7_INVALID);
  /* Upload-pack advertisement offering both capabilities. */
  len = 0u;
  pkt(buf, &len, "# service=git-upload-pack\n", 26u);
  flush(buf, &len);
  n = 0u;
  memcpy(line, hex, 40u); n = 40u; line[n++] = ' ';
  memcpy(line + n, F7_BOOTSTRAP_REF, F7_BOOTSTRAP_REF_LENGTH); n += F7_BOOTSTRAP_REF_LENGTH;
  line[n++] = 0u;
  memcpy(line + n, "multi_ack side-band-64k ofs-delta agent=git/x\n", 46u); n += 46u;
  pkt(buf, &len, line, n);
  flush(buf, &len);
  assert(f7_advert_parse(buf, len, F7_SERVICE_UPLOAD_PACK, refs, 4u, &advert) == F7_OK);
  assert(advert.ref_count == 1u && advert.side_band_64k && advert.ofs_delta && !advert.empty_repository);
  assert(f7_advert_parse(buf, len, F7_SERVICE_RECEIVE_PACK, refs, 4u, &advert) == F7_INVALID);
  assert(f7_advert_parse(buf, len - 1u, F7_SERVICE_UPLOAD_PACK, refs, 4u, &advert) == F7_INCOMPLETE);
  buf[len] = 'x';
  assert(f7_advert_parse(buf, len + 1u, F7_SERVICE_UPLOAD_PACK, refs, 4u, &advert) == F7_INVALID);
  assert(f7_advert_parse(buf, len, F7_SERVICE_UPLOAD_PACK, refs, 0u, &advert) == F7_OVERFLOWED);
  assert(f7_advert_parse(buf, len, F7_SERVICE_UPLOAD_PACK, refs, 4u, &advert) == F7_OK);
  /* Exact single-want request bytes. */
  assert(f7_upload_request_build(buf, &advert, refs, (const uint8_t *)F7_BOOTSTRAP_REF,
    F7_BOOTSTRAP_REF_LENGTH, seed.commit_oid, request, sizeof request, &w) == F7_OK);
  assert(w == F7_UPLOAD_REQUEST_SIZE);
  assert(memcmp(request, "004awant ", 9u) == 0 && memcmp(request + 9, hex, 40u) == 0);
  assert(memcmp(request + 49, " side-band-64k ofs-delta\n00000009done\n", 38u) == 0);
  assert(f7_upload_request_build(buf, &advert, refs, (const uint8_t *)F7_BOOTSTRAP_REF,
    F7_BOOTSTRAP_REF_LENGTH, seed.tree_oid, request, sizeof request, &w) == F7_IDENTITY_MISMATCH);
  assert(f7_upload_request_build(buf, &advert, refs, (const uint8_t *)"refs/heads/other", 16u,
    seed.commit_oid, request, sizeof request, &w) == F7_IDENTITY_MISMATCH);
  advert.ofs_delta = 0u;
  assert(f7_upload_request_build(buf, &advert, refs, (const uint8_t *)F7_BOOTSTRAP_REF,
    F7_BOOTSTRAP_REF_LENGTH, seed.commit_oid, request, sizeof request, &w) == F7_INVALID);
  /* Non-SHA1 object format and duplicate refs reject. */
  len = 0u;
  pkt(buf, &len, "# service=git-upload-pack\n", 26u);
  flush(buf, &len);
  memcpy(line + 67, "object-format=sha256 side-band-64k\n", 35u);
  pkt(buf, &len, line, 67u + 35u);
  flush(buf, &len);
  assert(f7_advert_parse(buf, len, F7_SERVICE_UPLOAD_PACK, refs, 4u, &advert) == F7_INVALID);
  len = 0u;
  pkt(buf, &len, "# service=git-upload-pack\n", 26u);
  flush(buf, &len);
  memcpy(line + 67, "side-band-64k ofs-delta\n", 24u);
  pkt(buf, &len, line, 67u + 24u);
  memcpy(line + 66, "\n", 1u);
  pkt(buf, &len, line, 67u);
  flush(buf, &len);
  assert(f7_advert_parse(buf, len, F7_SERVICE_UPLOAD_PACK, refs, 4u, &advert) == F7_INVALID);
  /* Response: NAK, pack on channel 1, progress on channel 2, flush, EOF. */
  len = 0u;
  pkt(buf, &len, "NAK\n", 4u);
  line[0] = 1u; memcpy(line + 1, seedpack, 150u); pkt(buf, &len, line, 151u);
  line[0] = 2u; memcpy(line + 1, "Counting\r", 9u); pkt(buf, &len, line, 10u);
  line[0] = 1u; memcpy(line + 1, seedpack + 150, F7_SEED_PACK_SIZE - 150u); pkt(buf, &len, line, F7_SEED_PACK_SIZE - 149u);
  flush(buf, &len);
  assert(f7_upload_response_parse(buf, len, packbuf, sizeof packbuf, progress, sizeof progress,
    error, sizeof error, &response) == F7_OK);
  assert(response.pack_length == F7_SEED_PACK_SIZE && memcmp(packbuf, seedpack, F7_SEED_PACK_SIZE) == 0);
  assert(response.progress_length == 9u && response.nak_seen && response.flush_seen);
  assert(f7_upload_response_parse(buf, len, packbuf, 100u, progress, sizeof progress,
    error, sizeof error, &response) == F7_OVERFLOWED && response.pack_length == 100u);
  assert(f7_upload_response_parse(buf, len - 4u, packbuf, sizeof packbuf, progress, sizeof progress,
    error, sizeof error, &response) == F7_INCOMPLETE);
  buf[len] = '0';
  assert(f7_upload_response_parse(buf, len + 1u, packbuf, sizeof packbuf, progress, sizeof progress,
    error, sizeof error, &response) == F7_INVALID);
  /* Remote error channel is retained privately and rejects. */
  len = 0u;
  pkt(buf, &len, "NAK\n", 4u);
  line[0] = 3u; memcpy(line + 1, "denied", 6u); pkt(buf, &len, line, 7u);
  flush(buf, &len);
  assert(f7_upload_response_parse(buf, len, packbuf, sizeof packbuf, progress, sizeof progress,
    error, sizeof error, &response) == F7_INVALID);
  assert(response.error_length == 6u && memcmp(error, "denied", 6u) == 0);
  /* ACK instead of NAK rejects. */
  len = 0u;
  pkt(buf, &len, "ACK ", 4u);
  flush(buf, &len);
  assert(f7_upload_response_parse(buf, len, packbuf, sizeof packbuf, progress, sizeof progress,
    error, sizeof error, &response) == F7_INVALID);
  /* Receive-pack: empty repository advertisement, exact command and pack. */
  len = 0u;
  pkt(buf, &len, "# service=git-receive-pack\n", 27u);
  flush(buf, &len);
  memset(line, '0', 40u); line[40] = ' ';
  memcpy(line + 41, "capabilities^{}", 15u); line[56] = 0u;
  memcpy(line + 57, "report-status delete-refs\n", 26u);
  pkt(buf, &len, line, 83u);
  flush(buf, &len);
  assert(f7_advert_parse(buf, len, F7_SERVICE_RECEIVE_PACK, refs, 4u, &advert) == F7_OK);
  assert(advert.empty_repository && advert.ref_count == 0u && advert.report_status);
  assert(f7_receive_request_build(&advert, seed.commit_oid, seedpack, F7_SEED_PACK_SIZE,
    request, sizeof request, &w) == F7_OK);
  assert(w == F7_RECEIVE_COMMAND_SIZE + F7_SEED_PACK_SIZE);
  assert(memcmp(request, "007e0000000000000000000000000000000000000000 ", 45u) == 0);
  assert(memcmp(request + 45, hex, 40u) == 0);
  assert(memcmp(request + 85, " refs/heads/bootstrap-seed\0report-status\n0000", 45u) == 0);
  assert(memcmp(request + F7_RECEIVE_COMMAND_SIZE, seedpack, F7_SEED_PACK_SIZE) == 0);
  advert.empty_repository = 0u;
  assert(f7_receive_request_build(&advert, seed.commit_oid, seedpack, F7_SEED_PACK_SIZE,
    request, sizeof request, &w) == F7_INVALID);
  /* report-status: success, rejection, unknown outcome. */
  len = 0u;
  pkt(buf, &len, "unpack ok\n", 10u);
  pkt(buf, &len, "ok refs/heads/bootstrap-seed\n", 29u);
  flush(buf, &len);
  assert(f7_report_status_parse(buf, len, &status) == F7_OK && status.unpack_ok && status.ref_ok);
  assert(f7_report_status_parse(buf, len - 4u, &status) == F7_INCOMPLETE && status.ref_ok);
  len = 0u;
  pkt(buf, &len, "unpack ok\n", 10u);
  pkt(buf, &len, "ng refs/heads/bootstrap-seed already exists\n", 44u);
  flush(buf, &len);
  assert(f7_report_status_parse(buf, len, &status) == F7_INVALID && status.ref_rejected);
}

int main(void) {
  assert(sodium_init() >= 0);
  sha1_vectors();
  inflate_vectors();
  delta_vectors();
  pack_vectors();
  seed_vectors();
  protocol_vectors();
  return 0;
}
