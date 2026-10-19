#include "git-protocol.h"
#include "protocol.h"
#include <string.h>

/* U2 #1753 SOURCE ONLY / UNEXECUTED. Strict Git smart-HTTP v0 codecs. */

/** Strict lowercase hex nibble; -1 for anything else. */
static int nibble(uint8_t c) {
  if (c >= (uint8_t)'0' && c <= (uint8_t)'9') return c - (uint8_t)'0';
  if (c >= (uint8_t)'a' && c <= (uint8_t)'f') return c - (uint8_t)'a' + 10;
  return -1;
}

/** True when in[offset..offset+length) equals the NUL-free literal text. */
static int bytes_equal(const uint8_t *in, size_t length, const char *text) {
  size_t n = strlen(text);
  return length == n && memcmp(in, text, n) == 0;
}

int f7_pkt_encode(const uint8_t *payload, size_t length, uint8_t *out,
    size_t capacity, size_t *written) {
  static const char hex[] = "0123456789abcdef";
  size_t total;
  if (written != NULL) *written = 0u;
  if (written == NULL || out == NULL || payload == NULL || length == 0u ||
      length > F7_PKT_MAX - F7_PKT_HEADER) return F7_INVALID;
  total = length + F7_PKT_HEADER;
  if (total > capacity) return F7_OVERFLOWED;
  out[0] = (uint8_t)hex[(total >> 12) & 15u];
  out[1] = (uint8_t)hex[(total >> 8) & 15u];
  out[2] = (uint8_t)hex[(total >> 4) & 15u];
  out[3] = (uint8_t)hex[total & 15u];
  memcpy(out + F7_PKT_HEADER, payload, length);
  *written = total;
  return F7_OK;
}

int f7_pkt_next(const uint8_t *in, size_t length, size_t *pos,
    enum f7_pkt_kind *kind, size_t *payload_offset, size_t *payload_length) {
  size_t at, declared = 0u;
  unsigned i;
  if (in == NULL || pos == NULL || kind == NULL || payload_offset == NULL ||
      payload_length == NULL || *pos > length) return F7_INVALID;
  at = *pos;
  if (length - at < F7_PKT_HEADER) return F7_INCOMPLETE;
  for (i = 0; i < F7_PKT_HEADER; ++i) {
    int v = nibble(in[at + i]);
    if (v < 0) return F7_INVALID;
    declared = (declared << 4) | (size_t)v;
  }
  if (declared == 0u) {
    *kind = F7_PKT_FLUSH;
    *payload_offset = at + F7_PKT_HEADER;
    *payload_length = 0u;
    *pos = at + F7_PKT_HEADER;
    return F7_OK;
  }
  /* 0001..0004 are v2 delimiter/response-end, reserved or empty: closed reject. */
  if (declared <= F7_PKT_HEADER || declared > F7_PKT_MAX) return F7_INVALID;
  if (length - at < declared) return F7_INCOMPLETE;
  *kind = F7_PKT_DATA;
  *payload_offset = at + F7_PKT_HEADER;
  *payload_length = declared - F7_PKT_HEADER;
  *pos = at + declared;
  return F7_OK;
}

/** Record capability flags from space-separated tokens; reject non-SHA1. */
static int parse_caps(const uint8_t *caps, size_t length, struct f7_advert *a) {
  size_t start = 0u;
  while (start < length) {
    size_t end = start;
    const uint8_t *token;
    size_t n;
    while (end < length && caps[end] != (uint8_t)' ') ++end;
    token = caps + start;
    n = end - start;
    if (n == 0u) return F7_INVALID;
    if (bytes_equal(token, n, "side-band-64k")) a->side_band_64k = 1u;
    else if (bytes_equal(token, n, "ofs-delta")) a->ofs_delta = 1u;
    else if (bytes_equal(token, n, "report-status")) a->report_status = 1u;
    else if (n >= 14u && memcmp(token, "object-format=", 14u) == 0 &&
             !bytes_equal(token, n, "object-format=sha1")) return F7_INVALID;
    start = end + 1u;
    if (end + 1u == length) return F7_INVALID; /* trailing separator */
  }
  return F7_OK;
}

