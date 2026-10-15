#ifndef SERVICE_LASSO_F7_CHILD_WITNESS_H
#define SERVICE_LASSO_F7_CHILD_WITNESS_H
#include "witness.h"
#ifdef __cplusplus
extern "C" {
#endif
enum f7_child_disposition {F7_CHILD_UNKNOWN=0,F7_CHILD_INPUT_REJECTED=1,F7_CHILD_PENDING=2,
 F7_CHILD_OBSERVED=3,F7_CHILD_NATIVE_FAILURE=4,F7_CHILD_UNAVAILABLE=5};
struct f7_child_exit {
 int observed;
 uint64_t native_pid;
 int64_t wait_result,exit_status,exit_kind,native_error;
 enum f7_child_disposition disposition;
 uint64_t native_calls;
 uint8_t native_record[F7_CHILD_NATIVE_MAX];size_t native_record_length;
};
/* Observe ONLY the original retained native child lifetime. Neither a caller
   PID nor JS close/transport EOF can replace this held process/pidfd wait. */
int f7_child_exit_linux(f7_handle original_pidfd,struct f7_child_exit *out);
int f7_child_exit_windows(f7_handle original_process,struct f7_child_exit *out);
int f7_child_exit_record(struct f7_witness_sink *sink,const struct f7_child_exit *exit);
/* Decode retained private facts without establishing an original process,
   native call or birth/exit authority. Exact native bytes remain opaque until
   the independent owner binds their admitted native ABI/source provenance. */
int f7_child_exit_decode(const uint8_t *bytes,size_t length,struct f7_child_exit *out);
#ifdef __cplusplus
}
#endif
#endif
