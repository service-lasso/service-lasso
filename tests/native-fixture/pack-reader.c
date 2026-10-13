#include "pack-reader.h"
#include "delta-reader.h"
#include "git-inflate.h"
#include "protocol.h"
#include <string.h>

/* U2 #1753 SOURCE ONLY / UNEXECUTED. Original PACK v2 bounded reader. */

/** Checked a * b + c in u64; returns F7_OVERFLOWED on overflow. */
static int checked_mul_add(uint64_t a, uint64_t b, uint64_t c, uint64_t *out) {
  if (a != 0u && b > UINT64_MAX / a) return F7_OVERFLOWED;
  if (a * b > UINT64_MAX - c) return F7_OVERFLOWED;
  *out = a * b + c;
  return F7_OK;
}

int f7_pack_limits_derive(uint64_t expected_sum, uint32_t object_count,
    uint64_t object_max, struct f7_pack_limits *limits) {
  struct f7_pack_limits next;
  if (limits == NULL) return F7_INVALID;
  memset(limits, 0, sizeof *limits);
  if (expected_sum == 0u || object_count == 0u || object_count > F7_PACK_OBJECTS_MAX ||
      object_max == 0u || object_max > expected_sum) return F7_INVALID;
  memset(&next, 0, sizeof next);
  if (checked_mul_add(2u, expected_sum, F7_PACK_SLACK, &next.pack_max) != F7_OK ||
      checked_mul_add(65u, expected_sum, F7_PACK_SLACK, &next.work_max) != F7_OK)
    return F7_OVERFLOWED;
  next.object_max = object_max;
  next.object_count = object_count;
  next.depth_max = F7_PACK_DEPTH_MAX;
  *limits = next;
  return F7_OK;
}

/** Reserve n arena bytes; F7_OVERFLOWED when capacity is insufficient. */
static int arena_take(struct f7_pack_arena *arena, size_t n, size_t *offset) {
  if (arena->used > arena->capacity || n > arena->capacity - arena->used) return F7_OVERFLOWED;
  *offset = arena->used;
  arena->used += n;
  return F7_OK;
}

/** Charge n bytes against the admitted work ceiling before producing them. */
static int charge_work(struct f7_pack_accounting *acc, const struct f7_pack_limits *l,
    uint64_t n) {
  if (n > l->work_max || acc->work > l->work_max - n) return F7_OVERFLOWED;
  acc->work += n;
  return F7_OK;
}

/** Decode a PACK object header: type in bits 4..6, size base-128 after. */
static int read_object_header(const uint8_t *pack, size_t end, size_t *pos,
    uint8_t *type, uint64_t *size) {
  uint8_t c;
  uint64_t value;
  unsigned shift = 4u;
  if (*pos >= end) return F7_INCOMPLETE;
  c = pack[(*pos)++];
  *type = (uint8_t)((c >> 4) & 7u);
  value = c & 15u;
  while ((c & 0x80u) != 0u) {
    if (*pos >= end) return F7_INCOMPLETE;
    if (shift > 57u) return F7_INVALID;
    c = pack[(*pos)++];
    value |= (uint64_t)(c & 0x7Fu) << shift;
    shift += 7u;
  }
  *size = value;
  return F7_OK;
}

/** Decode the OFS_DELTA negative offset (Git's offset-minus-one encoding). */
static int read_ofs(const uint8_t *pack, size_t end, size_t *pos, uint64_t *distance) {
  uint8_t c;
  uint64_t value;
  if (*pos >= end) return F7_INCOMPLETE;
  c = pack[(*pos)++];
  value = c & 0x7Fu;
  while ((c & 0x80u) != 0u) {
    if (value >= (UINT64_C(1) << 56)) return F7_INVALID;
    if (*pos >= end) return F7_INCOMPLETE;
    c = pack[(*pos)++];
    value = ((value + 1u) << 7) | (c & 0x7Fu);
  }
  *distance = value;
  return F7_OK;
}

/** Big-endian u32. */
static uint32_t be32(const uint8_t *p) {
  return ((uint32_t)p[0] << 24) | ((uint32_t)p[1] << 16) | ((uint32_t)p[2] << 8) | p[3];
}

