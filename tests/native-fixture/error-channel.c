#include "error-channel.h"
#include "error-graph.h"
#include "serialization-fallback.h"
#include <string.h>
int f7_error_channel_feed(struct f7_error_channel *c,const uint8_t *input,size_t n,
 uint64_t frame_limit,uint64_t payload_limit){
 size_t offset=0;
 if(!c||(!input&&n)||!frame_limit||!payload_limit||c->failed||
    !c->payload||!c->payload_capacity||c->payload_capacity>F7_FRAME_MAX||
    !c->graph_node_limit)return F7_INVALID;
 while(offset<n){
  if(c->remaining){
   size_t take=n-offset;if(take>c->remaining)take=c->remaining;
   memcpy(c->payload+c->payload_used,input+offset,take);c->payload_used+=take;
   c->remaining-=(uint32_t)take;offset+=take;
   if(!c->remaining){
    if(c->payload_type==F7_ERROR_GRAPH&&
       f7_error_graph_validate(c->payload,c->payload_used,c->graph_node_limit)){
      c->failed=1;return F7_INCOMPLETE;
    }
    /* Independently bounded fallback preserves the fact of serialization
       failure. It can never stand in for a complete original error graph. */
    if(c->payload_type==F7_SERIALIZATION_FALLBACK){
     if(f7_serialization_fallback_validate(c->payload,c->payload_used)){c->failed=1;return F7_INCOMPLETE;}
     c->incomplete=1;
    }
    if(c->payload_type==F7_KNOWN_PARTIAL_GRAPH){
     if(!c->partial||f7_partial_fragment_accept(c->partial,c->payload,c->payload_used,c->partial_message,c->graph_node_limit)){
      c->failed=1;return F7_INCOMPLETE;
     }
     c->incomplete=1;
    }
    c->header_used=0;c->payload_used=0;
   }
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
     !frame.payload_length||frame.payload_length>c->payload_capacity||c->frames==frame_limit||
     c->payload_bytes>payload_limit||frame.payload_length>payload_limit-c->payload_bytes){
     c->failed=1;return F7_INCOMPLETE;
   }
   c->ordinal=frame.ordinal;c->frames++;c->payload_bytes+=frame.payload_length;
   if(frame.payload_type==F7_SERIALIZATION_FALLBACK)c->partial_message=frame.sequence;
   c->remaining=frame.payload_length;
   c->payload_type=frame.payload_type;c->payload_used=0;
  }
 }
 return c->incomplete?F7_INCOMPLETE:F7_OK;
}
int f7_error_channel_eof(struct f7_error_channel *c){
 if(!c)return F7_INVALID;
 if(c->failed||c->incomplete||c->remaining||c->header_used){c->failed=1;return F7_INCOMPLETE;}
 return F7_OK;
}
