#ifndef SERVICE_LASSO_F7_ERROR_PRODUCER_QUEUE_H
#define SERVICE_LASSO_F7_ERROR_PRODUCER_QUEUE_H
#include "capture-spool.h"
#ifdef __cplusplus
extern "C" {
#endif
#define F7_PRODUCER_NATIVE_CALLS 32u
enum f7_error_endpoint_kind {F7_LINUX_ERROR_SOCKET=1,F7_WINDOWS_ERROR_PIPE=2};
struct f7_error_endpoint {
 f7_handle write,original_peer,original_object_reference;
 enum f7_error_endpoint_kind kind;
 uint8_t original_object[24];
 int64_t original_peer_pid;uint64_t original_peer_uid,original_peer_gid;
};
struct f7_producer_native_call {uint64_t operation,argument;int64_t result,error;};
struct f7_producer_native_fact {
 struct f7_producer_native_call calls[F7_PRODUCER_NATIVE_CALLS];
 size_t count;uint64_t transferred;int exhausted;
};
struct f7_error_queue_memory {
 void *state;size_t state_bytes;
 uint8_t *normal,*emergency,*write_buffer,*native_history;
 size_t normal_bytes,emergency_bytes,write_capacity,stack_bytes,guard_bytes,native_history_bytes;
};
struct f7_error_queue_binding {
 uint8_t invocation[16],attempt[32],lifetime[16];uint16_t role;
 uint64_t frame_count,payload_bytes;uint32_t graph_node_limit;
 struct f7_error_endpoint endpoint;
};
struct f7_error_queue_status {
 uint64_t submitted,delivered,normal_queued,emergency_queued,in_flight,in_flight_delivered;
 int failed,closed,finished,joined,worker_created,worker_entered;int64_t native_status;
 uint64_t native_history_bytes;
 struct f7_producer_native_fact native_fact,construction_fact;
};
struct f7_error_queue;
/* Exact source-owned storage requirement, not allocation/admission/authority.
   Caller reserves all storage/stack/guard and original endpoint before READY.
   This private library cannot manufacture the authentic ROOT entry/binding. */
size_t f7_error_queue_state_bytes(void);
/* Pure storage preflight before serialization. It inspects the existing queue
   storage graph and never starts, admits, settles or authenticates a queue. */
int f7_error_queue_output_storage_validate(const struct f7_error_queue *queue,
 const void *output,size_t output_bytes);
uint16_t f7_error_queue_expected_role(const struct f7_error_queue *queue);
int f7_error_queue_start(struct f7_error_queue **out,const struct f7_error_queue_memory *memory,
 const struct f7_error_queue_binding *original_binding,int64_t *native_status);
/* Copies the entire immutable frame before returning. One dedicated native
   writer merges normal/emergency sequence order; no two writers share a pipe.
   Contention/full/failure never waits or reports capture/delivery success.
   Caller retains original VM objects and payload on every failed submission. */
int f7_error_queue_submit(struct f7_error_queue *queue,enum f7_payload_type type,
 const uint8_t *payload,size_t length,int emergency,uint64_t *ticket);
int f7_error_queue_close(struct f7_error_queue *queue);
int f7_error_queue_snapshot(struct f7_error_queue *queue,struct f7_error_queue_status *out);
/* Nonblocking actual-exit settlement only, never destruction of original
   endpoints, queued/in-flight bytes or source-owned buffers. */
int f7_error_queue_join_exited(struct f7_error_queue *queue,int64_t *native_status);
#ifdef __cplusplus
}
#endif
#endif