/** Validate a raw ref name: non-empty, no NUL/LF/space/control bytes. */
static int valid_ref_name(const uint8_t *name, size_t length) {
  size_t i;
  if (length == 0u) return 0;
  for (i = 0; i < length; ++i) if (name[i] <= 0x20u || name[i] == 0x7Fu) return 0;
  return 1;
}

int f7_advert_parse(const uint8_t *in, size_t length, enum f7_git_service service,
    struct f7_advert_ref *refs, size_t ref_capacity, struct f7_advert *advert) {
  const char *announce;
  enum f7_pkt_kind kind;
  size_t pos = 0u, off, n;
  int rc, first = 1;
  if (advert == NULL) return F7_INVALID;
  memset(advert, 0, sizeof *advert);
  if (in == NULL || (refs == NULL && ref_capacity != 0u)) return F7_INVALID;
  if (service == F7_SERVICE_UPLOAD_PACK) announce = "# service=git-upload-pack\n";
  else if (service == F7_SERVICE_RECEIVE_PACK) announce = "# service=git-receive-pack\n";
  else return F7_INVALID;
  rc = f7_pkt_next(in, length, &pos, &kind, &off, &n);
  if (rc != F7_OK) return rc;
  if (kind != F7_PKT_DATA || !bytes_equal(in + off, n, announce)) return F7_INVALID;
  rc = f7_pkt_next(in, length, &pos, &kind, &off, &n);
  if (rc != F7_OK) return rc;
  if (kind != F7_PKT_FLUSH) return F7_INVALID;
  for (;;) {
    const uint8_t *line, *name, *nul;
    size_t name_length, body;
    uint8_t oid[F7_SHA1_SIZE];
    rc = f7_pkt_next(in, length, &pos, &kind, &off, &n);
    if (rc != F7_OK) return rc;
    if (kind == F7_PKT_FLUSH) break;
    line = in + off;
    /* Every v0 ref line is "<40hex> <name>[\0caps]\n". */
    if (n < F7_SHA1_HEX_SIZE + 3u || line[n - 1u] != (uint8_t)'\n' ||
        line[F7_SHA1_HEX_SIZE] != (uint8_t)' ') return F7_INVALID;
    if (n >= 8u && memcmp(line, "version ", 8u) == 0) return F7_INVALID;
    if (f7_sha1_from_hex(oid, line, F7_SHA1_HEX_SIZE) != F7_OK) return F7_INVALID;
    body = n - 1u;
    name = line + F7_SHA1_HEX_SIZE + 1u;
    nul = memchr(name, 0, body - (F7_SHA1_HEX_SIZE + 1u));
    if (first) {
      if (nul == NULL) return F7_INVALID;
      advert->caps_offset = (size_t)(nul + 1 - in);
      advert->caps_length = (size_t)(line + body - (nul + 1));
      rc = parse_caps(nul + 1, advert->caps_length, advert);
      if (rc != F7_OK) return rc;
      name_length = (size_t)(nul - name);
    } else {
      if (nul != NULL) return F7_INVALID;
      name_length = body - (F7_SHA1_HEX_SIZE + 1u);
    }
    if (!valid_ref_name(name, name_length)) return F7_INVALID;
    if (first && bytes_equal(name, name_length, "capabilities^{}")) {
      static const uint8_t zero[F7_SHA1_SIZE] = { 0 };
      if (memcmp(oid, zero, F7_SHA1_SIZE) != 0) return F7_INVALID;
      advert->empty_repository = 1u;
      first = 0;
      continue;
    }
    /* capabilities^{} is valid only as the sole first line of an empty repository. */
    if (advert->empty_repository || bytes_equal(name, name_length, "capabilities^{}"))
      return F7_INVALID;
    first = 0;
    {
      uint32_t i;
      for (i = 0; i < advert->ref_count; ++i)
        if (refs[i].name_length == name_length &&
            memcmp(in + refs[i].name_offset, name, name_length) == 0) return F7_INVALID;
    }
    if (advert->ref_count >= ref_capacity) return F7_OVERFLOWED;
    refs[advert->ref_count].name_offset = (size_t)(name - in);
    refs[advert->ref_count].name_length = name_length;
    memcpy(refs[advert->ref_count].oid, oid, F7_SHA1_SIZE);
    advert->ref_count++;
  }
  /* Transport EOF must follow the terminal flush exactly. */
  return pos == length ? F7_OK : F7_INVALID;
}

