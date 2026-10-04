#ifndef SERVICE_LASSO_F7_OBSERVER_H
#define SERVICE_LASSO_F7_OBSERVER_H
#include "witness.h"
#include "error-channel.h"
#ifdef __cplusplus
extern "C" {
#endif
struct f7_capture {
 struct f7_member *raw[F7_STREAM_COUNT];
 struct f7_witness_sink *witness;
 struct f7_reservation *reservation;
 struct f7_error_channel *error_channel;
 f7_handle pipe[F7_STREAM_COUNT];
 int created[F7_STREAM_COUNT],natural_eof[F7_STREAM_COUNT];
 uint64_t observed[F7_STREAM_COUNT];
 int64_t terminal_status[F7_STREAM_COUNT];
 int incomplete;
};
/* Operates only original admitted read ends. No pathname, PID kill, launch,
   deletion, projection, callbacks, or transport pressure enters this loop. */
int f7_capture_linux(struct f7_capture *capture,uint64_t absolute_monotonic_ms);
int f7_capture_windows(struct f7_capture *capture,uint64_t absolute_tick_ms);
#ifdef __cplusplus
}
#endif
#endif
