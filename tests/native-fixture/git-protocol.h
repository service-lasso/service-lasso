#ifndef SERVICE_LASSO_F7_GIT_PROTOCOL_H
#define SERVICE_LASSO_F7_GIT_PROTOCOL_H
#include <stddef.h>
#include <stdint.h>
#include "git-sha1.h"
#ifdef __cplusplus
extern "C" {
#endif

/*
 * U2 #1753 Git smart-HTTP v0 protocol codecs (SPEC-010 F7-04/F7-05).
 * Parses ORIGINAL captured bytes; builds the exact request bodies. No HTTP,
 * TLS, credential, broker or persistence behavior lives here (U2 integration,
 * still ABSENT). SOURCE ONLY / UNEXECUTED until whole review and NEW ROOT.
 */

/** pkt-line length includes its four lowercase hex header bytes. */
#define F7_PKT_MAX 65520u
#define F7_PKT_HEADER 4u
/** Exact upload-pack request: want pkt (74) + flush (4) + done pkt (9). */
#define F7_UPLOAD_REQUEST_SIZE 87u
/** Exact receive-pack command section: command pkt (126) + flush (4). */
#define F7_RECEIVE_COMMAND_SIZE 130u
/** The only bootstrap ref P may create (SPEC-010 B1). */
#define F7_BOOTSTRAP_REF "refs/heads/bootstrap-seed"
#define F7_BOOTSTRAP_REF_LENGTH 25u

enum f7_pkt_kind { F7_PKT_DATA = 1, F7_PKT_FLUSH = 2 };
enum f7_git_service { F7_SERVICE_UPLOAD_PACK = 1, F7_SERVICE_RECEIVE_PACK = 2 };

/**
 * Encode one data pkt-line. Empty payloads and totals above F7_PKT_MAX are
 * F7_INVALID; insufficient capacity is F7_OVERFLOWED.
 */
int f7_pkt_encode(const uint8_t *payload, size_t length, uint8_t *out,
  size_t capacity, size_t *written);

/**
 * Read the pkt-line at *pos. Strict lowercase hex. 0000 is flush; v2
 * delimiter 0001, response-end 0002, reserved 0003 and empty 0004 reject.
 * A declared length beyond the input is F7_INCOMPLETE. *pos advances only
 * on success.
 */
int f7_pkt_next(const uint8_t *in, size_t length, size_t *pos,
  enum f7_pkt_kind *kind, size_t *payload_offset, size_t *payload_length);

/** One advertised ref; name is an offset into the ORIGINAL advert bytes. */
struct f7_advert_ref {
  size_t name_offset, name_length;
  uint8_t oid[F7_SHA1_SIZE];
};

/** Closed facts from a v0 advertisement. */
struct f7_advert {
  uint32_t ref_count;
  uint32_t empty_repository;   /* zero-id capabilities^{} line only */
  uint32_t side_band_64k, ofs_delta, report_status;
  size_t caps_offset, caps_length;
};

/**
 * Parse "# service=git-<service>\n", flush, the ref list and final flush with
 * no trailing bytes. Rejects protocol "version" lines, missing LF, malformed
 * or duplicate ref names, object-format other than sha1, and refs beyond
 * ref_capacity (F7_OVERFLOWED). Ref names are raw bytes, never path authority.
 */
int f7_advert_parse(const uint8_t *in, size_t length, enum f7_git_service service,
  struct f7_advert_ref *refs, size_t ref_capacity, struct f7_advert *advert);

/**
 * Build the exact upload-pack v0 request for one full want:
 *   "want <hex> side-band-64k ofs-delta\n", flush, "done\n".
 * The advertisement must offer both capabilities and must advertise refname
 * with exactly want (F7_IDENTITY_MISMATCH otherwise). out needs
 * F7_UPLOAD_REQUEST_SIZE bytes.
 */
int f7_upload_request_build(const uint8_t *advert_bytes, const struct f7_advert *advert,
  const struct f7_advert_ref *refs, const uint8_t *refname, size_t refname_length,
  const uint8_t want[F7_SHA1_SIZE], uint8_t *out, size_t capacity, size_t *written);

/** Facts retained from an upload-pack response, on success or rejection. */
struct f7_upload_response {
  size_t pack_length, progress_length, error_length;
  uint32_t data_packets;
  uint32_t nak_seen, flush_seen;
};

/**
 * Demultiplex a complete captured upload-pack response: first pkt exactly
 * "NAK\n", then side-band-64k data pkts (1 = pack, 2 = progress, 3 = remote
 * error which rejects), one terminal flush, and transport EOF immediately
 * after. ACK/shallow/unknown channels/empty sideband payloads/trailing bytes
 * reject. Channel 1 beyond pack_capacity or channel 2/3 beyond their
 * capacities retains the prefix and returns F7_OVERFLOWED.
 */
int f7_upload_response_parse(const uint8_t *in, size_t length,
  uint8_t *pack, size_t pack_capacity, uint8_t *progress, size_t progress_capacity,
  uint8_t *error, size_t error_capacity, struct f7_upload_response *response);

/**
 * Build the P initial push body: one command pkt
 * "<40 zeros> <new-hex> refs/heads/bootstrap-seed\0report-status\n", flush,
 * then the exact admitted pack bytes. Requires an empty-repository advert
 * (no refs) offering report-status.
 */
int f7_receive_request_build(const struct f7_advert *advert,
  const uint8_t new_oid[F7_SHA1_SIZE], const uint8_t *pack, size_t pack_length,
  uint8_t *out, size_t capacity, size_t *written);

/** report-status facts; an incomplete response is an UNKNOWN push outcome. */
struct f7_report_status {
  uint32_t unpack_ok, ref_ok, ref_rejected, flush_seen;
};

/**
 * Parse report-status: exactly "unpack ok\n", "ok refs/heads/bootstrap-seed\n",
 * flush, EOF. "unpack <error>" / "ng ..." are F7_INVALID with facts retained.
 * Truncation is F7_INCOMPLETE and requires read-only reconciliation via G;
 * it never permits a retry, recreate, overwrite or force.
 */
int f7_report_status_parse(const uint8_t *in, size_t length,
  struct f7_report_status *status);

#ifdef __cplusplus
}
#endif
#endif
