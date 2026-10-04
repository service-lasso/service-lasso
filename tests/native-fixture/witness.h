#ifndef SERVICE_LASSO_F7_WITNESS_H
#define SERVICE_LASSO_F7_WITNESS_H
#include "capture-spool.h"
#include "budget-reservation.h"
/* Private fixed-format native read facts, not public diagnostic text. */
#define F7_WITNESS_BYTES 160u
struct f7_witness_sink {
 struct f7_member *member;
 struct f7_reservation *reservation;
 uint8_t invocation[16],attempt[32],lifetime[16],pipe_key[F7_STREAM_COUNT][16];
 uint64_t sequence,ordinal[F7_STREAM_COUNT];
 int failed;
};
int f7_witness_emit(struct f7_witness_sink *sink,enum f7_stream stream,
 enum f7_event event,uint64_t requested,uint64_t returned,uint64_t offset,
 const uint8_t *slice,int64_t status,int emergency);
#endif
