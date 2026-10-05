#include "original-error-producer.h"
#include <string.h>
extern "C" int f7_original_error_produce(napi_env env,napi_value primary,napi_value expected,
 const napi_value *secondary,size_t secondary_count,f7_original_error_workspace *workspace,
 uint8_t *payload,size_t capacity,f7_error_queue *queue,f7_original_error_delivery *out){
 if(!out||!workspace||!queue)return F7_INVALID;
 int shape=f7_original_error_storage_validate(workspace,payload,capacity,secondary,secondary_count,
   out,sizeof(*out),queue,f7_error_queue_state_bytes());if(shape)return shape;
 if(!workspace->partial_fragment||workspace->fragment_capacity!=F7_FRAME_MAX-F7_FRAME_HEADER_SIZE)return F7_BUDGET_ABSENT;
 memset(out,0,sizeof(*out));out->original.original_primary=primary;
 if(workspace&&workspace->retained_incomplete){out->serialization_result=F7_CONFLICT;return F7_CONFLICT;}
 if(!queue||capacity>F7_FRAME_MAX-F7_FRAME_HEADER_SIZE)return F7_BUDGET_ABSENT;
 if(f7_error_queue_expected_role(queue)!=F7_W)return F7_AUTH_FAILURE;
 f7_error_queue_status status;int observed=f7_error_queue_snapshot(queue,&status);
 if(observed||status.failed||status.closed||status.worker_created!=1||!status.worker_entered)return F7_INCOMPLETE;
 int result=f7_original_error_encode(env,primary,expected,secondary,secondary_count,workspace,payload,capacity,&out->original);
 out->serialization_result=result;
 if(result==F7_OK){
  out->submission_result=f7_error_queue_submit(queue,F7_ERROR_GRAPH,payload,out->original.length,0,&out->ticket);
  if(out->submission_result)workspace->retained_incomplete=1;
  return out->submission_result;
 }
 /* No Node-API call occurs between preserving the actual serialization
    exception and this native emergency enqueue; pending exception survives. */
 /* Use the original reserved fragment workspace. Failed emergency submission
    retains these exact fallback bytes; no hidden automatic payload replaces it. */
 uint8_t *fallback=workspace->partial_fragment;
 memcpy(fallback,"SLF7SFB2",8);f7_u64be(fallback+8,(uint64_t)result);
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
 out->submission_result=f7_error_queue_submit(queue,F7_SERIALIZATION_FALLBACK,fallback,96,1,&out->ticket);
 /* Frozen known originals are materialized without any additional Node API
    or getter. Actual pending primary/secondary state remains untouched. */
 if(workspace&&workspace->retained_incomplete){
  f7_partial_graph_input known={workspace->nodes,workspace->node_progress,workspace->node_count,
   workspace->text,workspace->text_used,workspace->references,workspace->reference_used,
   workspace->primitive,workspace->primitive_used};
  out->partial_result=f7_partial_graph_encode(&known,workspace->partial_snapshot,
   workspace->partial_capacity,&workspace->partial_length);
  out->partial_bytes=workspace->partial_length;
  if(!out->partial_result&&!out->submission_result){
   uint8_t digest[32];crypto_hash_sha256(digest,workspace->partial_snapshot,workspace->partial_length);
   uint64_t count=workspace->partial_length/F7_PARTIAL_FRAGMENT_DATA+(workspace->partial_length%F7_PARTIAL_FRAGMENT_DATA!=0);
   for(uint64_t part=1;part<=count;part++){
    size_t length=0;uint64_t ticket=0;
    out->partial_result=f7_partial_fragment_encode(workspace->partial_fragment,workspace->fragment_capacity,&length,
     out->ticket,workspace->partial_snapshot,workspace->partial_length,part,digest);
    if(out->partial_result)break;
    out->partial_result=f7_error_queue_submit(queue,F7_KNOWN_PARTIAL_GRAPH,workspace->partial_fragment,length,0,&ticket);
    if(out->partial_result)break;out->partial_last_ticket=ticket;out->partial_fragments=part;
   }
  }
 }
 /* Original producer failure is never overwritten by enqueue status. Every
    original/pending object and partially captured arena remains caller-owned. */
 return result;
}