int f7_upload_request_build(const uint8_t *advert_bytes, const struct f7_advert *advert,
    const struct f7_advert_ref *refs, const uint8_t *refname, size_t refname_length,
    const uint8_t want[F7_SHA1_SIZE], uint8_t *out, size_t capacity, size_t *written) {
  uint8_t line[70];
  size_t used = 0u, part = 0u;
  uint32_t i, matches = 0u;
  int rc;
  if (written != NULL) *written = 0u;
  if (written == NULL || advert_bytes == NULL || advert == NULL || refname == NULL ||
      want == NULL || out == NULL || (refs == NULL && advert->ref_count != 0u))
    return F7_INVALID;
  /* Only advertised supported capabilities may be requested; absence rejects. */
  if (!advert->side_band_64k || !advert->ofs_delta || advert->empty_repository)
    return F7_INVALID;
  for (i = 0; i < advert->ref_count; ++i) {
    if (refs[i].name_length != refname_length ||
        memcmp(advert_bytes + refs[i].name_offset, refname, refname_length) != 0) continue;
    ++matches;
    if (memcmp(refs[i].oid, want, F7_SHA1_SIZE) != 0) return F7_IDENTITY_MISMATCH;
  }
  if (matches != 1u) return F7_IDENTITY_MISMATCH;
  if (capacity < F7_UPLOAD_REQUEST_SIZE) return F7_OVERFLOWED;
  memcpy(line, "want ", 5u);
  f7_sha1_hex((char *)line + 5, want);
  memcpy(line + 45, " side-band-64k ofs-delta\n", 25u);
  rc = f7_pkt_encode(line, sizeof line, out, capacity, &part);
  if (rc != F7_OK) return rc;
  used = part;
  memcpy(out + used, "0000", 4u);
  used += 4u;
  rc = f7_pkt_encode((const uint8_t *)"done\n", 5u, out + used, capacity - used, &part);
  if (rc != F7_OK) return rc;
  used += part;
  *written = used;
  return used == F7_UPLOAD_REQUEST_SIZE ? F7_OK : F7_INVALID;
}

/** Append bytes to a bounded retained buffer, keeping the admissible prefix. */
static int retain(uint8_t *buffer, size_t capacity, size_t *used,
    const uint8_t *data, size_t length) {
  size_t room = capacity - *used;
  if (length > room) {
    if (room != 0u) memcpy(buffer + *used, data, room);
    *used += room;
    return F7_OVERFLOWED;
  }
  if (length != 0u) memcpy(buffer + *used, data, length);
  *used += length;
  return F7_OK;
}

int f7_upload_response_parse(const uint8_t *in, size_t length,
    uint8_t *pack, size_t pack_capacity, uint8_t *progress, size_t progress_capacity,
    uint8_t *error, size_t error_capacity, struct f7_upload_response *response) {
  enum f7_pkt_kind kind;
  size_t pos = 0u, off, n;
  int rc;
  if (response == NULL) return F7_INVALID;
  memset(response, 0, sizeof *response);
  if (in == NULL || (pack == NULL && pack_capacity != 0u) ||
      (progress == NULL && progress_capacity != 0u) ||
      (error == NULL && error_capacity != 0u)) return F7_INVALID;
  rc = f7_pkt_next(in, length, &pos, &kind, &off, &n);
  if (rc != F7_OK) return rc;
  /* No haves were sent: terminal NAK must precede any sideband data. */
  if (kind != F7_PKT_DATA || !bytes_equal(in + off, n, "NAK\n")) return F7_INVALID;
  response->nak_seen = 1u;
  for (;;) {
    uint8_t channel;
    rc = f7_pkt_next(in, length, &pos, &kind, &off, &n);
    if (rc != F7_OK) return rc;
    if (kind == F7_PKT_FLUSH) { response->flush_seen = 1u; break; }
    response->data_packets++;
    /* A sideband pkt carries one channel byte plus at least one payload byte. */
    if (n < 2u) return F7_INVALID;
    channel = in[off];
    if (channel == 1u) {
      rc = retain(pack, pack_capacity, &response->pack_length, in + off + 1u, n - 1u);
      if (rc != F7_OK) return rc;
    } else if (channel == 2u) {
      rc = retain(progress, progress_capacity, &response->progress_length, in + off + 1u, n - 1u);
      if (rc != F7_OK) return rc;
    } else if (channel == 3u) {
      /* Remote error stays private and typed; it always rejects readback. */
      (void)retain(error, error_capacity, &response->error_length, in + off + 1u, n - 1u);
      return F7_INVALID;
    } else {
      return F7_INVALID;
    }
  }
  if (pos != length || response->pack_length == 0u) return F7_INVALID;
  return F7_OK;
}