int f7_pack_scan(const uint8_t *pack, size_t length,
    const struct f7_pack_limits *limits, struct f7_pack_entry *entries,
    size_t entry_capacity, struct f7_pack_arena *arena,
    struct f7_pack_accounting *accounting) {
  struct f7_sha1 sha;
  uint8_t trailer[F7_SHA1_SIZE];
  size_t pos = F7_PACK_HEADER_SIZE, end;
  uint32_t declared, i;
  int rc;
  if (accounting == NULL) return F7_INVALID;
  memset(accounting, 0, sizeof *accounting);
  if (pack == NULL || limits == NULL || entries == NULL || arena == NULL ||
      arena->bytes == NULL || arena->used != 0u) return F7_INVALID;
  if ((uint64_t)length > limits->pack_max) return F7_OVERFLOWED;
  if (length < F7_PACK_HEADER_SIZE + F7_SHA1_SIZE) return F7_INCOMPLETE;
  if (memcmp(pack, "PACK", 4u) != 0 || be32(pack + 4u) != 2u) return F7_INVALID;
  declared = be32(pack + 8u);
  accounting->declared_count = declared;
  if (declared != limits->object_count || (size_t)declared > entry_capacity) return F7_INVALID;
  end = length - F7_SHA1_SIZE;
  for (i = 0; i < declared; ++i) {
    struct f7_pack_entry *e = &entries[i];
    struct f7_inflate_result inflated;
    uint64_t size;
    uint8_t type;
    size_t payload;
    memset(e, 0, sizeof *e);
    e->offset = pos;
    rc = read_object_header(pack, end, &pos, &type, &size);
    if (rc != F7_OK) return rc;
    e->pack_type = type;
    e->declared_size = size;
    if (type == F7_GIT_OFS_DELTA) {
      uint64_t distance;
      rc = read_ofs(pack, end, &pos, &distance);
      if (rc != F7_OK) return rc;
      /* Base must be an earlier object of this same pack. */
      if (distance == 0u || distance > e->offset - F7_PACK_HEADER_SIZE) return F7_INVALID;
      e->base_offset = e->offset - distance;
    } else if (type == F7_GIT_REF_DELTA) {
      if (end - pos < F7_SHA1_SIZE) return F7_INCOMPLETE;
      memcpy(e->base_oid, pack + pos, F7_SHA1_SIZE);
      pos += F7_SHA1_SIZE;
    } else if (type != F7_GIT_COMMIT && type != F7_GIT_TREE && type != F7_GIT_BLOB) {
      /* Tags and reserved types are outside every F7 inventory. */
      return F7_INVALID;
    }
    if (type != F7_GIT_OFS_DELTA && type != F7_GIT_REF_DELTA && size > limits->object_max)
      return F7_OVERFLOWED;
    if (size > (uint64_t)SIZE_MAX) return F7_OVERFLOWED;
    rc = charge_work(accounting, limits, size);
    if (rc != F7_OK) return rc;
    rc = arena_take(arena, (size_t)size, &payload);
    if (rc != F7_OK) return rc;
    e->data_offset = pos;
    /* Capacity equals the declared size: any extra inflated byte rejects. */
    rc = f7_zlib_inflate(pack + pos, end - pos, arena->bytes + payload, (size_t)size, &inflated);
    e->compressed_length = inflated.consumed;
    if (rc == F7_OVERFLOWED) return F7_INVALID;
    if (rc != F7_OK) return rc;
    if ((uint64_t)inflated.produced != size) return F7_INVALID;
    pos += inflated.consumed;
    e->payload_offset = payload;
    e->payload_length = (size_t)size;
    e->state = F7_PACK_SCANNED;
    if (type != F7_GIT_OFS_DELTA && type != F7_GIT_REF_DELTA) {
      e->body_type = type;
      e->body_offset = payload;
      e->body_length = (size_t)size;
      rc = f7_git_object_oid((enum f7_git_type)type, arena->bytes + payload, (size_t)size, e->oid);
      if (rc != F7_OK) return rc;
      e->state = F7_PACK_RESOLVED;
      accounting->resolved_count++;
    }
    accounting->scanned_count = i + 1u;
  }
  /* Exactly the trailer remains: no trailing or missing bytes. */
  if (pos != end) return F7_INVALID;
  f7_sha1_init(&sha);
  rc = f7_sha1_update(&sha, pack, end);
  if (rc == F7_OK) rc = f7_sha1_final(&sha, trailer);
  if (rc != F7_OK) return rc;
  memcpy(accounting->trailer, pack + end, F7_SHA1_SIZE);
  return memcmp(trailer, pack + end, F7_SHA1_SIZE) == 0 ? F7_OK : F7_INVALID;
}

