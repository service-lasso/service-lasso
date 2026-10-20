#include "budget-reservation.h"
#include <string.h>
int f7_checked_add(uint64_t a,uint64_t b,uint64_t *out){
  if(!out||a>UINT64_MAX-b)return F7_OVERFLOWED;*out=a+b;return F7_OK;
}
int f7_checked_mul(uint64_t a,uint64_t b,uint64_t *out){
  if(!out||(b&&a>UINT64_MAX/b))return F7_OVERFLOWED;*out=a*b;return F7_OK;
}
static int nonzero(const uint8_t *p,size_t n){size_t i;uint8_t v=0;for(i=0;i<n;i++)v|=p[i];return v!=0;}
int f7_budget_derive(struct f7_reservation *out,const struct f7_budget_input *in){
  uint64_t raw=0,objects=0,overhead,encrypted,local;unsigned i;
  if(!out||!in)return F7_INVALID;
  uintptr_t output=(uintptr_t)out,input=(uintptr_t)in;
  if(sizeof(*out)>UINTPTR_MAX-output||sizeof(*in)>UINTPTR_MAX-input)return F7_INVALID;
  if(!(output+sizeof(*out)<=input||input+sizeof(*in)<=output))return F7_CONFLICT;
  if(!nonzero(in->row_input_sha256,32)||!nonzero(in->derivation_sha256,32)||
     !in->witness_bytes||!in->manifest_bytes||!in->inventory_entries||
     !in->emergency_bytes||!in->frame_count||!in->transfer_milliseconds||
     in->witness_queue_bytes<F7_WITNESS_QUEUE_MIN||in->witness_queue_bytes>SIZE_MAX||
     in->emergency_queue_bytes<F7_WITNESS_QUEUE_MIN||in->emergency_queue_bytes>SIZE_MAX)return F7_BUDGET_ABSENT;
  for(i=0;i<F7_STREAM_COUNT;i++){
    uint64_t segments;
    if(!in->original[i]||!in->queue_bytes[i]||in->queue_bytes[i]>SIZE_MAX||
       in->original[i]>F7_JSON_INTEGER_MAX)return F7_BUDGET_ABSENT;
    if(f7_checked_add(raw,in->original[i],&raw))return F7_OVERFLOWED;
    segments=in->original[i]/F7_SEGMENT_MAX+(in->original[i]%F7_SEGMENT_MAX!=0);
    if(f7_checked_add(objects,segments,&objects))return F7_OVERFLOWED;
  }
  /* Witness and manifest are separate payloads. Metadata has its own closed
     64KiB envelope per segment; sealed-box overhead is 48 bytes. */
  if(f7_checked_add(objects,in->witness_bytes/F7_SEGMENT_MAX+
       (in->witness_bytes%F7_SEGMENT_MAX!=0),&objects)||
     f7_checked_add(objects,in->emergency_bytes/F7_SEGMENT_MAX+
       (in->emergency_bytes%F7_SEGMENT_MAX!=0),&objects)||
     f7_checked_add(objects,1,&objects)||objects>F7_OBJECT_MAX)return F7_OVERFLOWED;
  if(in->manifest_bytes>F7_SEGMENT_MAX||in->witness_bytes>F7_JSON_INTEGER_MAX||
     in->emergency_bytes>F7_JSON_INTEGER_MAX||
     in->frame_count>F7_JSON_INTEGER_MAX||in->inventory_entries>F7_JSON_INTEGER_MAX||
     in->transfer_milliseconds>F7_JSON_INTEGER_MAX)return F7_INVALID;
  if(f7_checked_mul(objects,F7_FRAME_MAX+48+8,&overhead)||
     f7_checked_add(raw,in->witness_bytes,&encrypted)||
     f7_checked_add(encrypted,in->emergency_bytes,&encrypted)||
     f7_checked_add(encrypted,in->manifest_bytes,&encrypted)||
     f7_checked_add(encrypted,overhead,&encrypted)||
     f7_checked_add(encrypted,raw,&local)||
     f7_checked_add(local,in->witness_bytes,&local)||
     f7_checked_add(local,in->manifest_bytes,&local)||
     f7_checked_add(local,in->emergency_bytes,&local))return F7_OVERFLOWED;
  /* Failed derivation never erases a prior retained reservation or input.
     Only a completely checked closed derivation initializes fresh output. */
  memset(out,0,sizeof(*out));out->input=*in;out->local_bytes=local;out->encrypted_bytes=encrypted;
  out->segment_objects=objects;return F7_OK;
}
int f7_budget_take(struct f7_reservation *r,enum f7_stream stream,uint64_t n,uint64_t *accepted){
  uint64_t remaining;
  if(!r||!accepted||stream<0||stream>=F7_STREAM_COUNT)return F7_INVALID;
  uintptr_t reservation=(uintptr_t)r,output=(uintptr_t)accepted;
  if(sizeof(*r)>UINTPTR_MAX-reservation||sizeof(*accepted)>UINTPTR_MAX-output)return F7_INVALID;
  if(!(reservation+sizeof(*r)<=output||output+sizeof(*accepted)<=reservation))return F7_CONFLICT;
  if(r->captured[stream]>r->input.original[stream])return F7_INVALID;
  remaining=r->input.original[stream]-r->captured[stream];
  *accepted=n<remaining?n:remaining;r->captured[stream]+=*accepted;
  if(*accepted!=n){r->exhausted=1;return F7_OVERFLOWED;}return F7_OK;
}
int f7_budget_witness(struct f7_reservation *r,uint64_t n,int emergency){
  uint64_t *used,limit;
  if(!r)return F7_INVALID;
  used=emergency?&r->emergency_used:&r->witness_used;
  limit=emergency?r->input.emergency_bytes:r->input.witness_bytes;
  if(*used>limit||n>limit-*used){r->exhausted=1;return F7_OVERFLOWED;}
  *used+=n;return F7_OK;
}
int f7_budget_queue(struct f7_reservation *r,enum f7_stream stream,uint64_t n){
  if(!r||stream<0||stream>=F7_STREAM_COUNT)return F7_INVALID;
  if(n>r->input.queue_bytes[stream]){r->exhausted=1;return F7_OVERFLOWED;}
  if(n>r->queue_high_water[stream])r->queue_high_water[stream]=n;return F7_OK;
}
