#include "witness.h"
#include <string.h>
static uint64_t number(const uint8_t *p){
 uint64_t n=0;for(unsigned i=0;i<8;i++)n=(n<<8)|p[i];return n;
}
static int64_t signed_number(const uint8_t *p){
 uint64_t n=number(p);return n<=INT64_MAX?(int64_t)n:-1-(int64_t)(UINT64_MAX-n);
}
static int nonzero(const uint8_t *p,size_t n){
 uint8_t value=0;for(size_t i=0;i<n;i++)value|=p[i];return value!=0;
}
int f7_witness_validate(struct f7_witness_expectation *expected,
 const uint8_t *record,size_t length,const uint8_t *original_slice,
 size_t original_length,struct f7_witness_view *out){
 struct f7_witness_view value;uint8_t digest[32];
 if(!expected||!record||!out||length<F7_WITNESS_BYTES+32||
    length>F7_WITNESS_BYTES+32+F7_FRAME_MAX||
    expected->role<F7_O||expected->role>F7_R||
    !nonzero(expected->invocation,16)||!nonzero(expected->attempt,32)||
    !nonzero(expected->lifetime,16))return F7_INVALID;
 memset(&value,0,sizeof(value));
 value.stream=(enum f7_stream)record[104];value.event=(enum f7_event)record[105];
 value.requested=number(record+112);value.returned=number(record+120);
 value.offset=number(record+128);value.native_status=signed_number(record+136);
 uint16_t role=(uint16_t)((record[108]<<8)|record[109]);
 if(memcmp(record,"SLF7WIT1",8)||record[107]||record[110]||record[111]||
    value.stream>=F7_STREAM_COUNT||!value.event||value.event>F7_PIPE_QUERY_ERROR||
    !nonzero(expected->pipe_key[value.stream],16)||
    role!=expected->role||memcmp(record+8,expected->invocation,16)||
    memcmp(record+24,expected->attempt,32)||memcmp(record+56,expected->lifetime,16)||
    memcmp(record+72,expected->pipe_key[value.stream],16)||
    expected->sequence==UINT64_MAX||expected->ordinal[value.stream]==UINT64_MAX||
    number(record+88)!=expected->sequence+1||
    number(record+96)!=expected->ordinal[value.stream]+1||
    memcmp(record+144,expected->invocation,8)||memcmp(record+152,record+88,8)||
    value.returned>value.requested||value.returned>F7_FRAME_MAX)return F7_INVALID;
 int inline_payload=value.event==F7_CHILD_EXIT||value.event==F7_CHILD_WAIT_PENDING||
   value.event==F7_POLL_INVALID||(value.event==F7_UNAVAILABLE&&value.returned!=0);
 if(record[106]!=(uint8_t)inline_payload||
    length!=F7_WITNESS_BYTES+32+(inline_payload?(size_t)value.returned:0))return F7_INVALID;
 if(inline_payload){
  if(original_slice||original_length)return F7_INVALID;
  value.inline_bytes=record+F7_WITNESS_BYTES+32;value.inline_length=(size_t)value.returned;
  if((value.event==F7_CHILD_EXIT||value.event==F7_CHILD_WAIT_PENDING)&&value.returned!=64)return F7_INVALID;
  if(value.event==F7_POLL_INVALID&&value.returned!=2)return F7_INVALID;
  crypto_hash_sha256(digest,value.inline_bytes,value.inline_length);
 }else{
  if(original_length!=value.returned||(!original_slice&&original_length))return F7_INVALID;
  crypto_hash_sha256(digest,original_slice?original_slice:(const uint8_t *)"",original_length);
 }
 if(sodium_memcmp(digest,record+F7_WITNESS_BYTES,32))return F7_CONFLICT;
 memcpy(value.slice_sha256,digest,32);
 expected->sequence++;expected->ordinal[value.stream]++;*out=value;return F7_OK;
}
