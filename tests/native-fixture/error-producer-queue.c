#define _GNU_SOURCE
#include "error-producer-queue.h"
#include "error-producer-endpoint.h"
#include "error-graph.h"
#include "serialization-fallback.h"
#include "partial-error.h"
#include <string.h>
#ifndef _WIN32
#include <pthread.h>
#include <errno.h>
#endif
struct lane {uint8_t *bytes;size_t capacity,head,used;};
struct f7_error_queue {
 struct f7_error_queue_binding binding;struct lane normal,emergency;
 uint8_t *write_buffer;size_t write_capacity;
 uint8_t *native_history;size_t native_history_capacity,native_history_used;
 struct f7_error_queue_status status;uint64_t sequence,payload_bytes;
 int lock_ready,condition_ready;
#ifdef _WIN32
 CRITICAL_SECTION lock;CONDITION_VARIABLE condition;HANDLE worker;
#else
 pthread_mutex_t lock;pthread_cond_t condition;pthread_t worker;
#endif
};
size_t f7_error_queue_state_bytes(void){return sizeof(struct f7_error_queue);}
uint16_t f7_error_queue_expected_role(const struct f7_error_queue *q){return q?q->binding.role:0;}
static int lock_try(struct f7_error_queue *q){
 if(!q->lock_ready)return F7_INCOMPLETE;
#ifdef _WIN32
 return TryEnterCriticalSection(&q->lock)?F7_OK:F7_INCOMPLETE;
#else
 return pthread_mutex_trylock(&q->lock)?F7_INCOMPLETE:F7_OK;
#endif
}
static void lock(struct f7_error_queue *q){
#ifdef _WIN32
 EnterCriticalSection(&q->lock);
#else
 pthread_mutex_lock(&q->lock);
#endif
}
static void unlock(struct f7_error_queue *q){
#ifdef _WIN32
 LeaveCriticalSection(&q->lock);
#else
 pthread_mutex_unlock(&q->lock);
#endif
}
static void wake(struct f7_error_queue *q){
#ifdef _WIN32
 WakeAllConditionVariable(&q->condition);
#else
 pthread_cond_broadcast(&q->condition);
#endif
}
static void put(struct lane *lane,const uint8_t *bytes,size_t n){
 size_t tail=(lane->head+lane->used)%lane->capacity,first=lane->capacity-tail;
 if(first>n)first=n;memcpy(lane->bytes+tail,bytes,first);
 if(n>first)memcpy(lane->bytes,bytes+first,n-first);lane->used+=n;
}
static void peek(const struct lane *lane,uint8_t *bytes,size_t n){
 size_t first=lane->capacity-lane->head;if(first>n)first=n;
 memcpy(bytes,lane->bytes+lane->head,first);if(n>first)memcpy(bytes+first,lane->bytes,n-first);
}
static void take(struct lane *lane,uint8_t *bytes,size_t n){
 peek(lane,bytes,n);lane->head=(lane->head+n)%lane->capacity;lane->used-=n;
}
static void history(struct f7_error_queue *q,uint64_t sequence,uint64_t length,
 int result,const struct f7_producer_native_fact *fact){
 uint8_t *out=q->native_history+q->native_history_used;
 memcpy(out,"SLF7EFC1",8);f7_u64be(out+8,sequence);f7_u64be(out+16,length);
 f7_u64be(out+24,(uint64_t)result);f7_u64be(out+32,fact->transferred);f7_u64be(out+40,fact->count);
 for(size_t i=0;i<fact->count;i++){
  const struct f7_producer_native_call *call=fact->calls+i;uint8_t *record=out+48+i*32;
  f7_u64be(record,call->operation);f7_u64be(record+8,call->argument);
  f7_u64be(record+16,(uint64_t)call->result);f7_u64be(record+24,(uint64_t)call->error);
 }
 q->native_history_used+=48+fact->count*32;q->status.native_history_bytes=q->native_history_used;
}
#ifdef _WIN32
static DWORD WINAPI writer(LPVOID value){
#else
static void *writer(void *value){
#endif
 struct f7_error_queue *q=value;
 lock(q);q->status.worker_entered=1;wake(q);unlock(q);
 for(;;){
  uint8_t header[16],other[16];uint64_t length,sequence;
  lock(q);
  while(!q->normal.used&&!q->emergency.used&&!q->status.closed&&!q->status.failed){
#ifdef _WIN32
   if(!SleepConditionVariableCS(&q->condition,&q->lock,INFINITE)){
    q->status.native_status=GetLastError();q->status.failed=1;}
#else
   int waited=pthread_cond_wait(&q->condition,&q->lock);
   if(waited){q->status.native_status=waited;q->status.failed=1;}
#endif
  }
  if(q->status.failed||(!q->normal.used&&!q->emergency.used&&q->status.closed)){
   q->status.finished=1;wake(q);unlock(q);break;}
  struct lane *lane=q->normal.used?&q->normal:&q->emergency;
  if(lane->used<16){q->status.failed=q->status.finished=1;unlock(q);break;}
  peek(lane,header,16);
  if(q->normal.used&&q->emergency.used){
   if(q->emergency.used<16){q->status.failed=q->status.finished=1;unlock(q);break;}
   peek(&q->emergency,other,16);
   if(f7_read_u64be(other)<f7_read_u64be(header)){lane=&q->emergency;memcpy(header,other,16);}
  }
  sequence=f7_read_u64be(header);length=f7_read_u64be(header+8);
  if(!sequence||sequence!=q->status.delivered+1||length<F7_FRAME_HEADER_SIZE||
     length>q->write_capacity||length>lane->used-16){q->status.failed=q->status.finished=1;unlock(q);break;}
  take(lane,header,16);take(lane,q->write_buffer,(size_t)length);
  q->status.in_flight=length;q->status.in_flight_delivered=0;wake(q);unlock(q);
  if(q->native_history_capacity-q->native_history_used<48+F7_PRODUCER_NATIVE_CALLS*32){
   lock(q);q->status.failed=q->status.finished=1;wake(q);unlock(q);break;
  }
  struct f7_producer_native_fact fact;
  /* Original payload and control continue independently of native I/O. A
     blocked Windows pipe affects this writer only; all buffers stay retained. */
  memset(&fact,0,sizeof(fact));int result=f7_error_endpoint_write(&q->binding.endpoint,q->write_buffer,(size_t)length,&fact);
  lock(q);q->status.native_fact=fact;q->status.in_flight_delivered=fact.transferred;
  history(q,sequence,length,result,&fact);
  if(result){q->status.failed=q->status.finished=1;
   if(fact.count)q->status.native_status=fact.calls[fact.count-1].error;
   wake(q);unlock(q);break;}
  q->status.delivered=sequence;q->status.in_flight=q->status.in_flight_delivered=0;unlock(q);
 }
 return 0;
}
static int nonzero(const uint8_t *p,size_t n){uint8_t value=0;for(size_t i=0;i<n;i++)value|=p[i];return value!=0;}
static int apart(const void *a,size_t an,const void *b,size_t bn){
 uintptr_t av=(uintptr_t)a,bv=(uintptr_t)b;
 if(an>UINTPTR_MAX-av||bn>UINTPTR_MAX-bv)return 0;
 return av+an<=bv||bv+bn<=av;
}
static int output_apart(const struct f7_error_queue *q,const void *out,size_t bytes){
 /* Snapshot/result outputs cannot overwrite queued originals, in-flight
    bytes, exact native history, synchronization state or endpoint binding. */
 return out&&bytes&&apart(out,bytes,q,sizeof(*q))&&
  apart(out,bytes,q->normal.bytes,q->normal.capacity)&&
  apart(out,bytes,q->emergency.bytes,q->emergency.capacity)&&
  apart(out,bytes,q->write_buffer,q->write_capacity)&&
  apart(out,bytes,q->native_history,q->native_history_capacity);
}
static int geometry(const struct f7_error_queue_memory *memory,const struct f7_error_queue_binding *binding,
 struct f7_error_queue **out,int64_t *native){
 struct span {uintptr_t address;size_t length;};
 struct span spans[]={
  {(uintptr_t)memory->state,memory->state_bytes},{(uintptr_t)memory->normal,memory->normal_bytes},
  {(uintptr_t)memory->emergency,memory->emergency_bytes},{(uintptr_t)memory->write_buffer,memory->write_capacity},
  {(uintptr_t)memory->native_history,memory->native_history_bytes},
  {(uintptr_t)memory,sizeof(*memory)},{(uintptr_t)binding,sizeof(*binding)},
  {(uintptr_t)out,sizeof(*out)},{(uintptr_t)native,sizeof(*native)}
 };
 for(size_t i=0;i<sizeof(spans)/sizeof(spans[0]);i++){
  if(spans[i].length>UINTPTR_MAX-spans[i].address)return F7_INVALID;
  for(size_t j=0;j<i;j++)if(!(spans[i].address+spans[i].length<=spans[j].address||
    spans[j].address+spans[j].length<=spans[i].address))return F7_INVALID;
 }
 return F7_OK;
}
int f7_error_queue_start(struct f7_error_queue **out,const struct f7_error_queue_memory *memory,
 const struct f7_error_queue_binding *binding,int64_t *native){
 if(!out||!memory||!binding||!native)return F7_INVALID;
 int shaped=geometry(memory,binding,out,native);if(shaped)return shaped;
 *out=NULL;*native=0;
 if(!memory->state||memory->state_bytes<sizeof(struct f7_error_queue)||
    (uintptr_t)memory->state%_Alignof(struct f7_error_queue)||
    !memory->normal||!memory->emergency||!memory->write_buffer||!memory->native_history||
    memory->native_history_bytes<48+F7_PRODUCER_NATIVE_CALLS*32||
    memory->write_capacity<F7_FRAME_HEADER_SIZE||memory->write_capacity>F7_FRAME_MAX||
    memory->normal_bytes<memory->write_capacity+16||memory->emergency_bytes<memory->write_capacity+16||
    memory->normal_bytes>SIZE_MAX/2||memory->emergency_bytes>SIZE_MAX/2||!memory->stack_bytes||
    !binding->frame_count||binding->frame_count>F7_JSON_INTEGER_MAX||
    !binding->payload_bytes||binding->payload_bytes>F7_JSON_INTEGER_MAX||
    !binding->graph_node_limit||binding->graph_node_limit>(F7_FRAME_MAX-24)/32||
    binding->role<F7_O||binding->role>F7_R||!nonzero(binding->invocation,16)||
    !nonzero(binding->attempt,32)||!nonzero(binding->lifetime,16))return F7_BUDGET_ABSENT;
#ifdef _WIN32
 if(binding->endpoint.kind!=F7_WINDOWS_ERROR_PIPE||!binding->endpoint.write||
    binding->endpoint.write==INVALID_HANDLE_VALUE||!binding->endpoint.original_peer||
    binding->endpoint.original_peer==INVALID_HANDLE_VALUE||!binding->endpoint.original_object_reference||
    binding->endpoint.original_object_reference==INVALID_HANDLE_VALUE||
    binding->endpoint.original_peer_pid<=0||binding->endpoint.original_peer_pid>MAXDWORD)return F7_INVALID;
#else
 if(binding->endpoint.kind!=F7_LINUX_ERROR_SOCKET||!memory->guard_bytes||binding->endpoint.write<0||
    binding->endpoint.original_peer<0||binding->endpoint.original_object_reference<0||
    binding->endpoint.original_peer_pid<=0||!nonzero(binding->endpoint.original_object,24))return F7_INVALID;
#endif
 struct f7_error_queue *q=memory->state;memset(q,0,sizeof(*q));*out=q;
 q->binding=*binding;q->normal.bytes=memory->normal;q->normal.capacity=memory->normal_bytes;
 q->emergency.bytes=memory->emergency;q->emergency.capacity=memory->emergency_bytes;
 q->write_buffer=memory->write_buffer;q->write_capacity=memory->write_capacity;q->status.worker_created=2;
 q->native_history=memory->native_history;q->native_history_capacity=memory->native_history_bytes;
#ifdef _WIN32
 BOOL initialized=InitializeCriticalSectionEx(&q->lock,0,0);*native=initialized?0:GetLastError();
 f7_error_endpoint_call(&q->status.construction_fact,13,0,initialized,*native);
 if(!initialized)goto failure;
 q->lock_ready=1;InitializeConditionVariable(&q->condition);q->condition_ready=1;
 q->worker=CreateThread(NULL,memory->stack_bytes,writer,q,STACK_SIZE_PARAM_IS_A_RESERVATION,NULL);
 *native=q->worker?0:GetLastError();
 f7_error_endpoint_call(&q->status.construction_fact,14,memory->stack_bytes,q->worker?1:0,*native);
 if(!q->worker)goto failure;
#else
 int result=pthread_mutex_init(&q->lock,NULL);f7_error_endpoint_call(&q->status.construction_fact,15,0,result,result);
 if(result){*native=result;goto failure;}
 q->lock_ready=1;result=pthread_cond_init(&q->condition,NULL);
 f7_error_endpoint_call(&q->status.construction_fact,16,0,result,result);if(result){*native=result;goto failure;}
 q->condition_ready=1;pthread_attr_t attributes;result=pthread_attr_init(&attributes);
 f7_error_endpoint_call(&q->status.construction_fact,17,0,result,result);if(result){*native=result;goto failure;}
 result=pthread_attr_setstacksize(&attributes,memory->stack_bytes);
 f7_error_endpoint_call(&q->status.construction_fact,18,memory->stack_bytes,result,result);
 if(!result){result=pthread_attr_setguardsize(&attributes,memory->guard_bytes);
  f7_error_endpoint_call(&q->status.construction_fact,19,memory->guard_bytes,result,result);}
 if(!result){result=pthread_create(&q->worker,&attributes,writer,q);
  f7_error_endpoint_call(&q->status.construction_fact,20,0,result,result);}
 int disposed=pthread_attr_destroy(&attributes);
 f7_error_endpoint_call(&q->status.construction_fact,21,0,disposed,disposed);
 if(result){*native=result;goto failure;}
 if(disposed){q->status.worker_created=1;*native=disposed;
  lock(q);q->status.native_status=disposed;q->status.failed=1;wake(q);unlock(q);return F7_NATIVE_FAILURE;}
#endif
 q->status.worker_created=1;return F7_OK;
failure:
 q->status.native_status=*native;q->status.failed=q->status.finished=1;
 /* Source owner retains every partially initialized native state/buffer.
    No destructor/free/close/delete is inferred from a construction failure. */
 return F7_NATIVE_FAILURE;
}
int f7_error_queue_submit(struct f7_error_queue *q,enum f7_payload_type type,
 const uint8_t *payload,size_t length,int emergency,uint64_t *ticket){
 uint8_t frame_bytes[F7_FRAME_HEADER_SIZE],queue_bytes[16];struct f7_frame frame;
 if(!q||!payload||!ticket||!length||length>F7_FRAME_MAX-F7_FRAME_HEADER_SIZE||
    (type!=F7_ERROR_GRAPH&&type!=F7_SERIALIZATION_FALLBACK&&type!=F7_RAW_NATIVE_ERROR&&type!=F7_KNOWN_PARTIAL_GRAPH)||
    (emergency!=0&&emergency!=1))return F7_INVALID;
 if(!apart(payload,length,q,sizeof(*q))||!apart(payload,length,q->normal.bytes,q->normal.capacity)||
    !apart(payload,length,q->emergency.bytes,q->emergency.capacity)||
    !apart(payload,length,q->write_buffer,q->write_capacity)||
    !apart(payload,length,q->native_history,q->native_history_capacity)||
    !apart(ticket,sizeof(*ticket),payload,length)||!apart(ticket,sizeof(*ticket),q,sizeof(*q))||
    !apart(ticket,sizeof(*ticket),q->normal.bytes,q->normal.capacity)||
    !apart(ticket,sizeof(*ticket),q->emergency.bytes,q->emergency.capacity)||
    !apart(ticket,sizeof(*ticket),q->write_buffer,q->write_capacity)||
    !apart(ticket,sizeof(*ticket),q->native_history,q->native_history_capacity))return F7_INVALID;
 *ticket=0;if(type==F7_ERROR_GRAPH&&f7_error_graph_validate(payload,length,q->binding.graph_node_limit))return F7_INVALID;
 if(type==F7_SERIALIZATION_FALLBACK&&f7_serialization_fallback_validate(payload,length))return F7_INVALID;
 if(type==F7_KNOWN_PARTIAL_GRAPH&&f7_partial_fragment_validate(payload,length))return F7_INVALID;
 if(lock_try(q))return F7_INCOMPLETE;
 if(q->status.failed||q->status.finished||q->status.closed||q->status.worker_created!=1){unlock(q);return F7_INCOMPLETE;}
 struct lane *lane=emergency?&q->emergency:&q->normal;size_t whole=F7_FRAME_HEADER_SIZE+length;
 if(q->sequence==UINT64_MAX||q->sequence>=q->binding.frame_count||
    q->payload_bytes>q->binding.payload_bytes||length>q->binding.payload_bytes-q->payload_bytes||
    whole>q->write_capacity||whole+16>lane->capacity-lane->used){unlock(q);return F7_OVERFLOWED;}
 memset(&frame,0,sizeof(frame));memcpy(frame.invocation,q->binding.invocation,16);
 memcpy(frame.attempt,q->binding.attempt,32);memcpy(frame.lifetime,q->binding.lifetime,16);
 frame.role=q->binding.role;frame.sequence=frame.ordinal=q->sequence+1;
 memcpy(frame.correlation,q->binding.invocation,8);f7_u64be(frame.correlation+8,frame.sequence);
 frame.payload_type=(uint16_t)type;frame.payload_length=(uint32_t)length;
 int result=f7_frame_encode(frame_bytes,&frame);if(result){unlock(q);return result;}
 f7_u64be(queue_bytes,frame.sequence);f7_u64be(queue_bytes+8,whole);
 put(lane,queue_bytes,16);put(lane,frame_bytes,sizeof(frame_bytes));put(lane,payload,length);
 q->sequence=frame.sequence;q->payload_bytes+=length;q->status.submitted=frame.sequence;
 *ticket=frame.sequence;wake(q);unlock(q);return F7_OK;
}
int f7_error_queue_close(struct f7_error_queue *q){
 if(!q)return F7_INVALID;if(lock_try(q))return F7_INCOMPLETE;
 q->status.closed=1;if(q->condition_ready)wake(q);unlock(q);return F7_OK;
}
int f7_error_queue_snapshot(struct f7_error_queue *q,struct f7_error_queue_status *out){
 if(!q||!out)return F7_INVALID;
 if(!output_apart(q,out,sizeof(*out)))return F7_CONFLICT;
 if(!q->lock_ready){*out=q->status;return F7_OK;}
 if(lock_try(q))return F7_INCOMPLETE;*out=q->status;
 out->normal_queued=q->normal.used;out->emergency_queued=q->emergency.used;unlock(q);return F7_OK;
}
int f7_error_queue_join_exited(struct f7_error_queue *q,int64_t *native){
 if(!q||!native)return F7_INVALID;
 if(!output_apart(q,native,sizeof(*native)))return F7_CONFLICT;
 *native=0;
 if(q->status.worker_created!=1)return F7_INCOMPLETE;
 if(lock_try(q))return F7_INCOMPLETE;
 if(q->status.joined){unlock(q);return F7_OK;}
 if(!q->status.finished){unlock(q);return F7_INCOMPLETE;}unlock(q);
#ifdef _WIN32
 DWORD waited=WaitForSingleObject(q->worker,0);
 if(waited!=WAIT_OBJECT_0){if(waited==WAIT_FAILED){*native=GetLastError();return F7_NATIVE_FAILURE;}return F7_INCOMPLETE;}
 if(!CloseHandle(q->worker)){*native=GetLastError();return F7_NATIVE_FAILURE;}q->worker=NULL;
#else
 int joined=pthread_tryjoin_np(q->worker,NULL);if(joined){*native=joined;return joined==EBUSY?F7_INCOMPLETE:F7_NATIVE_FAILURE;}
#endif
 lock(q);q->status.joined=1;unlock(q);return F7_OK;
}
