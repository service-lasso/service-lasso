#include "seed-objects.h"
#include "git-inflate.h"
#include "protocol.h"
#include <string.h>

/* U2 #1753 SOURCE ONLY / UNEXECUTED. Exact SPEC-010 B1 seed construction. */

static const char seed_blob_text[] = "service-lasso-f7-bootstrap-v1\n";
static const char seed_tree_entry[] = "100644 BOOTSTRAP.txt";
static const char seed_commit_identity[] =
  "author F7 Bootstrap <f7-bootstrap@invalid> 0 +0000\n"
  "committer F7 Bootstrap <f7-bootstrap@invalid> 0 +0000\n"
  "\n"
  "f7-bootstrap-v1\n";

/** Compare a computed identity to a pinned lowercase hex constant. */
static int pinned(const uint8_t oid[F7_SHA1_SIZE], const char *hex) {
  uint8_t expected[F7_SHA1_SIZE];
  if (f7_sha1_from_hex(expected, (const uint8_t *)hex, F7_SHA1_HEX_SIZE) != F7_OK) return 0;
  return memcmp(expected, oid, F7_SHA1_SIZE) == 0;
}

int f7_seed_build(struct f7_seed *seed) {
  struct f7_seed next;
  size_t entry = sizeof seed_tree_entry - 1u, identity = sizeof seed_commit_identity - 1u;
  int rc;
  if (seed == NULL) return F7_INVALID;
  memset(seed, 0, sizeof *seed);
  memset(&next, 0, sizeof next);
  if (sizeof seed_blob_text - 1u != F7_SEED_BLOB_SIZE ||
      entry + 1u + F7_SHA1_SIZE != F7_SEED_TREE_SIZE ||
      5u + F7_SHA1_HEX_SIZE + 1u + identity != F7_SEED_COMMIT_SIZE) return F7_INVALID;
  /* Blob: ASCII text plus exactly one LF, no CR/BOM. */
  memcpy(next.blob, seed_blob_text, F7_SEED_BLOB_SIZE);
  rc = f7_git_object_oid(F7_GIT_BLOB, next.blob, F7_SEED_BLOB_SIZE, next.blob_oid);
  if (rc != F7_OK) return rc;
  /* Tree: one flat entry "100644 BOOTSTRAP.txt\0" + 20 binary blob OID bytes. */
  memcpy(next.tree, seed_tree_entry, entry);
  next.tree[entry] = 0u;
  memcpy(next.tree + entry + 1u, next.blob_oid, F7_SHA1_SIZE);
  rc = f7_git_object_oid(F7_GIT_TREE, next.tree, F7_SEED_TREE_SIZE, next.tree_oid);
  if (rc != F7_OK) return rc;
  /* Commit: "tree <hex>\n" + fixed identities, blank line, message; no parents. */
  memcpy(next.commit, "tree ", 5u);
  f7_sha1_hex((char *)next.commit + 5, next.tree_oid);
  next.commit[5u + F7_SHA1_HEX_SIZE] = (uint8_t)'\n';
  memcpy(next.commit + 6u + F7_SHA1_HEX_SIZE, seed_commit_identity, identity);
  rc = f7_git_object_oid(F7_GIT_COMMIT, next.commit, F7_SEED_COMMIT_SIZE, next.commit_oid);
  if (rc != F7_OK) return rc;
  if (!pinned(next.blob_oid, F7_SEED_BLOB_OID) || !pinned(next.tree_oid, F7_SEED_TREE_OID) ||
      !pinned(next.commit_oid, F7_SEED_COMMIT_OID)) return F7_IDENTITY_MISMATCH;
  *seed = next;
  return F7_OK;
}

int f7_pack_object_header(enum f7_git_type type, uint64_t size, uint8_t *out,
    size_t capacity, size_t *written) {
  uint8_t bytes[10];
  size_t n = 0u;
  if (written != NULL) *written = 0u;
  if (out == NULL || written == NULL ||
      (type != F7_GIT_COMMIT && type != F7_GIT_TREE && type != F7_GIT_BLOB)) return F7_INVALID;
  /* First byte: continuation bit, three type bits, low four size bits. */
  bytes[n] = (uint8_t)(((unsigned)type << 4) | (unsigned)(size & 15u));
  size >>= 4;
  while (size != 0u) {
    bytes[n++] |= 0x80u;
    bytes[n] = (uint8_t)(size & 0x7Fu);
    size >>= 7;
  }
  ++n;
  if (n > capacity) return F7_OVERFLOWED;
  memcpy(out, bytes, n);
  *written = n;
  return F7_OK;
}

/** Append one whole object (header + stored zlib body) at out[*pos]. */
static int append_object(enum f7_git_type type, const uint8_t *body, size_t length,
    uint8_t *out, size_t capacity, size_t *pos) {
  size_t part = 0u;
  int rc = f7_pack_object_header(type, (uint64_t)length, out + *pos, capacity - *pos, &part);
  if (rc != F7_OK) return rc;
  *pos += part;
  rc = f7_zlib_store(body, length, out + *pos, capacity - *pos, &part);
  if (rc != F7_OK) return rc;
  *pos += part;
  return F7_OK;
}

int f7_seed_pack_write(const struct f7_seed *seed, uint8_t *out,
    size_t capacity, size_t *written) {
  struct f7_sha1 sha;
  /* "PACK", u32 version 2, u32 object count. */
  size_t pos = 12u;
  int rc;
  if (written != NULL) *written = 0u;
  if (seed == NULL || out == NULL || written == NULL) return F7_INVALID;
  if (capacity < F7_SEED_PACK_SIZE) return F7_OVERFLOWED;
  memcpy(out, "PACK", 4u);
  out[4] = 0u; out[5] = 0u; out[6] = 0u; out[7] = 2u;
  out[8] = 0u; out[9] = 0u; out[10] = 0u; out[11] = (uint8_t)F7_SEED_OBJECT_COUNT;
  rc = append_object(F7_GIT_COMMIT, seed->commit, F7_SEED_COMMIT_SIZE, out, capacity, &pos);
  if (rc == F7_OK) rc = append_object(F7_GIT_TREE, seed->tree, F7_SEED_TREE_SIZE, out, capacity, &pos);
  if (rc == F7_OK) rc = append_object(F7_GIT_BLOB, seed->blob, F7_SEED_BLOB_SIZE, out, capacity, &pos);
  if (rc != F7_OK) return rc;
  if (pos + F7_SHA1_SIZE != F7_SEED_PACK_SIZE) return F7_INVALID;
  f7_sha1_init(&sha);
  rc = f7_sha1_update(&sha, out, pos);
  if (rc == F7_OK) rc = f7_sha1_final(&sha, out + pos);
  if (rc != F7_OK) return rc;
  *written = pos + F7_SHA1_SIZE;
  return F7_OK;
}
