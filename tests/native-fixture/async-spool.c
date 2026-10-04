#define _GNU_SOURCE
#include "async-spool.h"
#include <stdlib.h>
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
 int closed,failed,finished,joined;int64_t native_status;
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
int f7_async_create(struct f7_async_spool **out,struct f7_member *member,
 size_t capacity,size_t chunk){
 struct f7_async_spool *q;
 if(!out||!member||member->failed||member->finalized||!chunk||chunk>F7_FRAME_MAX+192u||
    chunk>SIZE_MAX-8||capacity<chunk+8||capacity>SIZE_MAX/2)return F7_INVALID;
 *out=NULL;q=calloc(1,sizeof(*q));if(!q)return F7_NATIVE_FAILURE;
 q->member=member;q->capacity=capacity;q->maximum_chunk=chunk;
 q->ring=malloc(capacity);q->write_buffer=malloc(chunk);
 if(!q->ring||!q->write_buffer){free(q->ring);free(q->write_buffer);free(q);return F7_NATIVE_FAILURE;}
#ifdef _WIN32
 InitializeCriticalSection(&q->lock);InitializeConditionVariable(&q->condition);
 q->thread=CreateThread(NULL,0,writer,q,0,NULL);
 if(!q->thread){DeleteCriticalSection(&q->lock);free(q->ring);free(q->write_buffer);free(q);return F7_NATIVE_FAILURE;}
#else
 pthread_condattr_t attr;
 if(pthread_mutex_init(&q->lock,NULL)){free(q->ring);free(q->write_buffer);free(q);return F7_NATIVE_FAILURE;}
 if(pthread_condattr_init(&attr)){pthread_mutex_destroy(&q->lock);free(q->ring);free(q->write_buffer);free(q);return F7_NATIVE_FAILURE;}
 int result=pthread_condattr_setclock(&attr,CLOCK_MONOTONIC);
 if(!result)result=pthread_cond_init(&q->condition,&attr);pthread_condattr_destroy(&attr);
 if(result){pthread_mutex_destroy(&q->lock);free(q->ring);free(q->write_buffer);free(q);return F7_NATIVE_FAILURE;}
 if(pthread_create(&q->thread,NULL,writer,q)){pthread_cond_destroy(&q->condition);pthread_mutex_destroy(&q->lock);
  free(q->ring);free(q->write_buffer);free(q);return F7_NATIVE_FAILURE;}
#endif
 *out=q;return F7_OK;
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
 if(!q||!out)return F7_INVALID;if(try_lock(q))return F7_OVERFLOWED;
 out->submitted=q->submitted;out->persisted=q->persisted;out->queued=q->used;
 out->high_water=q->high_water;out->native_status=q->native_status;
 out->in_flight=q->in_flight;out->in_flight_persisted=q->in_flight_persisted;
 out->failed=q->failed;out->finished=q->finished;out->joined=q->joined;unlock(q);return F7_OK;
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
 if(!q)return F7_INVALID;if(try_lock(q))return F7_OVERFLOWED;
 if(q->joined){unlock(q);return F7_OK;}
 if(!q->finished){unlock(q);return F7_INCOMPLETE;}unlock(q);
#ifdef _WIN32
 if(WaitForSingleObject(q->thread,0)!=WAIT_OBJECT_0)return F7_INCOMPLETE;
 CloseHandle(q->thread);q->thread=NULL;
#else
 /* finished is published by the worker before its final return. tryjoin
    refuses rather than blocking when that last native return is unsettled. */
 if(pthread_tryjoin_np(q->thread,NULL))return F7_INCOMPLETE;
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
 pthread_cond_destroy(&q->condition);pthread_mutex_destroy(&q->lock);
#endif
 free(q->ring);free(q->write_buffer);free(q);return F7_OK;
}
