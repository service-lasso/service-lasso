#include "witness.h"
#include <string.h>
int f7_witness_emit(struct f7_witness_sink *sink,enum f7_stream stream,
 enum f7_event event,uint64_t requested,uint64_t returned,uint64_t offset,
 const uint8_t *slice,int64_t status,int emergency){
 uint8_t frame[F7_WITNESS_BYTES+32+F7_FRAME_MAX],digest[32];uint64_t reserved;
 int inline_payload=event==F7_CHILD_EXIT||event==F7_CHILD_WAIT_PENDING||event==F7_POLL_INVALID||event==F7_CLOCK_ERROR||
 (event==F7_UNAVAILABLE&&returned!=0);
 if(!sink||!sink->member||!sink->async||!sink->emergency_member||!sink->emergency_async||!sink->reservation||stream<0||stream>=F7_STREAM_COUNT||
 sink->role<F7_O||sink->role>F7_R||
 !event||event>F7_CLOCK_ERROR||sink->sequence==UINT64_MAX||
 sink->ordinal[stream]==UINT64_MAX||returned>requested||returned>SIZE_MAX||
 (!slice&&returned))return F7_INVALID;
 if(returned>F7_FRAME_MAX||f7_checked_add(F7_WITNESS_BYTES+sizeof(digest),inline_payload?returned:0,&reserved)||
    f7_budget_witness(sink->reservation,reserved,emergency)){sink->failed=1;return F7_OVERFLOWED;}
 memset(frame,0,F7_WITNESS_BYTES);memcpy(frame,"SLF7WIT1",8);
 memcpy(frame+8,sink->invocation,16);memcpy(frame+24,sink->attempt,32);
 memcpy(frame+56,sink->lifetime,16);memcpy(frame+72,sink->pipe_key[stream],16);
 f7_u64be(frame+88,++sink->sequence);f7_u64be(frame+96,++sink->ordinal[stream]);
 frame[104]=(uint8_t)stream;frame[105]=(uint8_t)event;frame[106]=(uint8_t)inline_payload;
 frame[108]=(uint8_t)(sink->role>>8);frame[109]=(uint8_t)sink->role;
 f7_u64be(frame+112,requested);f7_u64be(frame+120,returned);f7_u64be(frame+128,offset);
 f7_u64be(frame+136,(uint64_t)status);
 /* O allocated event correlation, unique within this invocation/attempt;
    it is a logical record ID, never a native object or role capability. */
 memcpy(frame+144,sink->invocation,8);f7_u64be(frame+152,sink->sequence);
 /* Full SHA256 follows fixed 160-byte metadata in a separate 32-byte write.
    This avoids truncating the native slice commitment. */
 crypto_hash_sha256(digest,slice?slice:(const uint8_t *)"",returned);
 memcpy(frame+F7_WITNESS_BYTES,digest,sizeof(digest));
 if(inline_payload)memcpy(frame+F7_WITNESS_BYTES+sizeof(digest),slice,(size_t)returned);
 /* Terminal records have a separately reserved object and writer. Saturation
    of ordinary witnesses must not consume their emergency queue. Sequence
    numbers bind the two inventories without concurrent writes to one file. */
 if(f7_async_submit(emergency?sink->emergency_async:sink->async,frame,(size_t)reserved)){
 sink->failed=1;return F7_NATIVE_FAILURE;}
 return F7_OK;
}
