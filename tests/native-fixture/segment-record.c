#include "segment-record.h"
#include <string.h>
static int valid(const struct f7_segment_input *in){
 if(!in||in->full_size>F7_JSON_INTEGER_MAX)return 0;
 uint64_t count=in->full_size/F7_SEGMENT_MAX+(in->full_size%F7_SEGMENT_MAX!=0);
 if(!count)count=1;
 if(in->count!=count||in->ordinal>=count||in->offset!=in->ordinal*F7_SEGMENT_MAX)return 0;
 uint64_t remaining=in->full_size-in->offset;
 uint64_t expected=remaining>F7_SEGMENT_MAX?F7_SEGMENT_MAX:remaining;
 return in->length==expected;
}
int f7_segment_encode(uint8_t out[F7_SEGMENT_HEADER_BYTES],const struct f7_segment_input *in){
 if(!out||!valid(in))return F7_INVALID;
 memset(out,0,F7_SEGMENT_HEADER_BYTES);memcpy(out,"SLF7SEG1",8);out[8]=F7_VERSION;
 memcpy(out+16,in->invocation,16);memcpy(out+32,in->attempt,32);memcpy(out+64,in->member,16);
 f7_u64be(out+80,in->ordinal);f7_u64be(out+88,in->count);f7_u64be(out+96,in->full_size);
 f7_u64be(out+104,in->offset);f7_u64be(out+112,in->length);memcpy(out+120,in->full_sha256,32);
 return F7_OK;
}
int f7_segment_decode(struct f7_segment_input *out,const uint8_t *header){
 unsigned i;
 if(!out||!header||memcmp(header,"SLF7SEG1",8)||header[8]!=F7_VERSION)return F7_INVALID;
 for(i=9;i<16;i++)if(header[i])return F7_INVALID;
 for(i=152;i<F7_SEGMENT_HEADER_BYTES;i++)if(header[i])return F7_INVALID;
 memset(out,0,sizeof(*out));memcpy(out->invocation,header+16,16);memcpy(out->attempt,header+32,32);
 memcpy(out->member,header+64,16);out->ordinal=f7_read_u64be(header+80);out->count=f7_read_u64be(header+88);
 out->full_size=f7_read_u64be(header+96);out->offset=f7_read_u64be(header+104);
 out->length=f7_read_u64be(header+112);memcpy(out->full_sha256,header+120,32);
 return valid(out)?F7_OK:F7_INVALID;
}
int f7_segment_record_decode(struct f7_segment_input *out,const uint8_t **raw,
 const uint8_t *record,size_t length,const uint8_t invocation[16],
 const uint8_t attempt[32],const uint8_t member[16]){
 if(!out||!raw||!record||!invocation||!attempt||!member||
    length<F7_SEGMENT_HEADER_BYTES)return F7_INVALID;
 *raw=NULL;
 int result=f7_segment_decode(out,record);if(result)return result;
 if(out->length!=length-F7_SEGMENT_HEADER_BYTES)return F7_INVALID;
 if(memcmp(out->invocation,invocation,16)||memcmp(out->attempt,attempt,32)||
    memcmp(out->member,member,16))return F7_AUTH_FAILURE;
 *raw=record+F7_SEGMENT_HEADER_BYTES;return F7_OK;
}
