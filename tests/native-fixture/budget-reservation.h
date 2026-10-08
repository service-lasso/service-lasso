#ifndef SERVICE_LASSO_F7_BUDGET_H
#define SERVICE_LASSO_F7_BUDGET_H
#include "protocol.h"
#ifdef __cplusplus
extern "C" {
#endif
/* All values come from the NEW exact admission, never environment/defaults. */
struct f7_budget_input {
  uint64_t original[F7_STREAM_COUNT], witness_bytes, manifest_bytes;
  uint64_t inventory_entries, emergency_bytes, queue_bytes[F7_STREAM_COUNT];
  uint64_t frame_count, transfer_milliseconds;
  uint64_t witness_queue_bytes, emergency_queue_bytes;
  uint8_t row_input_sha256[32], derivation_sha256[32];
};
struct f7_reservation {
  struct f7_budget_input input;
  uint64_t local_bytes, encrypted_bytes, segment_objects;
  uint64_t captured[F7_STREAM_COUNT], witness_used, emergency_used;
  uint64_t queue_high_water[F7_STREAM_COUNT];
  int exhausted;
};
int f7_budget_derive(struct f7_reservation *out,const struct f7_budget_input *in);
int f7_budget_take(struct f7_reservation *r,enum f7_stream stream,uint64_t n,
 uint64_t *accepted);
int f7_budget_witness(struct f7_reservation *r,uint64_t n,int emergency);
int f7_budget_queue(struct f7_reservation *r,enum f7_stream stream,uint64_t n);
int f7_checked_add(uint64_t a,uint64_t b,uint64_t *out);
int f7_checked_mul(uint64_t a,uint64_t b,uint64_t *out);
#ifdef __cplusplus
}
#endif
#endif
