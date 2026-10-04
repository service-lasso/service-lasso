#ifndef SERVICE_LASSO_F7_CHILD_WITNESS_H
#define SERVICE_LASSO_F7_CHILD_WITNESS_H
#include "witness.h"
#ifdef __cplusplus
extern "C" {
#endif
struct f7_child_exit {
 int observed;
 uint64_t native_pid;
 int64_t wait_result,exit_status,exit_kind,native_error;
};
/* Observe ONLY the original retained native child lifetime. Neither a caller
   PID nor JS close/transport EOF can replace this held process/pidfd wait. */
int f7_child_exit_linux(f7_handle original_pidfd,struct f7_child_exit *out);
int f7_child_exit_windows(f7_handle original_process,struct f7_child_exit *out);
int f7_child_exit_record(struct f7_witness_sink *sink,const struct f7_child_exit *exit);
#ifdef __cplusplus
}
#endif
#endif
