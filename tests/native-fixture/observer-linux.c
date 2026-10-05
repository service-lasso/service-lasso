#define _GNU_SOURCE
#include "observer.h"
#ifndef _WIN32
#include <poll.h>
#include <unistd.h>
#include <errno.h>
#include <fcntl.h>
#include <stdlib.h>
#include <time.h>
#include <sys/stat.h>
#include <string.h>
static uint64_t milliseconds(struct f7_capture *capture){
 struct timespec ts;memset(&ts,0,sizeof(ts));
 int result=clock_gettime(CLOCK_MONOTONIC,&ts);int actual_error=result<0?errno:0;
 if(result<0||ts.tv_sec<0||ts.tv_nsec<0||ts.tv_nsec>=1000000000||
    (uint64_t)ts.tv_sec>(UINT64_MAX-999)/1000){
  uint8_t record[8+sizeof(ts)];f7_u64be(record,(uint64_t)(int64_t)result);
  memcpy(record+8,&ts,sizeof(ts));capture->terminal_status[F7_CONTROL]=actual_error;
  f7_witness_emit(capture->witness,F7_CONTROL,F7_CLOCK_ERROR,sizeof(record),sizeof(record),
   capture->observed[F7_CONTROL],record,actual_error,1);
  return UINT64_MAX;
 }
 return (uint64_t)ts.tv_sec*1000+(uint64_t)ts.tv_nsec/1000000;}
