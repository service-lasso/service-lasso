#include "observer.h"
#include <string.h>
#include <stdlib.h>
static int present(const uint8_t *bytes,size_t length){uint8_t found=0;for(size_t i=0;i<length;i++)found|=bytes[i];return found!=0;}
static int storage_geometry(const struct f7_capture *c,const void *output,size_t output_bytes){
 struct span {uintptr_t address;size_t length;};struct span spans[49];size_t count=0;
#define ADD_SPAN(pointer,bytes) do {if(!(pointer)||!(bytes)||count==49)return F7_BUDGET_ABSENT; \
 spans[count].address=(uintptr_t)(pointer);spans[count++].length=(bytes);} while(0)
 ADD_SPAN(c,sizeof(*c));ADD_SPAN(c->reservation,sizeof(*c->reservation));
 ADD_SPAN(c->witness,sizeof(*c->witness));ADD_SPAN(c->witness->member,sizeof(*c->witness->member));
 ADD_SPAN(c->witness->record_buffer,c->witness->record_capacity);
 ADD_SPAN(c->witness->emergency_member,sizeof(*c->witness->emergency_member));
 ADD_SPAN(c->witness->member->readback_storage,c->witness->member->readback_capacity);
 ADD_SPAN(c->witness->emergency_member->readback_storage,c->witness->emergency_member->readback_capacity);
 if(c->witness->member->readback_capacity>F7_FRAME_MAX||
    c->witness->emergency_member->readback_capacity>F7_FRAME_MAX)return F7_BUDGET_ABSENT;
#ifndef _WIN32
 ADD_SPAN(c->original_error_peer,sizeof(*c->original_error_peer));
 ADD_SPAN(c->error_receive_fact,sizeof(*c->error_receive_fact));
 ADD_SPAN(c->error_control,c->error_control_capacity);
#endif
 if(output||output_bytes){ADD_SPAN(output,output_bytes);}
 if(c->error_channel){ADD_SPAN(c->error_channel,sizeof(*c->error_channel));
  ADD_SPAN(c->error_channel->payload,c->error_channel->payload_capacity);
  if(c->error_channel->partial){ADD_SPAN(c->error_channel->partial,sizeof(*c->error_channel->partial));
   ADD_SPAN(c->error_channel->partial->bytes,c->error_channel->partial->capacity);}}
 for(unsigned i=0;i<F7_STREAM_COUNT+2;i++){
  const struct f7_async_memory *m;
  if(i<F7_STREAM_COUNT){if(c->created[i]!=F7_CREATED)continue;
   ADD_SPAN(c->raw[i],sizeof(*c->raw[i]));
   ADD_SPAN(c->raw[i]->readback_storage,c->raw[i]->readback_capacity);
   if(c->raw[i]->readback_capacity>F7_FRAME_MAX)return F7_BUDGET_ABSENT;
   ADD_SPAN(c->drain_buffer[i],c->drain_capacity[i]);m=&c->raw_memory[i];}
  else m=i==F7_STREAM_COUNT?&c->witness_memory:&c->emergency_memory;
  if(c->prepared){
   const struct f7_async_spool *queue=i<F7_STREAM_COUNT?c->raw_async[i]:
    i==F7_STREAM_COUNT?c->witness->async:c->witness->emergency_async;
   if((const void *)queue!=m->state)return F7_CONFLICT;
  }
  if(m->state_bytes<f7_async_state_bytes()||!m->stack_bytes)return F7_BUDGET_ABSENT;
  ADD_SPAN(m->state,m->state_bytes);ADD_SPAN(m->ring,m->ring_bytes);ADD_SPAN(m->write_buffer,m->write_bytes);
 }
#ifdef _WIN32
 if(c->native_drain_storage_bytes<f7_capture_windows_drain_state_bytes())return F7_BUDGET_ABSENT;
 ADD_SPAN(c->native_drain_storage,c->native_drain_storage_bytes);
#endif
 for(size_t i=0;i<count;i++){
  if(spans[i].length>UINTPTR_MAX-spans[i].address)return F7_INVALID;
  for(size_t j=0;j<i;j++)if(!(spans[i].address+spans[i].length<=spans[j].address||
   spans[j].address+spans[j].length<=spans[i].address))return F7_CONFLICT;
 }
