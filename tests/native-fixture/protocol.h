#ifndef SERVICE_LASSO_F7_PROTOCOL_H
#define SERVICE_LASSO_F7_PROTOCOL_H
#include <stdint.h>
#include <stddef.h>
#ifdef __cplusplus
extern "C" {
#endif

/* Private binary framing. Raw pipe members never contain these headers. */
#define F7_VERSION 1u
#define F7_FRAME_MAX 65536u
#define F7_SEGMENT_MAX UINT64_C(8388608)
#define F7_OBJECT_MAX 4096u
#define F7_JSON_INTEGER_MAX UINT64_C(9007199254740991)
#define F7_FRAME_HEADER_SIZE 112u

enum f7_role { F7_O=1, F7_RECOVERY=2, F7_T=3, F7_C=4, F7_P=5, F7_G=6,
  F7_S=7, F7_W=8, F7_M=9, F7_K=10, F7_R=11 };
enum f7_stream { F7_STDOUT=0, F7_STDERR=1, F7_PRIVATE_ERRORS=2,
  F7_CONTROL=3, F7_STREAM_COUNT=4 };
enum f7_state { F7_OBSERVER_ADMITTED=1, F7_ORIGINAL_CAPTURE=2,
  F7_LOCAL_READBACK=3, F7_CIPHERTEXT_READBACK_SIGNED=4,
  F7_REMOTE_READBACK=5, F7_RECEIVER_READBACK=6, F7_RECEIPT_VERIFIED=7,
  F7_RETAINED_UNRESOLVED=8 };
enum f7_event { F7_READ=1, F7_NATURAL_EOF=2, F7_READ_ERROR=3,
  F7_WRITE_ERROR=4, F7_OVERFLOW=5, F7_CHILD_EXIT=6, F7_WRITER_CLOSED=7,
  F7_FLUSH=8, F7_REOPEN_READBACK=9, F7_UNAVAILABLE=10,F7_CHILD_WAIT_PENDING=11,
  F7_READ_RETRY=12,F7_POLL_ERROR=13,F7_POLL_RETRY=14,F7_PIPE_FLAGS_ERROR=15,
  F7_POLL_INVALID=16,F7_PIPE_QUERY_ERROR=17 };
enum f7_payload_type { F7_ERROR_GRAPH=1,F7_SERIALIZATION_FALLBACK=2,
 F7_RAW_NATIVE_ERROR=3,F7_CONTROL_RECORD=4 };
enum f7_result { F7_OK=0, F7_INVALID=1, F7_OVERFLOWED=2,
  F7_NATIVE_FAILURE=3, F7_IDENTITY_MISMATCH=4, F7_BUDGET_ABSENT=5,
  F7_INCOMPLETE=6, F7_AUTH_FAILURE=7, F7_CONFLICT=8 };

struct f7_frame {
  uint8_t invocation[16], attempt[32], lifetime[16], correlation[16];
  uint64_t sequence, ordinal;
  uint32_t payload_length;
  uint16_t role, payload_type;
};
/* Exact fixed network order; no ABI structs, padding or native endianness. */
int f7_frame_encode(uint8_t out[F7_FRAME_HEADER_SIZE], const struct f7_frame *f);
int f7_frame_decode(struct f7_frame *f, const uint8_t in[F7_FRAME_HEADER_SIZE]);
int f7_sequence_accept(uint64_t *last, const struct f7_frame *f,
  const uint8_t invocation[16], const uint8_t attempt[32], uint16_t role);
int f7_state_advance(enum f7_state *state, enum f7_state next);
void f7_u64be(uint8_t out[8], uint64_t n);
uint64_t f7_read_u64be(const uint8_t in[8]);
#ifdef __cplusplus
}
#endif
#endif
