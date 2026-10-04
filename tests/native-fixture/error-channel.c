#include "error-channel.h"
#include <string.h>
int f7_error_channel_feed(struct f7_error_channel *c,const uint8_t *input,size_t n,
 uint64_t frame_limit,uint64_t payload_limit){
 size_t offset=0;
 if(!c||(!input&&n)||!frame_limit||!payload_limit||c->failed)return F7_INVALID;
 while(offset<n){
  if(c->remaining){
   size_t take=n-offset;if(take>c->remaining)take=c->remaining;
   c->remaining-=(uint32_t)take;offset+=take;
   if(!c->remaining)c->header_used=0;
   continue;
  }
  size_t take=F7_FRAME_HEADER_SIZE-c->header_used;if(take>n-offset)take=n-offset;
  memcpy(c->header+c->header_used,input+offset,take);c->header_used+=take;offset+=take;
  if(c->header_used==F7_FRAME_HEADER_SIZE){
   struct f7_frame frame;
   if(f7_frame_decode(&frame,c->header)||
     frame.payload_type==F7_CONTROL_RECORD||
     f7_sequence_accept(&c->sequence,&frame,c->invocation,c->attempt,c->role)||
     memcmp(frame.lifetime,c->lifetime,16)||
     c->ordinal==UINT64_MAX||frame.ordinal!=c->ordinal+1||
     !frame.payload_length||c->frames==frame_limit||
     c->payload_bytes>payload_limit||frame.payload_length>payload_limit-c->payload_bytes){
     c->failed=1;return F7_INCOMPLETE;
   }
   c->ordinal=frame.ordinal;c->frames++;c->payload_bytes+=frame.payload_length;
   c->remaining=frame.payload_length;
  }
 }
 return F7_OK;
}
int f7_error_channel_eof(struct f7_error_channel *c){
 if(!c)return F7_INVALID;
 if(c->failed||c->remaining||c->header_used){c->failed=1;return F7_INCOMPLETE;}
 return F7_OK;
}
