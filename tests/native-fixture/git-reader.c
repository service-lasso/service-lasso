#include "git-reader.h"
#include "protocol.h"
#include <sodium.h>
#include <string.h>

/* U2 #1753 SOURCE ONLY / UNEXECUTED. Exact reachable original inventory. */

int f7_git_expected_sum(const struct f7_git_expected *expected, uint32_t count,
    uint64_t *sum, uint64_t *largest) {
  uint64_t total = 0u, max = 0u;
  uint32_t i, j;
  if (sum != NULL) *sum = 0u;
  if (largest != NULL) *largest = 0u;
  if (expected == NULL || sum == NULL || largest == NULL || count == 0u ||
      count > F7_PACK_OBJECTS_MAX) return F7_INVALID;
  for (i = 0; i < count; ++i) {
    if (expected[i].type != F7_GIT_COMMIT && expected[i].type != F7_GIT_TREE &&
        expected[i].type != F7_GIT_BLOB) return F7_INVALID;
    if (expected[i].length > UINT64_MAX - total) return F7_OVERFLOWED;
    total += expected[i].length;
    if (expected[i].length > max) max = expected[i].length;
    for (j = 0; j < i; ++j)
      if (memcmp(expected[i].oid, expected[j].oid, F7_SHA1_SIZE) == 0) return F7_INVALID;
  }
  *sum = total;
  *largest = max;
  return F7_OK;
}

/** Index of the pack entry with oid, or -1. */
static long entry_index(const struct f7_pack_entry *entries, uint32_t count,
    const uint8_t oid[F7_SHA1_SIZE]) {
  uint32_t i;
  for (i = 0; i < count; ++i)
    if (memcmp(entries[i].oid, oid, F7_SHA1_SIZE) == 0) return (long)i;
  return -1;
}

/** SHA256 of the body and of "<type> <len>\0" + body. */
static int digests(const struct f7_pack_entry *e, const uint8_t *body,
    struct f7_git_readback_record *r) {
  crypto_hash_sha256_state state;
  uint8_t header[32];
  size_t header_length = 0u;
  int rc = f7_git_object_header((enum f7_git_type)e->body_type, (uint64_t)e->body_length,
    header, sizeof header, &header_length);
  if (rc != F7_OK) return rc;
  if (crypto_hash_sha256(r->body_sha256, body, (unsigned long long)e->body_length) != 0)
    return F7_NATIVE_FAILURE;
  if (crypto_hash_sha256_init(&state) != 0 ||
      crypto_hash_sha256_update(&state, header, header_length) != 0 ||
      crypto_hash_sha256_update(&state, body, (unsigned long long)e->body_length) != 0 ||
      crypto_hash_sha256_final(&state, r->framed_sha256) != 0) return F7_NATIVE_FAILURE;
  return F7_OK;
}

/** Mark the entry with oid reachable; it must exist with the required type. */
static int reach(const struct f7_pack_entry *entries, uint32_t count,
    struct f7_git_readback_record *records, const uint8_t oid[F7_SHA1_SIZE],
    uint8_t type, long *index) {
  long at = entry_index(entries, count, oid);
  if (at < 0) return F7_INCOMPLETE;
  if (entries[at].body_type != type) return F7_INVALID;
  records[at].reachable = 1u;
  if (index != NULL) *index = at;
  return F7_OK;
}

/** Parse the commit: first line "tree <hex>\n"; reject any "parent " header. */
static int commit_tree(const uint8_t *body, size_t length, uint8_t tree[F7_SHA1_SIZE]) {
  size_t pos;
  if (length < 5u + F7_SHA1_HEX_SIZE + 1u || memcmp(body, "tree ", 5u) != 0 ||
      body[5u + F7_SHA1_HEX_SIZE] != (uint8_t)'\n') return F7_INVALID;
  if (f7_sha1_from_hex(tree, body + 5u, F7_SHA1_HEX_SIZE) != F7_OK) return F7_INVALID;
  pos = 6u + F7_SHA1_HEX_SIZE;
  /* Headers end at the first empty line; evidence and seed roots are parentless. */
  while (pos < length && body[pos] != (uint8_t)'\n') {
    const uint8_t *line = body + pos, *end = memchr(line, '\n', length - pos);
    if (end == NULL) return F7_INVALID;
    if ((size_t)(end - line) >= 7u && memcmp(line, "parent ", 7u) == 0) return F7_INVALID;
    if ((size_t)(end - line) >= 5u && memcmp(line, "tree ", 5u) == 0) return F7_INVALID;
    pos = (size_t)(end - body) + 1u;
  }
  return pos < length ? F7_OK : F7_INVALID;
}