#undef ADD_SPAN
 /* Explicit disjoint source storage is necessary, never sufficient proof
    of admitted allocation/rounded kernel charge or original actor custody. */
 return F7_OK;
}
int f7_capture_validate(const struct f7_capture *c){
 unsigned i;
 if(!c||!c->reservation||!c->witness||c->witness->reservation!=c->reservation||
 !c->witness->member||!c->witness->emergency_member||!c->witness->record_buffer||
 c->witness->record_capacity<F7_WITNESS_BYTES+32+F7_FRAME_MAX||
 (!c->prepared&&(c->witness->pending||c->witness->retained_record_bytes))||
 (!c->prepared&&(c->witness->member->failed||c->witness->member->finalized||
 c->witness->emergency_member->failed||c->witness->emergency_member->finalized))||
 c->witness->member->handle==F7_INVALID_HANDLE||
 c->witness->emergency_member->handle==F7_INVALID_HANDLE||
 !present(c->witness->invocation,16)||!present(c->witness->attempt,32)||!present(c->witness->lifetime,16)||
 c->witness->role!=F7_O||
 (!c->prepared&&(c->witness->failed||c->reservation->exhausted||c->incomplete||c->child_exit_observed))||
 (c->child_created!=F7_CREATED&&c->child_created!=F7_NOT_CREATED))return F7_INVALID;
 if(c->created[F7_PRIVATE_ERRORS]!=F7_CREATED)return F7_INVALID;
#ifndef _WIN32
 if(!c->original_error_peer||!c->error_receive_fact||!c->error_control||
    !c->error_control_capacity||c->error_control_capacity>F7_FRAME_MAX||
    c->original_error_peer->socket!=c->pipe[F7_PRIVATE_ERRORS])return F7_BUDGET_ABSENT;
#endif
 if(f7_identity_equal(&c->witness->member->identity,&c->witness->emergency_member->identity))return F7_CONFLICT;
 if((c->child_created==F7_CREATED&&c->original_child==F7_INVALID_HANDLE)||
   (c->child_created==F7_NOT_CREATED&&c->original_child!=F7_INVALID_HANDLE))return F7_INVALID;
 for(i=0;i<F7_STREAM_COUNT;i++){
  if(c->created[i]!=F7_CREATED&&c->created[i]!=F7_NOT_CREATED)return F7_INVALID;
  if(!c->prepared&&(c->natural_eof[i]||c->observed[i]||c->terminal_status[i]))return F7_CONFLICT;
  if(c->created[i]==F7_CREATED){
   if(!c->raw[i]||(!c->prepared&&(c->raw[i]->length||c->raw[i]->finalized||c->raw[i]->failed)))return F7_CONFLICT;
   if(c->pipe[i]==F7_INVALID_HANDLE||!present(c->witness->pipe_key[i],16)||
      f7_identity_equal(&c->raw[i]->identity,&c->witness->member->identity)||
      f7_identity_equal(&c->raw[i]->identity,&c->witness->emergency_member->identity))return F7_CONFLICT;
   for(unsigned j=0;j<i;j++)if(c->created[j]==F7_CREATED&&
      (f7_identity_equal(&c->raw[i]->identity,&c->raw[j]->identity)||
       !memcmp(c->witness->pipe_key[i],c->witness->pipe_key[j],16)))return F7_CONFLICT;
  }else if(c->raw[i]||c->pipe[i]!=F7_INVALID_HANDLE)return F7_INVALID;
 }
 if(c->created[F7_PRIVATE_ERRORS]==F7_CREATED){
  if(!c->error_channel||(!c->prepared&&(c->error_channel->failed||c->error_channel->frames))||
    !c->error_channel->payload||!c->error_channel->payload_capacity||!c->error_channel->partial||
    !c->error_channel->partial->bytes||c->error_channel->partial->capacity<F7_PARTIAL_HEADER+F7_PARTIAL_NODE||
    c->error_channel->partial->capacity>F7_PARTIAL_MAX||
    (!c->prepared&&(c->error_channel->partial->used||c->error_channel->partial->seen||
      c->error_channel->partial->complete||c->error_channel->partial->failed||c->error_channel->partial_message))||
    c->error_channel->payload_capacity>F7_FRAME_MAX||!c->error_channel->graph_node_limit||
    c->error_channel->role!=F7_W||!present(c->error_channel->lifetime,16)||
    memcmp(c->error_channel->invocation,c->witness->invocation,16)||
    memcmp(c->error_channel->attempt,c->witness->attempt,32))return F7_AUTH_FAILURE;
 }
 return F7_OK;
}
int f7_capture_output_storage_validate(const struct f7_capture *c,const void *output,size_t output_bytes){
 if(!output||!output_bytes)return F7_INVALID;
 int result=f7_capture_validate(c);if(result)return result;
 return storage_geometry(c,output,output_bytes);
}
int f7_capture_prepare(struct f7_capture *c){
 unsigned i;
 if(f7_capture_validate(c)||c->prepared||c->child_created!=F7_NOT_CREATED)return F7_INVALID;
 int shaped=storage_geometry(c,NULL,0);if(shaped)return shaped;
 /* Separate queue/buffer allocation is complete before READY. Partial
    construction failure retains every already-created writer/context. */
 for(i=0;i<F7_STREAM_COUNT;i++)if(c->created[i]==F7_CREATED){
  uint64_t queue=c->reservation->input.queue_bytes[i];
  if(queue<=8||queue>SIZE_MAX){c->incomplete=1;return F7_BUDGET_ABSENT;}
  size_t required=(size_t)(queue-8>F7_FRAME_MAX?F7_FRAME_MAX:queue-8);
  if(!c->drain_buffer[i]||c->drain_capacity[i]!=required||c->raw_memory[i].ring_bytes!=queue||
     f7_async_create(&c->raw_async[i],c->raw[i],&c->raw_memory[i],required)){
   c->incomplete=1;return F7_NATIVE_FAILURE;}
 }
 uint64_t queue=c->reservation->input.witness_queue_bytes;
 if(queue<F7_WITNESS_QUEUE_MIN||queue>SIZE_MAX||c->reservation->input.emergency_queue_bytes<F7_WITNESS_QUEUE_MIN||
    c->reservation->input.emergency_queue_bytes>SIZE_MAX){c->incomplete=1;return F7_BUDGET_ABSENT;}
 size_t chunk=(size_t)(queue-8>F7_WITNESS_BYTES+32+F7_FRAME_MAX?
   F7_WITNESS_BYTES+32+F7_FRAME_MAX:queue-8);
 if(c->witness_memory.ring_bytes!=queue||f7_async_create(&c->witness->async,c->witness->member,&c->witness_memory,chunk)){
  c->incomplete=1;return F7_NATIVE_FAILURE;}
 queue=c->reservation->input.emergency_queue_bytes;
 chunk=(size_t)(queue-8>F7_WITNESS_BYTES+32+F7_FRAME_MAX?
   F7_WITNESS_BYTES+32+F7_FRAME_MAX:queue-8);
 if(c->emergency_memory.ring_bytes!=queue||f7_async_create(&c->witness->emergency_async,c->witness->emergency_member,&c->emergency_memory,chunk)){
  c->incomplete=1;return F7_NATIVE_FAILURE;}
#ifdef _WIN32
 if(f7_capture_windows_prepare(c)){c->incomplete=1;return F7_NATIVE_FAILURE;}
#endif
 c->prepared=1;return F7_OK;
}
int f7_capture_settle(struct f7_capture *c,uint64_t deadline){
 unsigned i;int result=F7_OK;
 if(!c||!deadline)return F7_INVALID;
#ifdef _WIN32
 /* Drain producers may still be alive after a native read deadline. Never
    close their persistence inputs or race their witness sequence fields. */
 if(c->native_drains){
  f7_capture_windows_abort_prepared(c);
  if(f7_capture_windows_reap(c))return F7_INCOMPLETE;
 }
#endif
 for(i=0;i<F7_STREAM_COUNT;i++)if(c->raw_async[i]){
  if(f7_async_close_input(c->raw_async[i])||f7_async_wait(c->raw_async[i],deadline))result=F7_INCOMPLETE;
 }
 if(c->witness&&c->witness->async){
  if(f7_async_close_input(c->witness->async)||f7_async_wait(c->witness->async,deadline))result=F7_INCOMPLETE;
 }
 if(c->witness&&c->witness->emergency_async){
  if(f7_async_close_input(c->witness->emergency_async)||
     f7_async_wait(c->witness->emergency_async,deadline))result=F7_INCOMPLETE;
 }
 if(result)c->incomplete=1;
 /* No disposal/close/remove follows failure. Full source owner retains the
    heap context and members until actual writer lifetimes have settled. */
 return result;
}
int f7_capture_persistence_ready(struct f7_capture *c){
 if(!c||!c->prepared||!c->witness)return F7_BUDGET_ABSENT;
 struct f7_async_status status;
 for(unsigned i=0;i<F7_STREAM_COUNT+2;i++){
  struct f7_async_spool *q;
  if(i<F7_STREAM_COUNT){if(c->created[i]!=F7_CREATED)continue;q=c->raw_async[i];}
  else q=i==F7_STREAM_COUNT?c->witness->async:c->witness->emergency_async;
  if(!q)return F7_BUDGET_ABSENT;
  int result=f7_async_snapshot(q,&status);if(result)return result;
  if(status.failed||status.finished||status.joined||status.worker_created!=1||!status.worker_entered)return F7_INCOMPLETE;
 }
 return F7_OK;
}
