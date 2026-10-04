#include "observer.h"
#ifdef _WIN32
#include <stdlib.h>
#include <limits.h>
struct drain_context {
 struct f7_capture *capture;
 CRITICAL_SECTION *witness_lock;
 unsigned stream;
 uint8_t *buffer;
 DWORD capacity;
 int result;
 volatile LONG *abort;
};
struct drain_owner {
 drain_context contexts[F7_STREAM_COUNT];
 HANDLE threads[F7_STREAM_COUNT];
 DWORD cancel_status[F7_STREAM_COUNT];
 volatile LONG abort;
 int started,prepared;
 CRITICAL_SECTION lock;
};
extern "C" int f7_capture_windows_reap(struct f7_capture *c){
 if(!c||!c->native_drains)return F7_INVALID;
 drain_owner *owner=(drain_owner *)c->native_drains;
 /* No capture fields are read while any drain can still mutate them. */
 for(unsigned i=0;i<F7_STREAM_COUNT;i++)if(owner->threads[i]&&
   WaitForSingleObject(owner->threads[i],0)!=WAIT_OBJECT_0)return F7_INCOMPLETE;
 for(unsigned i=0;i<F7_STREAM_COUNT;i++)if(owner->threads[i]){
  if(owner->contexts[i].result)c->incomplete=1;
  CloseHandle(owner->threads[i]);
 }
 DeleteCriticalSection(&owner->lock);free(owner);c->native_drains=NULL;
 return F7_OK;
}
static int record(drain_context *d,enum f7_event event,uint64_t requested,
 uint64_t returned,uint64_t offset,const uint8_t *slice,int64_t status,int emergency){
 int r;EnterCriticalSection(d->witness_lock);
 r=f7_witness_emit(d->capture->witness,(enum f7_stream)d->stream,event,
 requested,returned,offset,slice,status,emergency);
 LeaveCriticalSection(d->witness_lock);return r;
}
static DWORD WINAPI drain(LPVOID value){
 drain_context *d=(drain_context *)value;f7_capture *c=d->capture;unsigned i=d->stream;
 if(InterlockedCompareExchange(d->abort,0,0))return 0;
 for(;;){
  DWORD got=0;BOOL success=ReadFile(c->pipe[i],d->buffer,d->capacity,&got,NULL);
  DWORD status=success?ERROR_SUCCESS:GetLastError();
  /* Anonymous original pipes signal native EOF as ERROR_BROKEN_PIPE. A
     cancelled read is ERROR_OPERATION_ABORTED and never natural EOF. */
  if(!success&&status!=ERROR_BROKEN_PIPE){
   c->terminal_status[i]=status;d->result=F7_INCOMPLETE;
   record(d,F7_READ_ERROR,d->capacity,0,c->observed[i],NULL,status,1);break;
  }
  if(!success&&status==ERROR_BROKEN_PIPE){
   c->natural_eof[i]=1;
   if(i==F7_PRIVATE_ERRORS&&f7_error_channel_eof(c->error_channel))d->result=F7_INCOMPLETE;
   if(record(d,F7_NATURAL_EOF,d->capacity,0,c->observed[i],NULL,status,1))d->result=F7_INCOMPLETE;
   break;
  }
  if(!got){
   /* Successful zero-byte completion is recorded but does not assert pipe
      writer closure; required native broken-pipe terminal remains absent. */
   d->result=F7_INCOMPLETE;c->terminal_status[i]=0;
   record(d,F7_UNAVAILABLE,d->capacity,0,c->observed[i],NULL,0,1);break;
  }
  uint64_t accepted=0;int budget;
  if(i==F7_PRIVATE_ERRORS&&f7_error_channel_feed(c->error_channel,d->buffer,got,
      c->reservation->input.frame_count,c->reservation->input.original[F7_PRIVATE_ERRORS]))d->result=F7_INCOMPLETE;
  EnterCriticalSection(d->witness_lock);
  int queue=f7_budget_queue(c->reservation,(enum f7_stream)i,got);
  budget=f7_budget_take(c->reservation,(enum f7_stream)i,got,&accepted);
  LeaveCriticalSection(d->witness_lock);
  if(queue||record(d,F7_READ,d->capacity,got,c->observed[i],d->buffer,0,0))d->result=F7_INCOMPLETE;
  if(got>UINT64_MAX-c->observed[i]){d->result=F7_OVERFLOWED;break;}
  c->observed[i]+=got;
  if(accepted&&!c->raw_lost[i]&&f7_async_submit(c->raw_async[i],d->buffer,(size_t)accepted)){
   d->result=F7_INCOMPLETE;c->raw_lost[i]=1;
   record(d,F7_OVERFLOW,accepted,0,c->observed[i]-got,NULL,0,1);
  }
  if(budget){d->result=F7_INCOMPLETE;
   record(d,F7_OVERFLOW,got,accepted,c->observed[i]-got,d->buffer,0,1);}
 }
 return 0;
}
extern "C" int f7_capture_windows_abort_prepared(struct f7_capture *c){
 if(!c||!c->native_drains)return F7_INVALID;
 drain_owner *owner=(drain_owner *)c->native_drains;
 if(owner->started)return F7_CONFLICT;
 InterlockedExchange(&owner->abort,1);owner->started=1;
 for(unsigned i=0;i<F7_STREAM_COUNT;i++)if(owner->threads[i]){
  if(ResumeThread(owner->threads[i])==MAXDWORD)return F7_INCOMPLETE;
 }
 return F7_OK;
}
extern "C" int f7_capture_windows_prepare(struct f7_capture *c){
 if(!c||c->native_drains)return F7_CONFLICT;
 drain_owner *owner=(drain_owner *)calloc(1,sizeof(*owner));
 if(!owner)return F7_NATIVE_FAILURE;
 c->native_drains=owner;InitializeCriticalSection(&owner->lock);
 for(unsigned i=0;i<F7_STREAM_COUNT;i++){
  if(c->created[i]!=F7_CREATED)continue;
  if(!c->raw[i]||GetFileType(c->pipe[i])!=FILE_TYPE_PIPE||
     !c->drain_buffer[i]||!c->drain_capacity[i]||!c->raw_async[i]){
   f7_capture_windows_abort_prepared(c);return F7_INVALID;
  }
  drain_context *d=owner->contexts+i;
  d->capture=c;d->witness_lock=&owner->lock;d->stream=i;d->abort=&owner->abort;
  d->capacity=(DWORD)c->drain_capacity[i];d->buffer=c->drain_buffer[i];
 }
 for(unsigned i=0;i<F7_STREAM_COUNT;i++)if(c->created[i]==F7_CREATED){
  owner->threads[i]=CreateThread(NULL,0,drain,owner->contexts+i,CREATE_SUSPENDED,NULL);
  if(!owner->threads[i]){f7_capture_windows_abort_prepared(c);return F7_NATIVE_FAILURE;}
 }
 owner->prepared=1;return F7_OK;
}
extern "C" int f7_capture_windows(struct f7_capture *c,uint64_t deadline){
 unsigned i;int result=F7_OK;
 if(!deadline)return F7_INVALID;
 int validation=f7_capture_validate(c);if(validation)return validation;
 if(!c->prepared)return F7_BUDGET_ABSENT;
 drain_owner *owner=(drain_owner *)c->native_drains;
 if(!owner||!owner->prepared||owner->started)return F7_CONFLICT;
 drain_context *contexts=owner->contexts;HANDLE *threads=owner->threads;
 /* Complete contexts and suspended drain lifetimes were installed before
    downstream READY. The owning entry must also start drains before READY;
    a prepared queue or suspended thread is never running-observer proof. */
 for(i=0;i<F7_STREAM_COUNT;i++){
  if(c->created[i]!=F7_CREATED)continue;
  if(!c->raw[i]||GetFileType(c->pipe[i])!=FILE_TYPE_PIPE||
    !c->reservation->input.queue_bytes[i]||c->reservation->input.queue_bytes[i]>SIZE_MAX){
    result=F7_INVALID;goto close;}
  if(!contexts[i].buffer||!contexts[i].capacity||!c->raw_async[i]){result=F7_BUDGET_ABSENT;goto close;}
 }
 if(c->child_created==F7_CREATED){
  struct f7_child_exit exit;int observation=f7_child_exit_windows(c->original_child,&exit);
  if(f7_child_exit_record(c->witness,&exit))result=F7_INCOMPLETE;
  if(observation==F7_OK)c->child_exit_observed=1;
  else if(observation!=F7_INCOMPLETE)result=F7_INCOMPLETE;
 }
 owner->started=1;
 for(i=0;i<F7_STREAM_COUNT;i++)if(threads[i]){
  if(ResumeThread(threads[i])==MAXDWORD){result=F7_NATIVE_FAILURE;goto settle;}
 }
 for(;;){
  int live=0;
  for(i=0;i<F7_STREAM_COUNT;i++)if(threads[i]&&WaitForSingleObject(threads[i],0)==WAIT_TIMEOUT)live++;
  if(!live)break;
  uint64_t now=GetTickCount64();
  if(now>=deadline){result=F7_INCOMPLETE;goto settle;}
  /* Control loop has no private stream payload/public callback. */
  Sleep((DWORD)((deadline-now)>10?10:deadline-now));
 }
settle:
 for(i=0;i<F7_STREAM_COUNT;i++)if(threads[i]&&WaitForSingleObject(threads[i],0)==WAIT_TIMEOUT){
  result=F7_INCOMPLETE;
  if(!CancelSynchronousIo(threads[i]))owner->cancel_status[i]=GetLastError();
 }
 /* A cancelled synchronous native read is not universally guaranteed to
    return. Deadline therefore retains the complete heap owner and original
    capture; no stack context, lock, buffer, or member is released live. */
 for(i=0;i<F7_STREAM_COUNT;i++)if(threads[i]){
  uint64_t now=GetTickCount64();DWORD remaining=now>=deadline?0:
   (DWORD)((deadline-now)>MAXDWORD-1?MAXDWORD-1:deadline-now);
  if(WaitForSingleObject(threads[i],remaining)!=WAIT_OBJECT_0){
   /* Do not touch fields owned by another still-running drain. */
   c->incomplete=1;return F7_INCOMPLETE;
  }
  if(contexts[i].result)result=F7_INCOMPLETE;
 }
close:
 for(i=0;i<F7_STREAM_COUNT;i++)if(owner->cancel_status[i]){
  result=F7_INCOMPLETE;
  f7_witness_emit(c->witness,(enum f7_stream)i,F7_UNAVAILABLE,0,0,
   c->observed[i],NULL,owner->cancel_status[i],1);
 }
 if(c->child_created==F7_CREATED&&!c->child_exit_observed){
  struct f7_child_exit exit;
  if(f7_child_exit_windows(c->original_child,&exit)!=F7_OK)result=F7_INCOMPLETE;
  else c->child_exit_observed=1;
  if(f7_child_exit_record(c->witness,&exit))result=F7_INCOMPLETE;
 }
 for(i=0;i<F7_STREAM_COUNT;i++){
  if(c->created[i]==F7_CREATED&&!c->natural_eof[i]){
   result=F7_INCOMPLETE;
   f7_witness_emit(c->witness,(enum f7_stream)i,F7_UNAVAILABLE,0,0,c->observed[i],NULL,c->terminal_status[i],1);
  }
 }
 if(f7_capture_windows_reap(c)){c->incomplete=1;return F7_INCOMPLETE;}
 if(result||c->witness->failed||c->reservation->exhausted)c->incomplete=1;
 return c->incomplete?F7_INCOMPLETE:F7_OK;
}
#endif