int f7_git_readback_verify(const struct f7_pack_entry *entries,
    const struct f7_pack_accounting *accounting, const struct f7_pack_arena *arena,
    const struct f7_git_expected *expected, uint32_t expected_count,
    const uint8_t want[F7_SHA1_SIZE], struct f7_git_readback_record *records,
    size_t record_capacity) {
  uint8_t tree_oid[F7_SHA1_SIZE];
  const uint8_t *tree, *name_prev = NULL;
  size_t pos, tree_length, prev_length = 0u;
  uint32_t count, i;
  long at;
  int rc;
  if (entries == NULL || accounting == NULL || arena == NULL || arena->bytes == NULL ||
      expected == NULL || want == NULL || records == NULL) return F7_INVALID;
  count = accounting->scanned_count;
  if (count != accounting->declared_count || accounting->resolved_count != count ||
      (size_t)count > record_capacity) return F7_INCOMPLETE;
  memset(records, 0, sizeof *records * count);
  for (i = 0; i < count; ++i) {
    const struct f7_pack_entry *e = &entries[i];
    struct f7_git_readback_record *r = &records[i];
    if (e->state != F7_PACK_RESOLVED || e->body_offset > arena->used ||
        e->body_length > arena->used - e->body_offset) return F7_INVALID;
    memcpy(r->oid, e->oid, F7_SHA1_SIZE);
    r->type = e->body_type;
    r->pack_type = e->pack_type;
    r->depth = e->depth;
    r->length = e->body_length;
    r->pack_offset = e->offset;
    r->compressed_length = e->compressed_length;
    rc = digests(e, arena->bytes + e->body_offset, r);
    if (rc != F7_OK) return rc;
  }
  /* Exact distinct OID count: missing or extra objects reject. */
  if (expected_count != count) return F7_INVALID;
  for (i = 0; i < expected_count; ++i) {
    const struct f7_git_expected *x = &expected[i];
    const struct f7_pack_entry *e;
    at = entry_index(entries, count, x->oid);
    if (at < 0) return F7_INVALID;
    e = &entries[at];
    if (e->body_type != x->type || (uint64_t)e->body_length != x->length ||
        sodium_memcmp(records[at].body_sha256, x->sha256, F7_GIT_SHA256_SIZE) != 0)
      return F7_IDENTITY_MISMATCH;
    if (x->body != NULL && e->body_length != 0u &&
        memcmp(arena->bytes + e->body_offset, x->body, e->body_length) != 0)
      return F7_IDENTITY_MISMATCH;
  }
  /* Graph: want commit -> one flat tree -> blobs. */
  rc = reach(entries, count, records, want, F7_GIT_COMMIT, &at);
  if (rc != F7_OK) return rc == F7_INCOMPLETE ? F7_INVALID : rc;
  rc = commit_tree(arena->bytes + entries[at].body_offset, entries[at].body_length, tree_oid);
  if (rc != F7_OK) return rc;
  rc = reach(entries, count, records, tree_oid, F7_GIT_TREE, &at);
  if (rc != F7_OK) return F7_INVALID;
  tree = arena->bytes + entries[at].body_offset;
  tree_length = entries[at].body_length;
  pos = 0u;
  while (pos < tree_length) {
    const uint8_t *name, *nul;
    size_t name_length, cmp;
    if (tree_length - pos < 7u || memcmp(tree + pos, "100644 ", 7u) != 0) return F7_INVALID;
    name = tree + pos + 7u;
    nul = memchr(name, 0, tree_length - pos - 7u);
    if (nul == NULL) return F7_INVALID;
    name_length = (size_t)(nul - name);
    if (name_length == 0u || memchr(name, '/', name_length) != NULL) return F7_INVALID;
    if (tree_length - (size_t)(nul + 1 - tree) < F7_SHA1_SIZE) return F7_INVALID;
    /* Git orders blob entries by raw name bytes; equal/descending rejects. */
    if (name_prev != NULL) {
      cmp = prev_length < name_length ? prev_length : name_length;
      {
        int order = memcmp(name_prev, name, cmp);
        if (order > 0 || (order == 0 && prev_length >= name_length)) return F7_INVALID;
      }
    }
    name_prev = name;
    prev_length = name_length;
    rc = reach(entries, count, records, nul + 1, F7_GIT_BLOB, NULL);
    if (rc != F7_OK) return F7_INVALID;
    pos = (size_t)(nul + 1 - tree) + F7_SHA1_SIZE;
  }
  for (i = 0; i < count; ++i) if (!records[i].reachable) return F7_INVALID;
  return F7_OK;
}