int f7_capture_linux(struct f7_capture *c,uint64_t deadline){
 struct pollfd p[F7_STREAM_COUNT];
 unsigned i;int active=0,result=F7_OK;
 if(!deadline)return F7_INVALID;
 int validation=f7_capture_validate(c);if(validation)return validation;
 if(!c->prepared)return F7_BUDGET_ABSENT;
 /* Buffers and private spool workers were reserved before downstream READY. */
 for(i=0;i<F7_STREAM_COUNT;i++){
  struct stat st;p[i].fd=-1;p[i].events=POLLIN;p[i].revents=0;
  if(c->created[i]!=F7_CREATED)continue;
  if(!c->raw[i]||
   c->reservation->input.queue_bytes[i]>SIZE_MAX){result=F7_INVALID;goto end;}
  if(i==F7_PRIVATE_ERRORS){
   /* Original held credential socket only; no FIFO compatibility fallback. */
   if(!c->drain_buffer[i]||!c->drain_capacity[i]||!c->raw_async[i]){result=F7_BUDGET_ABSENT;goto end;}
   p[i].fd=c->pipe[i];active++;continue;
  }
  if(fstat(c->pipe[i],&st)<0){int actual_error=errno;c->terminal_status[i]=actual_error;
   f7_witness_emit(c->witness,i,F7_PIPE_QUERY_ERROR,0,0,c->observed[i],NULL,actual_error,1);
   result=F7_NATIVE_FAILURE;goto end;}
  if(!S_ISFIFO(st.st_mode)){result=F7_INVALID;goto end;}
  if(!c->drain_buffer[i]||!c->drain_capacity[i]||!c->raw_async[i]){result=F7_BUDGET_ABSENT;goto end;}
  int flags=fcntl(c->pipe[i],F_GETFL);
  if(flags<0){int actual_error=errno;c->terminal_status[i]=actual_error;
   f7_witness_emit(c->witness,i,F7_PIPE_FLAGS_ERROR,0,0,c->observed[i],NULL,actual_error,1);
   result=F7_NATIVE_FAILURE;goto end;}
  if((flags&O_ACCMODE)!=O_RDONLY){result=F7_INVALID;goto end;}
  if(fcntl(c->pipe[i],F_SETFL,flags|O_NONBLOCK)<0){int actual_error=errno;c->terminal_status[i]=actual_error;
   f7_witness_emit(c->witness,i,F7_PIPE_FLAGS_ERROR,0,0,c->observed[i],NULL,actual_error,1);
   result=F7_NATIVE_FAILURE;goto end;}
  p[i].fd=c->pipe[i];active++;
 }
 if(c->child_created==F7_CREATED){
  struct f7_child_exit exit;int observation=f7_child_exit_linux(c->original_child,&exit);
  if(f7_child_exit_record(c->witness,&exit))result=F7_INCOMPLETE;
  if(observation==F7_OK)c->child_exit_observed=1;
  else if(observation!=F7_INCOMPLETE)result=F7_INCOMPLETE;
 }
 while(active){
  uint64_t now=milliseconds(c);if(now==UINT64_MAX||now>=deadline){result=F7_INCOMPLETE;break;}
  uint64_t remaining=deadline-now;int wait=(int)(remaining>1000?1000:remaining);
  int ready=poll(p,F7_STREAM_COUNT,wait);
  if(ready<0&&errno==EINTR){int actual_error=errno;
   if(f7_witness_emit(c->witness,F7_CONTROL,F7_POLL_RETRY,F7_STREAM_COUNT,0,
      c->observed[F7_CONTROL],NULL,actual_error,0))result=F7_INCOMPLETE;
   continue;
  }
  if(ready<0){int actual_error=errno;result=F7_NATIVE_FAILURE;
   f7_witness_emit(c->witness,F7_CONTROL,F7_POLL_ERROR,F7_STREAM_COUNT,0,
      c->observed[F7_CONTROL],NULL,actual_error,1);break;}
  for(i=0;i<F7_STREAM_COUNT;i++){
   if(p[i].fd<0||!p[i].revents)continue;
   /* POLLNVAL is an observed poll flag, not a failed read or errno EBADF. */
   if(p[i].revents&POLLNVAL){result=F7_INCOMPLETE;
    uint16_t flags=(uint16_t)p[i].revents;
    uint8_t original_flags[2]={(uint8_t)(flags>>8),(uint8_t)flags};
    f7_witness_emit(c->witness,i,F7_POLL_INVALID,2,2,c->observed[i],original_flags,0,1);
    p[i].fd=-1;active--;continue;}
   /* One bounded read per ready stream gives independent streams a turn.
      POLLHUP is never EOF: only actual native read returning zero is. */
   size_t want=c->drain_capacity[i];
   ssize_t n;int read_error=0,authenticated=1,retain_stop=0;
   if(i==F7_PRIVATE_ERRORS){
    int received=f7_linux_error_peer_receive(c->original_error_peer,c->drain_buffer[i],want,
      c->error_control,c->error_control_capacity,c->error_receive_fact);
    /* Invalid input can precede output initialization. Retain the whole owner
       context and never interpret an uninitialized/stale receive fact. */
    if(received==F7_INVALID){result=F7_INCOMPLETE;p[i].fd=-1;active--;continue;}
    struct f7_linux_receive_fact *fact=c->error_receive_fact;
    /* Preserve native query/recvmsg output and actual ancillary bytes BEFORE
       interpreting any frame. Fact storage contains no VM pointer/handle. */
    if(f7_witness_emit(c->witness,i,F7_RECEIVE_FACT,sizeof(*fact),sizeof(*fact),
       c->observed[i],(const uint8_t *)fact,received,0))retain_stop=1;
    size_t control=fact->control_length>c->error_control_capacity?
      c->error_control_capacity:(size_t)fact->control_length;
    if(fact->native_called&&control&&f7_witness_emit(c->witness,i,F7_RECEIVE_CONTROL,
       c->error_control_capacity,control,c->observed[i],c->error_control,received,0))retain_stop=1;
    n=fact->native_called?(ssize_t)fact->returned:-1;
    read_error=(int)fact->native_error;authenticated=received==F7_OK;
    if(!fact->native_called){result=F7_INCOMPLETE;p[i].fd=-1;active--;continue;}
    if(n>0&&(size_t)n>want){n=(ssize_t)want;authenticated=0;}
    /* Zero-length datagram/closure is never pipe EOF. No authentic original
       closure/control binding has been supplied, so terminal stays INCOMPLETE. */
    if(!n){result=F7_INCOMPLETE;p[i].fd=-1;active--;continue;}
   }else{
    n=read(p[i].fd,c->drain_buffer[i],want);read_error=n<0?errno:0;
   }
   if(n<0&&(read_error==EAGAIN||read_error==EWOULDBLOCK||read_error==EINTR)&&!retain_stop){
    int actual_error=read_error;
    if(f7_witness_emit(c->witness,i,F7_READ_RETRY,want,0,c->observed[i],NULL,actual_error,0))result=F7_INCOMPLETE;
    continue;
   }
   if(n<0){c->terminal_status[i]=read_error;result=F7_INCOMPLETE;
    f7_witness_emit(c->witness,i,F7_READ_ERROR,want,0,c->observed[i],NULL,read_error,1);p[i].fd=-1;active--;continue;}
   if(n==0){c->natural_eof[i]=1;
    if(i==F7_PRIVATE_ERRORS&&f7_error_channel_eof(c->error_channel))result=F7_INCOMPLETE;
    if(f7_witness_emit(c->witness,i,F7_NATURAL_EOF,want,0,c->observed[i],NULL,0,1))result=F7_INCOMPLETE;
    p[i].fd=-1;active--;continue;}
   uint64_t accepted=0;
   if(f7_budget_queue(c->reservation,i,(uint64_t)n)||
      f7_witness_emit(c->witness,i,F7_READ,want,(uint64_t)n,c->observed[i],c->drain_buffer[i],0,0))result=F7_INCOMPLETE;
   if((uint64_t)n>UINT64_MAX-c->observed[i]){result=F7_OVERFLOWED;goto end;}
   c->observed[i]+=(uint64_t)n;
   int budget=f7_budget_take(c->reservation,i,(uint64_t)n,&accepted);
   /* After overflow/disk failure continue native drain until deadline/EOF;
      the captured prefix remains private and never capture_complete. */
   if(accepted&&!c->raw_lost[i]&&f7_async_submit(c->raw_async[i],c->drain_buffer[i],(size_t)accepted)){
    result=F7_INCOMPLETE;c->raw_lost[i]=1;
    f7_witness_emit(c->witness,i,F7_OVERFLOW,accepted,0,c->observed[i]-n,NULL,0,1);}
   if(budget){result=F7_INCOMPLETE;
    f7_witness_emit(c->witness,i,F7_OVERFLOW,n,accepted,c->observed[i]-n,c->drain_buffer[i],0,1);}
   if(i==F7_PRIVATE_ERRORS&&authenticated&&!retain_stop&&!c->raw_lost[i]&&!budget){
    /* Raw original bytes have entered the owning private persistence queue
       before any frame decoder/graph interpretation can fail. */
    struct f7_frame frame;
    if((size_t)n<F7_FRAME_HEADER_SIZE||f7_frame_decode(&frame,c->drain_buffer[i])||
       (size_t)n!=F7_FRAME_HEADER_SIZE+(size_t)frame.payload_length)authenticated=0;
    else if(f7_error_channel_feed(c->error_channel,c->drain_buffer[i],(size_t)n,
       c->reservation->input.frame_count,c->reservation->input.original[F7_PRIVATE_ERRORS]))result=F7_INCOMPLETE;
   }
   if(i==F7_PRIVATE_ERRORS&&(!authenticated||retain_stop||c->raw_lost[i]||budget)){
    /* No next recvmsg overwrites a failed native fact, ancillary capability,
       retained raw prefix or failed witness workspace. Other raw streams drain. */
    result=F7_INCOMPLETE;p[i].fd=-1;active--;
   }
  }
 }
end:
 if(c->child_created==F7_CREATED&&!c->child_exit_observed){
  struct f7_child_exit exit;
  if(f7_child_exit_linux(c->original_child,&exit)!=F7_OK)result=F7_INCOMPLETE;
  else c->child_exit_observed=1;
  if(f7_child_exit_record(c->witness,&exit))result=F7_INCOMPLETE;
 }
 for(i=0;i<F7_STREAM_COUNT;i++){
  if(c->created[i]==F7_CREATED&&!c->natural_eof[i]){result=F7_INCOMPLETE;
    f7_witness_emit(c->witness,i,F7_UNAVAILABLE,0,0,c->observed[i],NULL,c->terminal_status[i],1);}
 }
 if(result||c->witness->failed||c->reservation->exhausted)c->incomplete=1;
 return c->incomplete?F7_INCOMPLETE:F7_OK;
}
#endif
