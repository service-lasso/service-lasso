#include "witness.h"
#include <string.h>
int f7_witness_emit(struct f7_witness_sink *sink,enum f7_stream stream,
 enum f7_event event,uint64_t requested,uint64_t returned,uint64_t offset,
 const uint8_t *slice,int64_t status,int emergency){
 uint8_t frame[F7_WITNESS_BYTES],digest[32];uint64_t persisted;int64_t write_status;
 if(!sink||!sink->member||!sink->reservation||stream<0||stream>=F7_STREAM_COUNT||
 !event||event>F7_UNAVAILABLE||sink->sequence==UINT64_MAX||
 sink->ordinal[stream]==UINT64_MAX||returned>requested||returned>SIZE_MAX||
 (!slice&&returned))return F7_INVALID;
 if(f7_budget_witness(sink->reservation,sizeof(frame),emergency)){sink->failed=1;return F7_OVERFLOWED;}
 memset(frame,0,sizeof(frame));memcpy(frame,"SLF7WIT1",8);
 memcpy(frame+8,sink->invocation,16);memcpy(frame+24,sink->attempt,32);
 memcpy(frame+56,sink->lifetime,16);memcpy(frame+72,sink->pipe_key[stream],16);
 f7_u64be(frame+88,++sink->sequence);f7_u64be(frame+96,++sink->ordinal[stream]);
 frame[104]=(uint8_t)stream;frame[105]=(uint8_t)event;
 f7_u64be(frame+112,requested);f7_u64be(frame+120,returned);f7_u64be(frame+128,offset);
 f7_u64be(frame+136,(uint64_t)status);
 /* Full SHA256 follows fixed 160-byte metadata in a separate 32-byte write.
    This avoids truncating the native slice commitment. */
 crypto_hash_sha256(digest,slice?slice:(const uint8_t *)"",returned);
 if(f7_budget_witness(sink->reservation,sizeof(digest),emergency)||
 f7_member_append(sink->member,frame,sizeof(frame),&persisted,&write_status)||
 f7_member_append(sink->member,digest,sizeof(digest),&persisted,&write_status)){
 sink->failed=1;return F7_NATIVE_FAILURE;}
 return F7_OK;
}
