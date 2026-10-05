#ifndef SERVICE_LASSO_F7_OBSERVER_H
#define SERVICE_LASSO_F7_OBSERVER_H
#include "witness.h"
#include "error-channel.h"
#include "child-witness.h"
#ifndef _WIN32
#include "error-peer-linux.h"
#endif
#ifdef __cplusplus
extern "C" {
#endif
enum f7_creation_decision {F7_CREATION_UNKNOWN=0,F7_CREATED=1,F7_NOT_CREATED=2};
struct f7_capture {
 struct f7_member *raw[F7_STREAM_COUNT];
 struct f7_witness_sink *witness;
 struct f7_reservation *reservation;
 struct f7_error_channel *error_channel;
#ifndef _WIN32
 struct f7_linux_error_peer *original_error_peer;
 struct f7_linux_receive_fact *error_receive_fact;
 uint8_t *error_control;size_t error_control_capacity;
#endif
 f7_handle original_child;
 enum f7_creation_decision child_created;
 int child_exit_observed;
 f7_handle pipe[F7_STREAM_COUNT];
 enum f7_creation_decision created[F7_STREAM_COUNT];
 int natural_eof[F7_STREAM_COUNT];
 uint64_t observed[F7_STREAM_COUNT];
 struct f7_async_spool *raw_async[F7_STREAM_COUNT];
 struct f7_async_memory raw_memory[F7_STREAM_COUNT],witness_memory,emergency_memory;
 uint8_t *drain_buffer[F7_STREAM_COUNT];
 size_t drain_capacity[F7_STREAM_COUNT];
 int prepared;
 void *native_drains;
 void *native_drain_storage;size_t native_drain_storage_bytes;
 size_t native_drain_stack[F7_STREAM_COUNT];
 int64_t native_prepare_status;
 int raw_lost[F7_STREAM_COUNT];
 int64_t terminal_status[F7_STREAM_COUNT];
 int incomplete;
};
/* Operates only original admitted read ends. No pathname, PID kill, launch,
   deletion, projection, callbacks, or transport pressure enters this loop. */
int f7_capture_linux(struct f7_capture *capture,uint64_t absolute_monotonic_ms);
int f7_capture_windows(struct f7_capture *capture,uint64_t absolute_tick_ms);
int f7_capture_validate(const struct f7_capture *capture);
/* Pure source-storage check for owning package/regression output. No actor
   admission, native observation or resource reservation is established. */
int f7_capture_output_storage_validate(const struct f7_capture *capture,
 const void *output,size_t output_bytes);
/* Prepare is called and successfully acknowledged BEFORE downstream launch.
   Capture refuses unprepared contexts; it never silently allocates on launch. */
int f7_capture_prepare(struct f7_capture *capture);
/* Nonblocking original worker readiness. Prepared storage/thread creation is
   insufficient. Owning ROOT still supplies source/actor/endpoint admission. */
int f7_capture_persistence_ready(struct f7_capture *capture);
int f7_capture_windows_start_prepared(struct f7_capture *capture);
int f7_capture_windows_ready(struct f7_capture *capture);
int f7_capture_settle(struct f7_capture *capture,uint64_t absolute_monotonic_ms);
/* Windows drain contexts are retained on deadline. Reap refuses live threads;
   the owner must retain capture and every referenced member until it succeeds. */
int f7_capture_windows_reap(struct f7_capture *capture);
int f7_capture_windows_prepare(struct f7_capture *capture);
size_t f7_capture_windows_drain_state_bytes(void);
int f7_capture_windows_abort_prepared(struct f7_capture *capture);
struct f7_capture_readbacks {
 f7_handle raw[F7_STREAM_COUNT],witness,emergency;
};
/* Finishes only after native producer and persistence worker exit. Independent
   read handles must be original pre-admitted companions, never duplicated RW
   descriptors or caller paths. Failure retains all surviving objects/queues. */
int f7_capture_finalize(struct f7_capture *capture,
 const struct f7_capture_readbacks *reads,uint64_t absolute_monotonic_ms,
 int64_t *native_status);
#ifdef __cplusplus
}
#endif
#endif
