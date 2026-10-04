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
};
static int record(drain_context *d,enum f7_event event,uint64_t requested,
 uint64_t returned,uint64_t offset,const uint8_t *slice,int64_t status,int emergency){
 int r;EnterCriticalSection(d->witness_lock);
 r=f7_witness_emit(d->capture->witness,(enum f7_stream)d->stream,event,
 requested,returned,offset,slice,status,emergency);
 LeaveCriticalSection(d->witness_lock);return r;
}
static DWORD WINAPI drain(LPVOID value){
 drain_context *d=(drain_context *)value;f7_capture *c=d->capture;unsigned i=d->stream;
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
   d->result=F7_INCOMPLETE;c->terminal_status[i]=ERROR_NO_DATA;
   record(d,F7_UNAVAILABLE,d->capacity,0,c->observed[i],NULL,ERROR_NO_DATA,1);break;
  }
  uint64_t accepted=0,persisted=0;int64_t native_status=0;int budget;
  if(i==F7_PRIVATE_ERRORS&&f7_error_channel_feed(c->error_channel,d->buffer,got,
      c->reservation->input.frame_count,c->reservation->input.original[F7_PRIVATE_ERRORS]))d->result=F7_INCOMPLETE;
  EnterCriticalSection(d->witness_lock);
  int queue=f7_budget_queue(c->reservation,(enum f7_stream)i,got);
  budget=f7_budget_take(c->reservation,(enum f7_stream)i,got,&accepted);
  LeaveCriticalSection(d->witness_lock);
  if(queue||record(d,F7_READ,d->capacity,got,c->observed[i],d->buffer,0,0))d->result=F7_INCOMPLETE;
  if(got>UINT64_MAX-c->observed[i]){d->result=F7_OVERFLOWED;break;}
  c->observed[i]+=got;
  if(accepted&&!c->raw[i]->failed&&
   f7_member_append(c->raw[i],d->buffer,(size_t)accepted,&persisted,&native_status)){
   d->result=F7_INCOMPLETE;c->terminal_status[i]=native_status;
   record(d,F7_WRITE_ERROR,accepted,persisted,c->raw[i]->length-persisted,d->buffer,native_status,1);
  }
  if(budget){d->result=F7_INCOMPLETE;
   record(d,F7_OVERFLOW,got,accepted,c->raw[i]->length,d->buffer,0,1);}
 }
 return 0;
}
extern "C" int f7_capture_windows(struct f7_capture *c,uint64_t deadline){
 drain_context contexts[F7_STREAM_COUNT]={};HANDLE threads[F7_STREAM_COUNT]={};
 CRITICAL_SECTION lock;unsigned i;int result=F7_OK;
 if(!deadline)return F7_INVALID;
 int validation=f7_capture_validate(c);if(validation)return validation;
 InitializeCriticalSection(&lock);
 /* Allocate all independent queues before any drain starts. This function
    does not launch a downstream actor or claim admission by handle number. */
 for(i=0;i<F7_STREAM_COUNT;i++){
  if(c->created[i]!=F7_CREATED)continue;
  if(!c->raw[i]||GetFileType(c->pipe[i])!=FILE_TYPE_PIPE||
    !c->reservation->input.queue_bytes[i]||c->reservation->input.queue_bytes[i]>SIZE_MAX){
    result=F7_INVALID;goto close;}
  contexts[i].capture=c;contexts[i].witness_lock=&lock;contexts[i].stream=i;
  contexts[i].capacity=(DWORD)(c->reservation->input.queue_bytes[i]>65536?65536:c->reservation->input.queue_bytes[i]);
  contexts[i].buffer=(uint8_t *)malloc(contexts[i].capacity);
  if(!contexts[i].buffer){result=F7_NATIVE_FAILURE;goto close;}
 }
 if(c->child_created==F7_CREATED){
  struct f7_child_exit exit;int observation=f7_child_exit_windows(c->original_child,&exit);
  if(f7_child_exit_record(c->witness,&exit))result=F7_INCOMPLETE;
  if(observation==F7_OK)c->child_exit_observed=1;
  else if(observation!=F7_INCOMPLETE)result=F7_INCOMPLETE;
 }
 for(i=0;i<F7_STREAM_COUNT;i++){
  if(c->created[i]!=F7_CREATED)continue;
  threads[i]=CreateThread(NULL,0,drain,&contexts[i],0,NULL);
  if(!threads[i]){result=F7_NATIVE_FAILURE;goto settle;}
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
  if(!CancelSynchronousIo(threads[i])&&GetLastError()!=ERROR_NOT_FOUND)c->terminal_status[i]=GetLastError();
 }
 /* Always settle actual thread lifetime before releasing capture memory.
    INFINITE is a source limitation, never a universal deadline guarantee.
    Complete U1 needs the separately reserved asynchronous persistence path. */
 for(i=0;i<F7_STREAM_COUNT;i++)if(threads[i]){
  if(WaitForSingleObject(threads[i],INFINITE)!=WAIT_OBJECT_0)result=F7_INCOMPLETE;
  if(contexts[i].result)result=F7_INCOMPLETE;CloseHandle(threads[i]);
 }
close:
 if(c->child_created==F7_CREATED&&!c->child_exit_observed){
  struct f7_child_exit exit;
  if(f7_child_exit_windows(c->original_child,&exit)!=F7_OK)result=F7_INCOMPLETE;
  else c->child_exit_observed=1;
  if(f7_child_exit_record(c->witness,&exit))result=F7_INCOMPLETE;
 }
 for(i=0;i<F7_STREAM_COUNT;i++){
  free(contexts[i].buffer);
  if(c->created[i]==F7_CREATED&&!c->natural_eof[i]){
   result=F7_INCOMPLETE;
   f7_witness_emit(c->witness,(enum f7_stream)i,F7_UNAVAILABLE,0,0,c->observed[i],NULL,c->terminal_status[i],1);
  }
 }
 DeleteCriticalSection(&lock);
 if(result||c->witness->failed||c->reservation->exhausted)c->incomplete=1;
 return c->incomplete?F7_INCOMPLETE:F7_OK;
}
#endif