int f7_receive_request_build(const struct f7_advert *advert,
    const uint8_t new_oid[F7_SHA1_SIZE], const uint8_t *pack, size_t pack_length,
    uint8_t *out, size_t capacity, size_t *written) {
  uint8_t line[122];
  size_t part = 0u, pos;
  if (written != NULL) *written = 0u;
  if (written == NULL || advert == NULL || new_oid == NULL || pack == NULL ||
      pack_length == 0u || out == NULL) return F7_INVALID;
  /* Branch absence: only a zero-id capabilities^{} advertisement qualifies. */
  if (!advert->empty_repository || advert->ref_count != 0u || !advert->report_status)
    return F7_INVALID;
  if (pack_length > SIZE_MAX - F7_RECEIVE_COMMAND_SIZE ||
      capacity < F7_RECEIVE_COMMAND_SIZE + pack_length) return F7_OVERFLOWED;
  memset(line, '0', F7_SHA1_HEX_SIZE);
  line[40] = (uint8_t)' ';
  f7_sha1_hex((char *)line + 41, new_oid);
  line[81] = (uint8_t)' ';
  memcpy(line + 82, F7_BOOTSTRAP_REF, F7_BOOTSTRAP_REF_LENGTH);
  line[107] = 0u;
  memcpy(line + 108, "report-status\n", 14u);
  if (f7_pkt_encode(line, sizeof line, out, capacity, &part) != F7_OK) return F7_INVALID;
  pos = part;
  memcpy(out + pos, "0000", 4u);
  pos += 4u;
  memcpy(out + pos, pack, pack_length);
  pos += pack_length;
  *written = pos;
  return pos == F7_RECEIVE_COMMAND_SIZE + pack_length ? F7_OK : F7_INVALID;
}

int f7_report_status_parse(const uint8_t *in, size_t length,
    struct f7_report_status *status) {
  enum f7_pkt_kind kind;
  size_t pos = 0u, off, n;
  int rc;
  if (status == NULL) return F7_INVALID;
  memset(status, 0, sizeof *status);
  if (in == NULL) return F7_INVALID;
  rc = f7_pkt_next(in, length, &pos, &kind, &off, &n);
  if (rc != F7_OK) return rc;
  if (kind != F7_PKT_DATA || n < 7u || memcmp(in + off, "unpack ", 7u) != 0) return F7_INVALID;
  if (!bytes_equal(in + off, n, "unpack ok\n")) return F7_INVALID;
  status->unpack_ok = 1u;
  rc = f7_pkt_next(in, length, &pos, &kind, &off, &n);
  if (rc != F7_OK) return rc;
  if (kind != F7_PKT_DATA) return F7_INVALID;
  if (n >= 3u && memcmp(in + off, "ng ", 3u) == 0) { status->ref_rejected = 1u; return F7_INVALID; }
  if (!bytes_equal(in + off, n, "ok " F7_BOOTSTRAP_REF "\n")) return F7_INVALID;
  status->ref_ok = 1u;
  rc = f7_pkt_next(in, length, &pos, &kind, &off, &n);
  if (rc != F7_OK) return rc;
  if (kind != F7_PKT_FLUSH) return F7_INVALID;
  status->flush_seen = 1u;
  return pos == length ? F7_OK : F7_INVALID;
}
