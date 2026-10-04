#include "serialization-fallback.h"
#include <string.h>
int f7_serialization_fallback_validate(const uint8_t *p,size_t n){
 if(!p||n!=64||memcmp(p,"SLF7SFB1",8))return F7_INVALID;
 uint64_t result=f7_read_u64be(p+8),checked=f7_read_u64be(p+40),same=f7_read_u64be(p+48);
 if(result<F7_INVALID||result>F7_CONFLICT||checked>1||same>1||same>checked||
    f7_read_u64be(p+16)>UINT32_MAX||f7_read_u64be(p+24)>UINT32_MAX||
    f7_read_u64be(p+32)>UINT32_MAX||f7_read_u64be(p+56)>(F7_FRAME_MAX-24)/32)return F7_INVALID;
 return F7_OK;
}
