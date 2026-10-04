#include "original-error-producer.h"
#include <string.h>
extern "C" int f7_original_error_produce(napi_env env,napi_value primary,napi_value expected,
 const napi_value *secondary,size_t secondary_count,f7_original_error_workspace *workspace,
 uint8_t *payload,size_t capacity,f7_error_queue *queue,f7_original_error_delivery *out){
 if(!out)return F7_INVALID;memset(out,0,sizeof(*out));out->original.original_primary=primary;
 if(!queue||capacity>F7_FRAME_MAX-F7_FRAME_HEADER_SIZE)return F7_BUDGET_ABSENT;
 if(f7_error_queue_expected_role(queue)!=F7_W)return F7_AUTH_FAILURE;
 f7_error_queue_status status;int observed=f7_error_queue_snapshot(queue,&status);
 if(observed||status.failed||status.closed||status.worker_created!=1||!status.worker_entered)return F7_INCOMPLETE;
 int result=f7_original_error_encode(env,primary,expected,secondary,secondary_count,workspace,payload,capacity,&out->original);
 out->serialization_result=result;
 if(result==F7_OK){
  out->submission_result=f7_error_queue_submit(queue,F7_ERROR_GRAPH,payload,out->original.length,0,&out->ticket);
  return out->submission_result;
 }
 /* No Node-API call occurs between preserving the actual serialization
    exception and this native emergency enqueue; pending exception survives. */
 uint8_t fallback[96];memcpy(fallback,"SLF7SFB2",8);f7_u64be(fallback+8,(uint64_t)result);
 f7_u64be(fallback+16,(uint64_t)out->original.native_status);
 f7_u64be(fallback+24,(uint64_t)out->original.exception_query_status);
 f7_u64be(fallback+32,(uint64_t)out->original.exception_restore_status);
 f7_u64be(fallback+40,(uint64_t)out->original.identity_checked);
 f7_u64be(fallback+48,(uint64_t)out->original.identity_equal);
 f7_u64be(fallback+56,workspace?workspace->node_count:0);
 f7_u64be(fallback+64,(uint64_t)out->original.exception_keeper_status);
 f7_u64be(fallback+72,(uint64_t)out->original.keeper_exception_query_status);
 f7_u64be(fallback+80,(uint64_t)out->original.exception_keeper_result);
 f7_u64be(fallback+88,workspace?workspace->held_count:0);
 out->submission_result=f7_error_queue_submit(queue,F7_SERIALIZATION_FALLBACK,fallback,sizeof(fallback),1,&out->ticket);
 /* Original producer failure is never overwritten by enqueue status. Every
    original/pending object and partially captured arena remains caller-owned. */
 return result;
}
