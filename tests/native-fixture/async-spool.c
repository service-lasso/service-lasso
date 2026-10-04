#define _GNU_SOURCE
#include "async-spool.h"
#include <string.h>
#ifndef _WIN32
#include <pthread.h>
#include <time.h>
#include <errno.h>
#endif
struct f7_async_spool {
 struct f7_member *member;
 uint8_t *ring,*write_buffer;size_t capacity,maximum_chunk,head,used;
 uint64_t submitted,persisted,high_water;
 uint64_t in_flight,in_flight_persisted;
 int closed,failed,finished,joined,lock_ready,condition_ready,worker_created,worker_entered,released;int64_t native_status;
#ifdef _WIN32
 CRITICAL_SECTION lock;CONDITION_VARIABLE condition;HANDLE thread;
#else
 pthread_mutex_t lock;pthread_cond_t condition;pthread_t thread;
#endif
};
static void lock(struct f7_async_spool *q){
#ifdef _WIN32
 EnterCriticalSection(&q->lock);
#else
 pthread_mutex_lock(&q->lock);
#endif
}
static int try_lock(struct f7_async_spool *q){
 if(!q->lock_ready||q->released)return 1;
#ifdef _WIN32
 return TryEnterCriticalSection(&q->lock)?0:1;
#else
 return pthread_mutex_trylock(&q->lock);
#endif
}
static void unlock(struct f7_async_spool *q){
#ifdef _WIN32
 LeaveCriticalSection(&q->lock);
#else
 pthread_mutex_unlock(&q->lock);
#endif
}
static void wake(struct f7_async_spool *q){
#ifdef _WIN32
 WakeAllConditionVariable(&q->condition);
#else
 pthread_cond_broadcast(&q->condition);
#endif
}
static void put(struct f7_async_spool *q,const uint8_t *p,size_t n){
 size_t tail=(q->head+q->used)%q->capacity,first=q->capacity-tail;
 if(first>n)first=n;memcpy(q->ring+tail,p,first);
 if(n>first)memcpy(q->ring,p+first,n-first);q->used+=n;
}
static void take(struct f7_async_spool *q,uint8_t *p,size_t n){
 size_t first=q->capacity-q->head;if(first>n)first=n;
 memcpy(p,q->ring+q->head,first);if(n>first)memcpy(p+first,q->ring,n-first);
 q->head=(q->head+n)%q->capacity;q->used-=n;
}
#ifdef _WIN32
static DWORD WINAPI writer(LPVOID value){
#else
static void *writer(void *value){
#endif
 struct f7_async_spool *q=value;
 lock(q);q->worker_entered=1;wake(q);unlock(q);
 for(;;){
  uint8_t header[8];uint64_t n,persisted=0;int64_t status=0;
  lock(q);
  while(!q->used&&!q->closed){
#ifdef _WIN32
   if(!SleepConditionVariableCS(&q->condition,&q->lock,INFINITE)){
    q->native_status=GetLastError();q->failed=1;break;}
#else
   int waited=pthread_cond_wait(&q->condition,&q->lock);
   if(waited){q->native_status=waited;q->failed=1;break;}
#endif
  }
  if(q->failed){q->finished=1;wake(q);unlock(q);break;}
  if(!q->used&&q->closed){q->finished=1;wake(q);unlock(q);break;}
  if(q->used<8){q->failed=1;q->finished=1;wake(q);unlock(q);break;}
  take(q,header,8);n=f7_read_u64be(header);
  if(n>q->maximum_chunk||n>q->used){q->failed=1;q->finished=1;wake(q);unlock(q);break;}
  take(q,q->write_buffer,(size_t)n);q->in_flight=n;q->in_flight_persisted=0;wake(q);unlock(q);
  /* No queue lock is held across native persistent writes. Original drains
     and settlement control never execute this blocking operation. */
  int result=f7_member_append(q->member,q->write_buffer,(size_t)n,&persisted,&status);
  lock(q);q->persisted+=persisted;q->in_flight_persisted=persisted;
  if(result){q->failed=1;q->native_status=status;q->finished=1;wake(q);unlock(q);break;}
  q->in_flight=0;q->in_flight_persisted=0;unlock(q);
 }
 return 0;
}
size_t f7_async_state_bytes(void){return sizeof(struct f7_async_spool);}
static int memory_geometry(struct f7_async_spool **out,struct f7_member *member,
 const struct f7_async_memory *m){
 struct span {uintptr_t address;size_t length;};
 struct span spans[]={{(uintptr_t)out,sizeof(*out)},{(uintptr_t)member,sizeof(*member)},
  {(uintptr_t)m,sizeof(*m)},{(uintptr_t)m->state,m->state_bytes},
  {(uintptr_t)m->ring,m->ring_bytes},{(uintptr_t)m->write_buffer,m->write_bytes}};
 for(size_t i=0;i<sizeof(spans)/sizeof(spans[0]);i++){
  if(spans[i].length>UINTPTR_MAX-spans[i].address)return F7_INVALID;
  for(size_t j=0;j<i;j++)if(!(spans[i].address+spans[i].length<=spans[j].address||
    spans[j].address+spans[j].length<=spans[i].address))return F7_INVALID;
 }return F7_OK;
}
int f7_async_create(struct f7_async_spool **out,struct f7_member *member,
 const struct f7_async_memory *memory,size_t chunk){
 if(!out||!member||!memory)return F7_INVALID;
 if(!memory->state||memory->state_bytes<sizeof(struct f7_async_spool)||
    (uintptr_t)memory->state%_Alignof(struct f7_async_spool)||!memory->ring||!memory->write_buffer||
    !memory->stack_bytes||member->failed||member->finalized||!chunk||chunk>F7_FRAME_MAX+192u||
    chunk>SIZE_MAX-8||memory->ring_bytes<chunk+8||memory->ring_bytes>SIZE_MAX/2||memory->write_bytes<chunk)return F7_BUDGET_ABSENT;
 int result=memory_geometry(out,member,memory);if(result)return result;
 *out=memory->state;struct f7_async_spool *q=*out;memset(q,0,sizeof(*q));
 q->member=member;q->capacity=memory->ring_bytes;q->maximum_chunk=chunk;
 q->ring=memory->ring;q->write_buffer=memory->write_buffer;q->worker_created=2;
#ifdef _WIN32
 if(!InitializeCriticalSectionEx(&q->lock,0,0)){q->native_status=GetLastError();goto failed;}
 q->lock_ready=1;InitializeConditionVariable(&q->condition);q->condition_ready=1;
 q->thread=CreateThread(NULL,memory->stack_bytes,writer,q,STACK_SIZE_PARAM_IS_A_RESERVATION,NULL);
 if(!q->thread){q->native_status=GetLastError();goto failed;}
#else
 if(!memory->guard_bytes){q->failed=q->finished=1;return F7_BUDGET_ABSENT;}
 result=pthread_mutex_init(&q->lock,NULL);if(result){q->native_status=result;goto failed;}
 q->lock_ready=1;pthread_condattr_t condattr;
 result=pthread_condattr_init(&condattr);if(result){q->native_status=result;goto failed;}
 result=pthread_condattr_setclock(&condattr,CLOCK_MONOTONIC);
 if(!result){result=pthread_cond_init(&q->condition,&condattr);if(!result)q->condition_ready=1;}
 int cond_disposed=pthread_condattr_destroy(&condattr);
 if(result||cond_disposed){q->native_status=result?result:cond_disposed;goto failed;}
 pthread_attr_t attr;result=pthread_attr_init(&attr);if(result){q->native_status=result;goto failed;}
 result=pthread_attr_setstacksize(&attr,memory->stack_bytes);
 if(!result)result=pthread_attr_setguardsize(&attr,memory->guard_bytes);
 if(!result){result=pthread_create(&q->thread,&attr,writer,q);if(!result)q->worker_created=1;}
 int disposed=pthread_attr_destroy(&attr);
 if(result){q->native_status=result;goto failed;}
 if(disposed){lock(q);q->native_status=disposed;q->failed=1;q->closed=1;wake(q);unlock(q);return F7_NATIVE_FAILURE;}
#endif
 q->worker_created=1;return F7_OK;
failed:
 q->failed=q->finished=1;
 /* All partially initialized native state and source-owned bytes stay held.
    No free, destructor or endpoint close follows original construction loss. */
 return F7_NATIVE_FAILURE;
}
int f7_async_submit(struct f7_async_spool *q,const uint8_t *bytes,size_t n){
 uint8_t header[8];
 if(!q||(!bytes&&n)||!n||n>q->maximum_chunk)return F7_INVALID;
 /* A contended/full queue is loss, never a blocking drain or silent success. */
 if(try_lock(q))return F7_OVERFLOWED;
 if(q->closed||q->failed||q->finished){unlock(q);return F7_INCOMPLETE;}
 if(n>q->capacity-q->used||8>q->capacity-q->used-n||n>UINT64_MAX-q->submitted){unlock(q);return F7_OVERFLOWED;}
 f7_u64be(header,n);put(q,header,8);put(q,bytes,n);q->submitted+=n;
 if(q->used>q->high_water)q->high_water=q->used;wake(q);unlock(q);return F7_OK;
}
int f7_async_close_input(struct f7_async_spool *q){
 if(!q)return F7_INVALID;if(try_lock(q))return F7_OVERFLOWED;
 q->closed=1;wake(q);unlock(q);return F7_OK;
}
int f7_async_snapshot(struct f7_async_spool *q,struct f7_async_status *out){
 if(!q||!out)return F7_INVALID; if(!q->lock_ready){memset(out,0,sizeof(*out));out->failed=q->failed;out->finished=q->finished;out->native_status=q->native_status;out->worker_created=q->worker_created;return F7_OK;} if(try_lock(q))return F7_OVERFLOWED;
 out->submitted=q->submitted;out->persisted=q->persisted;out->queued=q->used;
 out->high_water=q->high_water;out->native_status=q->native_status;
 out->in_flight=q->in_flight;out->in_flight_persisted=q->in_flight_persisted;
 out->failed=q->failed;out->finished=q->finished;out->joined=q->joined;out->worker_created=q->worker_created;out->worker_entered=q->worker_entered;unlock(q);return F7_OK;
}
int f7_async_wait(struct f7_async_spool *q,uint64_t deadline){
 if(!q||!deadline)return F7_INVALID;if(try_lock(q))return F7_OVERFLOWED;
 while(!q->finished){
#ifdef _WIN32
  uint64_t now=GetTickCount64();if(now>=deadline){unlock(q);return F7_INCOMPLETE;}
  DWORD wait=(DWORD)((deadline-now)>MAXDWORD-1?MAXDWORD-1:deadline-now);
  if(!SleepConditionVariableCS(&q->condition,&q->lock,wait)&&GetLastError()!=ERROR_TIMEOUT){unlock(q);return F7_NATIVE_FAILURE;}
#else
  struct timespec when;when.tv_sec=(time_t)(deadline/1000);when.tv_nsec=(long)(deadline%1000)*1000000;
  int result=pthread_cond_timedwait(&q->condition,&q->lock,&when);
  if(result==ETIMEDOUT){unlock(q);return F7_INCOMPLETE;}
  if(result){unlock(q);return F7_NATIVE_FAILURE;}
#endif
 }
 int result=q->failed?F7_INCOMPLETE:F7_OK;unlock(q);return result;
}
int f7_async_join_settled(struct f7_async_spool *q){
 if(!q||q->worker_created!=1)return F7_INCOMPLETE;if(try_lock(q))return F7_OVERFLOWED;
 if(q->joined){unlock(q);return F7_OK;}
 if(!q->finished){unlock(q);return F7_INCOMPLETE;}unlock(q);
#ifdef _WIN32
 DWORD waited=WaitForSingleObject(q->thread,0);
 if(waited!=WAIT_OBJECT_0){if(waited==WAIT_FAILED){q->native_status=GetLastError();return F7_NATIVE_FAILURE;}return F7_INCOMPLETE;}
 if(!CloseHandle(q->thread)){q->native_status=GetLastError();return F7_NATIVE_FAILURE;}q->thread=NULL;
#else
 /* finished is published by the worker before its final return. tryjoin
    refuses rather than blocking when that last native return is unsettled. */
 int joined=pthread_tryjoin_np(q->thread,NULL);
 if(joined){q->native_status=joined;return joined==EBUSY?F7_INCOMPLETE:F7_NATIVE_FAILURE;}
#endif
 lock(q);q->joined=1;unlock(q);return F7_OK;
}
int f7_async_release_settled(struct f7_async_spool *q){
 if(!q||f7_async_join_settled(q))return F7_INCOMPLETE;
 lock(q);
 /* Failed queues retain submitted originals that may not have reached disk.
    Joining is safe settlement, never disposal authority for those bytes. */
 if(q->failed||q->used||q->persisted!=q->submitted){unlock(q);return F7_INCOMPLETE;}
 unlock(q);
#ifdef _WIN32
 DeleteCriticalSection(&q->lock);
#else
 int result=pthread_cond_destroy(&q->condition);
 if(result){q->native_status=result;return F7_NATIVE_FAILURE;}q->condition_ready=0;
 result=pthread_mutex_destroy(&q->lock);
 if(result){q->native_status=result;return F7_NATIVE_FAILURE;}
#endif
 q->released=1;q->lock_ready=0;q->condition_ready=0;return F7_OK;
}
