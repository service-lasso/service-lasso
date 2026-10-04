#include "observer.h"
static int close_wait(struct f7_async_spool *q,uint64_t deadline,
 struct f7_async_status *status){
 if(!q||f7_async_close_input(q)||f7_async_wait(q,deadline)||
    f7_async_snapshot(q,status))return F7_INCOMPLETE;
 if(status->failed||!status->finished||status->queued||
    status->submitted!=status->persisted)return F7_INCOMPLETE;
 return F7_OK;
}
static int finish(struct f7_member *m,f7_handle read,int64_t *status){
 if(read==F7_INVALID_HANDLE)return F7_INVALID;
 int result=f7_member_finish(m,status);
 if(!m->finalized)return result;
 int readback=f7_member_readback(m,read,status);
 return result?result:readback;
}
int f7_capture_finalize(struct f7_capture *c,
 const struct f7_capture_readbacks *reads,uint64_t deadline,int64_t *native_status){
 unsigned i;int result=F7_OK;struct f7_async_status status;
 if(!c||!reads||!native_status||!deadline||!c->prepared)return F7_INVALID;
 *native_status=0;
#ifdef _WIN32
 if(c->native_drains&&f7_capture_windows_reap(c))return F7_INCOMPLETE;
#endif
 /* Capture has returned; ROOT owner keeps this heap context, original handles
    and source-bound independent read companions alive through this operation. */
 for(i=0;i<F7_STREAM_COUNT;i++)if(c->raw_async[i]){
  int settled=close_wait(c->raw_async[i],deadline,&status);
  if(settled){
   result=F7_INCOMPLETE;
   /* Snapshot may itself be unavailable. Never fabricate a native status. */
   if(!f7_async_snapshot(c->raw_async[i],&status)){
    uint8_t facts[48];f7_u64be(facts,status.submitted);
    f7_u64be(facts+8,status.persisted);f7_u64be(facts+16,status.queued);
    f7_u64be(facts+24,status.high_water);f7_u64be(facts+32,(uint64_t)status.native_status);
    f7_u64be(facts+40,(uint64_t)status.failed);
    if(f7_witness_emit(c->witness,(enum f7_stream)i,F7_UNAVAILABLE,
       sizeof(facts),sizeof(facts),c->observed[i],facts,status.native_status,1))result=F7_INCOMPLETE;
   }
   /* Queued original bytes and active/failed member remain retained. */
   if(!f7_async_join_settled(c->raw_async[i])){
    /* A known failed persistent prefix may still be fully hash-read back.
       This never makes the original stream or queued remainder complete. */
    finish(c->raw[i],reads->raw[i],native_status);
    c->incomplete=1;
   }
   continue;
  }
  if(f7_async_release_settled(c->raw_async[i])){result=F7_INCOMPLETE;continue;}
  c->raw_async[i]=NULL;
  if(finish(c->raw[i],reads->raw[i],native_status)){
   result=F7_INCOMPLETE;
   f7_witness_emit(c->witness,(enum f7_stream)i,F7_UNAVAILABLE,0,0,
    c->observed[i],NULL,*native_status,1);
  }
  if(c->raw_lost[i]||!c->natural_eof[i])result=F7_INCOMPLETE;
 }
 /* Emergency records above precede closing either witness queue. A saturated
    normal witness queue cannot take the reserved terminal object capacity. */
 struct f7_async_spool **queues[2]={&c->witness->async,&c->witness->emergency_async};
 struct f7_member *members[2]={c->witness->member,c->witness->emergency_member};
 f7_handle companions[2]={reads->witness,reads->emergency};
 for(i=0;i<2;i++){
  if(close_wait(*queues[i],deadline,&status)||f7_async_release_settled(*queues[i])){
   if(!f7_async_join_settled(*queues[i]))finish(members[i],companions[i],native_status);
   result=F7_INCOMPLETE;continue;
  }
  *queues[i]=NULL;
  if(finish(members[i],companions[i],native_status))result=F7_INCOMPLETE;
 }
 if(result||c->witness->failed||c->reservation->exhausted)c->incomplete=1;
 return c->incomplete?F7_INCOMPLETE:F7_OK;
}
