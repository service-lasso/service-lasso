#ifndef SERVICE_LASSO_F7_WITNESS_H
#define SERVICE_LASSO_F7_WITNESS_H
#include "capture-spool.h"
#include "budget-reservation.h"
#include "async-spool.h"
#ifdef __cplusplus
extern "C" {
#endif
/* Private fixed-format native read facts, not public diagnostic text. */
#define F7_WITNESS_BYTES 160u
struct f7_witness_sink {
 struct f7_member *member;
 struct f7_member *emergency_member;
 struct f7_reservation *reservation;
 struct f7_async_spool *async;
 struct f7_async_spool *emergency_async;
 uint8_t invocation[16],attempt[32],lifetime[16],pipe_key[F7_STREAM_COUNT][16];
 uint16_t role;
 uint64_t sequence,ordinal[F7_STREAM_COUNT];
 int failed;
};
int f7_witness_emit(struct f7_witness_sink *sink,enum f7_stream stream,
 enum f7_event event,uint64_t requested,uint64_t returned,uint64_t offset,
 const uint8_t *slice,int64_t status,int emergency);
struct f7_witness_expectation {
 uint8_t invocation[16],attempt[32],lifetime[16],pipe_key[F7_STREAM_COUNT][16];
 uint16_t role;uint64_t sequence,ordinal[F7_STREAM_COUNT];
};
struct f7_witness_view {
 enum f7_stream stream;enum f7_event event;
 uint64_t requested,returned,offset;int64_t native_status;
 const uint8_t *inline_bytes;size_t inline_length;
 uint8_t slice_sha256[32];
};
/* Structural/byte integrity only. Expectations belong to independently
   authenticated original custody, never a decoded manifest or signed-looking
   path. The owner merges normal/emergency records in their original sequence.
   For noninline raw reads, supply the independently read original raw slice.
   This function cannot establish that an OS call occurred or issue a role. */
int f7_witness_validate(struct f7_witness_expectation *expected,
 const uint8_t *record,size_t length,const uint8_t *original_slice,
 size_t original_length,struct f7_witness_view *out);
#ifdef __cplusplus
}
#endif
#endif
