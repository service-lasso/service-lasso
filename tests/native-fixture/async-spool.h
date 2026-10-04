#ifndef SERVICE_LASSO_F7_ASYNC_SPOOL_H
#define SERVICE_LASSO_F7_ASYNC_SPOOL_H
#include "capture-spool.h"
#ifdef __cplusplus
extern "C" {
#endif
struct f7_async_spool;
struct f7_async_status {
 uint64_t submitted,persisted,queued,high_water;
 uint64_t in_flight,in_flight_persisted;
 int64_t native_status;
 int failed,finished,joined;
};
/* Construct all queues BEFORE granting downstream READY. Each queue has a
   separate writer; a blocked file cannot hold any drain/control queue lock.
   The source-owned member and queue remain retained while a writer is live. */
int f7_async_create(struct f7_async_spool **out,struct f7_member *member,
 size_t reserved_queue_bytes,size_t maximum_chunk);
int f7_async_submit(struct f7_async_spool *queue,const uint8_t *bytes,size_t count);
int f7_async_close_input(struct f7_async_spool *queue);
int f7_async_snapshot(struct f7_async_spool *queue,struct f7_async_status *out);
int f7_async_wait(struct f7_async_spool *queue,uint64_t absolute_monotonic_ms);
/* Joins only an actually exited worker and retains queue bytes on failure. */
int f7_async_join_settled(struct f7_async_spool *queue);
/* Refuses disposal of any live worker. Timeout/failure is retained, not a
   license to free its memory, close its objects, or remove the spool. */
int f7_async_release_settled(struct f7_async_spool *queue);
#ifdef __cplusplus
}
#endif
#endif
