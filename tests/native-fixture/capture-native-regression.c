#include "capture-native-regression.h"
#include <string.h>
static int actual_prefix(struct f7_member *member,f7_handle read,
 const uint8_t *original,size_t length,uint8_t *scratch,size_t capacity,int64_t *native){
 if(!member||(!original&&length)||!scratch||!capacity||capacity>F7_FRAME_MAX||member->length!=length)return F7_CONFLICT;
 /* readback obtains ALL original persisted bytes and rechecks native object,
    owner/protection, size and hash; equal caller bytes alone are insufficient. */
 int result=f7_member_readback(member,read,native);if(result)return result;
 struct f7_member reader;memset(&reader,0,sizeof(reader));reader.handle=read;
 size_t offset=0;
 while(offset<length){
  size_t count=length-offset;if(count>capacity)count=capacity;
  result=f7_member_read_at(&reader,offset,scratch,count,native);if(result)return result;
  if(memcmp(scratch,original+offset,count))return F7_CONFLICT;offset+=count;
 }
 return F7_OK;
}
int f7_capture_native_regression(struct f7_capture *c,const struct f7_capture_readbacks *reads,
 const struct f7_original_capture_expectation *expected,uint8_t *scratch,size_t capacity,
 uint64_t deadline,int64_t *native,struct f7_native_capture_regression_result *out){
 if(!c||!reads||!expected||!scratch||!capacity||capacity>F7_FRAME_MAX||!deadline||!native||!out||
    (expected->capture_result!=F7_OK&&expected->capture_result!=F7_INCOMPLETE))return F7_INVALID;
 for(unsigned i=0;i<F7_STREAM_COUNT;i++){
  if(expected->natural_eof[i]!=0&&expected->natural_eof[i]!=1)return F7_INVALID;
  if(c->created[i]==F7_CREATED){if(!expected->raw[i]&&expected->raw_length[i])return F7_BUDGET_ABSENT;}
  else if(expected->raw[i]||expected->raw_length[i]||expected->natural_eof[i])return F7_CONFLICT;
 }
 memset(out,0,sizeof(*out));out->observed_capture_result=F7_INCOMPLETE;
 int result=f7_capture_finalize(c,reads,deadline,native);
 out->observed_capture_result=result;out->capture_native_status=*native;
 if(result!=expected->capture_result)return result==F7_OK?F7_CONFLICT:result;
 /* A live producer/writer is never a settled regression: pending native
    lifetimes remain incomplete even when the row expects failed capture. */
 if(c->native_drains)return F7_INCOMPLETE;
 for(unsigned i=0;i<F7_STREAM_COUNT+2;i++){
  struct f7_async_spool *q;
  if(i<F7_STREAM_COUNT){if(c->created[i]!=F7_CREATED)continue;q=c->raw_async[i];}
  else q=i==F7_STREAM_COUNT?c->witness->async:c->witness->emergency_async;
  struct f7_async_status status;if(!q)return F7_BUDGET_ABSENT;
  result=f7_async_snapshot(q,&status);if(result)return result;
  if(!status.finished||!status.joined||status.worker_created!=1)return F7_INCOMPLETE;
  if(expected->capture_result==F7_OK&&(status.failed||status.queued||status.in_flight||status.persisted!=status.submitted))return F7_CONFLICT;
 }
 for(unsigned i=0;i<F7_STREAM_COUNT;i++)if(c->created[i]==F7_CREATED){
  if(c->natural_eof[i]!=expected->natural_eof[i])return F7_CONFLICT;
  result=actual_prefix(c->raw[i],reads->raw[i],expected->raw[i],expected->raw_length[i],scratch,capacity,native);
  if(result)return result;
 }
 if(expected->capture_result==F7_OK&&(!c->child_exit_observed||c->incomplete||
    c->witness->pending||c->witness->failed||c->error_channel->failed||c->error_channel->incomplete))return F7_CONFLICT;
 /* Assertion completion and observed capture are separate. A correctly
    observed negative row keeps its actual INCOMPLETE result in out; asserting
    it never issues complete capture, original ROOT, W exit or deletion rights. */
 out->assertions_complete=1;return F7_OK;
}
