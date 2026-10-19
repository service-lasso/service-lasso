#include "protocol.h"
#include <string.h>
void f7_u64be(uint8_t out[8], uint64_t n) {
  unsigned i; for(i=0;i<8;i++) out[7-i]=(uint8_t)(n>>(8*i));
}
uint64_t f7_read_u64be(const uint8_t in[8]) {
  unsigned i; uint64_t n=0; for(i=0;i<8;i++) n=(n<<8)|in[i]; return n;
}
static void u16(uint8_t *p,uint16_t n){p[0]=(uint8_t)(n>>8);p[1]=(uint8_t)n;}
static uint16_t r16(const uint8_t *p){return (uint16_t)((p[0]<<8)|p[1]);}
static int apart(const void *a,size_t an,const void *b,size_t bn){
 uintptr_t x=(uintptr_t)a,y=(uintptr_t)b;
 if(!x||!y||an>UINTPTR_MAX-x||bn>UINTPTR_MAX-y)return 0;
 return x+an<=y||y+bn<=x;
}
int f7_frame_encode(uint8_t out[F7_FRAME_HEADER_SIZE], const struct f7_frame *f) {
  if(!out||!f||f->payload_length>F7_FRAME_MAX-F7_FRAME_HEADER_SIZE||
     f->role<F7_O||f->role>F7_R||!f->sequence||
     f->payload_type<F7_ERROR_GRAPH||f->payload_type>F7_KNOWN_PARTIAL_GRAPH) return F7_INVALID;
  if(!apart(out,F7_FRAME_HEADER_SIZE,f,sizeof(*f)))return F7_CONFLICT;
  memset(out,0,F7_FRAME_HEADER_SIZE); memcpy(out,"SLF7",4);
  u16(out+4,F7_VERSION);u16(out+6,f->role);
  memcpy(out+8,f->invocation,16);memcpy(out+24,f->attempt,32);
  memcpy(out+56,f->lifetime,16);memcpy(out+72,f->correlation,16);
  f7_u64be(out+88,f->sequence);f7_u64be(out+96,f->ordinal);
  out[104]=(uint8_t)(f->payload_length>>24);out[105]=(uint8_t)(f->payload_length>>16);
  out[106]=(uint8_t)(f->payload_length>>8);out[107]=(uint8_t)f->payload_length;
  u16(out+108,f->payload_type); return F7_OK;
}
int f7_frame_decode(struct f7_frame *f,const uint8_t in[F7_FRAME_HEADER_SIZE]) {
  if(!f||!in||memcmp(in,"SLF7",4)||r16(in+4)!=F7_VERSION||in[110]||in[111])return F7_INVALID;
  if(!apart(f,sizeof(*f),in,F7_FRAME_HEADER_SIZE))return F7_CONFLICT;
  memset(f,0,sizeof(*f));f->role=r16(in+6);
  memcpy(f->invocation,in+8,16);memcpy(f->attempt,in+24,32);
  memcpy(f->lifetime,in+56,16);memcpy(f->correlation,in+72,16);
  f->sequence=f7_read_u64be(in+88);f->ordinal=f7_read_u64be(in+96);
  f->payload_length=((uint32_t)in[104]<<24)|((uint32_t)in[105]<<16)|((uint32_t)in[106]<<8)|in[107];
  f->payload_type=r16(in+108);
  if(f->role<F7_O||f->role>F7_R||!f->sequence||
     f->payload_type<F7_ERROR_GRAPH||f->payload_type>F7_KNOWN_PARTIAL_GRAPH||
     f->payload_length>F7_FRAME_MAX-F7_FRAME_HEADER_SIZE)return F7_INVALID;
  return F7_OK;
}
int f7_sequence_accept(uint64_t *last,const struct f7_frame *f,
 const uint8_t invocation[16],const uint8_t attempt[32],uint16_t role){
  if(!last||!f||!invocation||!attempt)return F7_AUTH_FAILURE;
  if(!apart(last,sizeof(*last),f,sizeof(*f))||!apart(last,sizeof(*last),invocation,16)||
     !apart(last,sizeof(*last),attempt,32))return F7_CONFLICT;
  if(!last||!f||!invocation||!attempt||*last==UINT64_MAX||f->sequence!=*last+1||
     f->role!=role||memcmp(f->invocation,invocation,16)||memcmp(f->attempt,attempt,32))return F7_AUTH_FAILURE;
  *last=f->sequence;return F7_OK;
}
int f7_state_advance(enum f7_state *state,enum f7_state next){
  if(!state||*state<F7_OBSERVER_ADMITTED||*state>F7_RETAINED_UNRESOLVED)return F7_INVALID;
  if(next==F7_RETAINED_UNRESOLVED){*state=next;return F7_OK;}
  if(*state==F7_RETAINED_UNRESOLVED||next!=*state+1)return F7_INVALID;
  *state=next;return F7_OK;
}