/** Binary search a scanned entry by original object offset. */
static struct f7_pack_entry *find_offset(struct f7_pack_entry *entries,
    uint32_t count, uint64_t offset) {
  uint32_t lo = 0u, hi = count;
  while (lo < hi) {
    uint32_t mid = lo + (hi - lo) / 2u;
    if (entries[mid].offset == offset) return &entries[mid];
    if (entries[mid].offset < offset) lo = mid + 1u; else hi = mid;
  }
  return NULL;
}

const struct f7_pack_entry *f7_pack_find(const struct f7_pack_entry *entries,
    uint32_t count, const uint8_t oid[F7_SHA1_SIZE]) {
  uint32_t i;
  if (entries == NULL || oid == NULL) return NULL;
  for (i = 0; i < count; ++i)
    if (entries[i].state == F7_PACK_RESOLVED && memcmp(entries[i].oid, oid, F7_SHA1_SIZE) == 0)
      return &entries[i];
  return NULL;
}

int f7_pack_resolve(struct f7_pack_entry *entries,
    const struct f7_pack_limits *limits, struct f7_pack_arena *arena,
    struct f7_pack_accounting *accounting) {
  uint32_t count, i, j;
  int progress = 1, rc;
  if (entries == NULL || limits == NULL || arena == NULL || arena->bytes == NULL ||
      accounting == NULL || limits->depth_max > F7_PACK_DEPTH_MAX) return F7_INVALID;
  count = accounting->scanned_count;
  if (count != accounting->declared_count) return F7_INCOMPLETE;
  /* Each pass resolves at least one more delta level or stops. */
  while (progress && accounting->resolved_count < count) {
    progress = 0;
    for (i = 0; i < count; ++i) {
      struct f7_pack_entry *e = &entries[i];
      const struct f7_pack_entry *base;
      struct f7_delta_header header;
      size_t result, produced = 0u;
      if (e->state == F7_PACK_RESOLVED) continue;
      if (e->pack_type == F7_GIT_OFS_DELTA) base = find_offset(entries, count, e->base_offset);
      else base = f7_pack_find(entries, count, e->base_oid);
      if (base == NULL) {
        /* An OFS base offset that names no object is malformed, not pending. */
        if (e->pack_type == F7_GIT_OFS_DELTA) return F7_INVALID;
        continue;
      }
      if (base->state != F7_PACK_RESOLVED) continue;
      if ((uint32_t)base->depth + 1u > limits->depth_max) return F7_INVALID;
      rc = f7_delta_header_read(arena->bytes + e->payload_offset, e->payload_length, &header);
      if (rc != F7_OK) return rc;
      if (header.result_size > limits->object_max) return F7_OVERFLOWED;
      rc = charge_work(accounting, limits, header.result_size);
      if (rc != F7_OK) return rc;
      rc = arena_take(arena, (size_t)header.result_size, &result);
      if (rc != F7_OK) return rc;
      rc = f7_delta_apply(arena->bytes + base->body_offset, base->body_length,
        arena->bytes + e->payload_offset, e->payload_length,
        arena->bytes + result, (size_t)header.result_size, &produced);
      if (rc != F7_OK) return rc;
      e->body_type = base->body_type;
      e->body_offset = result;
      e->body_length = produced;
      e->depth = (uint8_t)(base->depth + 1u);
      rc = f7_git_object_oid((enum f7_git_type)e->body_type, arena->bytes + result, produced, e->oid);
      if (rc != F7_OK) return rc;
      e->state = F7_PACK_RESOLVED;
      accounting->resolved_count++;
      progress = 1;
    }
  }
  /* Remaining deltas name external/thin bases or form a cycle. */
  if (accounting->resolved_count != count) return F7_INVALID;
  for (i = 0; i < count; ++i)
    for (j = i + 1u; j < count; ++j)
      if (memcmp(entries[i].oid, entries[j].oid, F7_SHA1_SIZE) == 0) return F7_INVALID;
  return F7_OK;
}
