#include "original-native-error-producer.h"
#include <string.h>
static int separate(const void *a,size_t an,const void *b,size_t bn){
 uintptr_t x=(uintptr_t)a,y=(uintptr_t)b;
 if((an&&!x)||(bn&&!y)||an>UINTPTR_MAX-x||bn>UINTPTR_MAX-y)return 0;
 return !an||!bn||x+an<=y||y+bn<=x;
}
int f7_original_native_error_produce(const struct f7_error_graph *graph,
 uint8_t *payload,size_t capacity,struct f7_error_queue *queue,
 struct f7_original_native_delivery *out){
 if(!graph||!payload||!capacity||capacity>F7_FRAME_MAX-F7_FRAME_HEADER_SIZE||!queue||!out)return F7_INVALID;
 int result=f7_error_graph_output_validate(graph,payload,capacity);if(result)return result;
 result=f7_error_graph_output_validate(graph,out,sizeof(*out));if(result)return result;
 result=f7_error_graph_output_validate(graph,queue,f7_error_queue_state_bytes());if(result)return result;
 result=f7_error_queue_output_storage_validate(queue,payload,capacity);if(result)return result;
 result=f7_error_queue_output_storage_validate(queue,out,sizeof(*out));if(result)return result;
 if(!separate(payload,capacity,out,sizeof(*out))||
    !separate(payload,capacity,queue,f7_error_queue_state_bytes())||
    !separate(out,sizeof(*out),queue,f7_error_queue_state_bytes()))return F7_CONFLICT;
 memset(out,0,sizeof(*out));out->original_graph=graph;
 out->serialization_result=F7_INCOMPLETE;out->submission_result=F7_INCOMPLETE;
 if(!graph->primary||graph->primary>graph->count||
    graph->nodes[graph->primary-1].kind!=F7_GRAPH_NATIVE)return F7_INVALID;
 for(uint32_t i=0;i<graph->count;i++)if(graph->nodes[i].kind==F7_GRAPH_NATIVE&&
    (!graph->nodes[i].original_native||!graph->nodes[i].original_native_length))return F7_INCOMPLETE;
 if(f7_error_queue_expected_role(queue)!=F7_W)return F7_AUTH_FAILURE;
 struct f7_error_queue_status status;
 result=f7_error_queue_snapshot(queue,&status);if(result)return result;
 if(status.failed||status.closed||status.worker_created!=1||!status.worker_entered)return F7_INCOMPLETE;
 result=f7_error_graph_encode(graph,payload,capacity,&out->serialized_bytes);
 out->serialization_result=result;if(result)return result;
 out->submission_result=f7_error_queue_submit(queue,F7_ERROR_GRAPH,payload,out->serialized_bytes,0,&out->ticket);
 return out->submission_result;
}
