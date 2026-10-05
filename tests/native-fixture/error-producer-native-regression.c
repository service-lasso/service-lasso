#include "error-producer-native-regression.h"
#include "error-graph.h"
#include <string.h>
int f7_producer_regression_submit(struct f7_error_queue *queue,
 const uint8_t *graph,size_t length,uint64_t *ticket){
 struct f7_error_queue_status before,after;uint64_t rejected=UINT64_MAX;
 if(!queue||!graph||!length||!ticket)return F7_INVALID;
 int result=f7_error_queue_snapshot(queue,&before);if(result)return result;
 if(!before.worker_entered||before.failed||before.closed)return F7_INCOMPLETE;
 /* An output located in the live queue must reject before a status write or
    native settlement call. This uses the eventual owning fixture's original
    queue; it never creates an endpoint, actor or synthetic ROOT receipt. */
 result=f7_error_queue_snapshot(queue,(struct f7_error_queue_status *)queue);
 if(result!=F7_CONFLICT)return F7_CONFLICT;
 result=f7_error_queue_join_exited(queue,(int64_t *)queue);
 if(result!=F7_CONFLICT)return F7_CONFLICT;
 /* Rejected type must neither accept a ticket nor change submitted count.
    Delivery may progress concurrently, so it is deliberately not compared. */
 result=f7_error_queue_submit(queue,F7_CONTROL_RECORD,graph,length,0,&rejected);
 if(result!=F7_INVALID||rejected!=UINT64_MAX)return F7_CONFLICT;
 result=f7_error_queue_snapshot(queue,&after);if(result)return result;
 if(after.submitted!=before.submitted)return F7_CONFLICT;
 return f7_error_queue_submit(queue,F7_ERROR_GRAPH,graph,length,0,ticket);
}
int f7_producer_regression_observed(struct f7_error_queue *queue,
 const struct f7_error_queue_binding *binding,const uint8_t *graph,
 size_t length,uint64_t ticket,const uint8_t *read,size_t read_length){
 struct f7_error_queue_status status;struct f7_frame frame;uint8_t correlation[16];
 if(!queue||!binding||!graph||!read||!ticket||length>F7_FRAME_MAX-F7_FRAME_HEADER_SIZE||
    read_length!=F7_FRAME_HEADER_SIZE+length)return F7_INVALID;
 int result=f7_error_graph_validate(graph,length,binding->graph_node_limit);if(result)return result;
 result=f7_frame_decode(&frame,read);if(result)return result;
 memcpy(correlation,binding->invocation,8);f7_u64be(correlation+8,ticket);
 if(frame.sequence!=ticket||frame.ordinal!=ticket||frame.role!=binding->role||
    frame.payload_type!=F7_ERROR_GRAPH||frame.payload_length!=length||
    memcmp(frame.invocation,binding->invocation,16)||memcmp(frame.attempt,binding->attempt,32)||
    memcmp(frame.lifetime,binding->lifetime,16)||memcmp(frame.correlation,correlation,16)||
    memcmp(read+F7_FRAME_HEADER_SIZE,graph,length))return F7_CONFLICT;
 result=f7_error_queue_snapshot(queue,&status);if(result)return result;
 if(status.failed||status.delivered<ticket||status.submitted<ticket)return F7_INCOMPLETE;
 /* Exact original receive and successful native write are separate facts.
    This check never issues original ROOT/actor admission or capture-complete. */
 return F7_OK;
}
int f7_producer_regression_failed_retained(struct f7_error_queue *queue,
 uint64_t submitted,uint64_t delivered,uint64_t pending){
 struct f7_error_queue_status status;
 if(!queue||delivered>submitted)return F7_INVALID;
 int result=f7_error_queue_snapshot(queue,&status);if(result)return result;
 if(!status.failed||!status.finished||status.submitted!=submitted||status.delivered!=delivered||
    status.in_flight_delivered>status.in_flight)return F7_CONFLICT;
 /* Ring bytes include their original sixteen-byte local queue headers.
    The owning fixture records this pre-failure amount, never infers it from
    a replay or reconstructs a lost payload to make a comparison pass. */
 uint64_t retained=status.normal_queued;
 if(status.emergency_queued>UINT64_MAX-retained)return F7_OVERFLOWED;
 retained+=status.emergency_queued;
 if(status.in_flight>UINT64_MAX-retained)return F7_OVERFLOWED;
 retained+=status.in_flight;
 return retained==pending?F7_OK:F7_CONFLICT;
}
