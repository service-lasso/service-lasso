#include "partial-error.h"
#include <string.h>
static uint32_t u32(const uint8_t *p){return ((uint32_t)p[0]<<24)|((uint32_t)p[1]<<16)|((uint32_t)p[2]<<8)|p[3];}
static void put32(uint8_t *p,uint32_t n){p[0]=(uint8_t)(n>>24);p[1]=(uint8_t)(n>>16);p[2]=(uint8_t)(n>>8);p[3]=(uint8_t)n;}
static int range(uint32_t offset,uint32_t count,uint64_t capacity){return offset<=capacity&&count<=capacity-offset;}
static int span_offset(const void *value,size_t bytes,const void *base,size_t capacity,size_t unit,uint32_t *offset){
 uintptr_t v=(uintptr_t)value,b=(uintptr_t)base;
 if(capacity>UINTPTR_MAX-b||bytes>UINTPTR_MAX-v||v<b||v>b+capacity||bytes>b+capacity-v||(v-b)%unit||
    (v-b)/unit>UINT32_MAX)return F7_INVALID;
 *offset=(uint32_t)((v-b)/unit);return F7_OK;
}
static int text_field(uint8_t *record,size_t state_at,size_t offset_at,
 const struct f7_error_text *text,int known,const struct f7_partial_graph_input *in){
 if(!known){record[state_at]=255;return F7_OK;}
 if(text->state>F7_TEXT_NULL)return F7_INVALID;record[state_at]=(uint8_t)text->state;
 if(text->state!=F7_TEXT_STRING)return text->count?F7_INVALID:F7_OK;
 uint32_t offset=0;
 if(text->count){int result=span_offset(text->units,(size_t)text->count*2,in->text,in->text_count*2,2,&offset);if(result)return result;}
 put32(record+offset_at,offset);put32(record+offset_at+4,text->count);return F7_OK;
}
int f7_partial_graph_encode(const struct f7_partial_graph_input *in,uint8_t *out,size_t capacity,size_t *length){
 if(!in||!out||!length||!in->nodes||!in->progress||!in->node_count||in->node_count>(F7_FRAME_MAX-24)/32||
    in->text_count>F7_FRAME_MAX||in->reference_count>F7_FRAME_MAX/4||in->native_count>F7_FRAME_MAX||
    (in->text_count&&!in->text)||(in->reference_count&&!in->references)||(in->native_count&&!in->native_bytes))return F7_INVALID;
 size_t total=F7_PARTIAL_HEADER+in->node_count*F7_PARTIAL_NODE+in->text_count*2+in->reference_count*4+in->native_count;
 if(total>F7_PARTIAL_MAX||total>capacity)return F7_BUDGET_ABSENT;
 struct span {uintptr_t address;size_t length;};
 struct span spans[]={{(uintptr_t)in,sizeof(*in)},{(uintptr_t)in->nodes,in->node_count*sizeof(*in->nodes)},
  {(uintptr_t)in->progress,in->node_count},{(uintptr_t)in->text,in->text_count*2},
  {(uintptr_t)in->references,in->reference_count*4},{(uintptr_t)in->native_bytes,in->native_count},
  {(uintptr_t)out,capacity},{(uintptr_t)length,sizeof(*length)}};
 for(size_t i=0;i<8;i++){
  if(spans[i].length>UINTPTR_MAX-spans[i].address)return F7_INVALID;
  for(size_t j=0;j<i;j++)if(spans[i].length&&spans[j].length&&
   !(spans[i].address+spans[i].length<=spans[j].address||spans[j].address+spans[j].length<=spans[i].address))return F7_INVALID;
 }
 *length=0;
 memset(out,0,F7_PARTIAL_HEADER+in->node_count*F7_PARTIAL_NODE);memcpy(out,"SLF7KNP1",8);
 f7_u64be(out+8,in->node_count);f7_u64be(out+16,in->text_count);f7_u64be(out+24,in->reference_count);f7_u64be(out+32,in->native_count);
 for(size_t i=0;i<in->node_count;i++){
  uint8_t *r=out+F7_PARTIAL_HEADER+i*F7_PARTIAL_NODE;const struct f7_error_node *n=in->nodes+i;
  uint8_t progress=in->progress[i];put32(r,(uint32_t)i+1);r[5]=progress;
  if(progress&1){if(n->kind<F7_GRAPH_ERROR||n->kind>F7_GRAPH_ARRAY)return F7_INVALID;r[4]=(uint8_t)n->kind;}
  else if(progress)return F7_INVALID;
  int result=text_field(r,6,20,&n->name,progress&2,in);if(result)return result;
  result=text_field(r,7,28,&n->message,progress&4,in);if(result)return result;
  result=text_field(r,8,36,&n->stack,progress&8,in);if(result)return result;
  if(progress&16){if(n->cause_kind>F7_CAUSE_NULL)return F7_INVALID;r[12]=(uint8_t)n->cause_kind;put32(r+16,n->cause);}
  else r[12]=255;
  if(n->aggregate_count){
   uint32_t offset;result=span_offset(n->aggregate,(size_t)n->aggregate_count*4,in->references,in->reference_count*4,4,&offset);if(result)return result;
   put32(r+44,offset);put32(r+48,n->aggregate_count);
  }
  if(progress&64){
   uint32_t offset;result=span_offset(n->original_native,n->original_native_length,in->native_bytes,in->native_count,1,&offset);if(result)return result;
   put32(r+52,offset);put32(r+56,n->original_native_length);
  }
 }
 size_t cursor=F7_PARTIAL_HEADER+in->node_count*F7_PARTIAL_NODE;
 for(size_t i=0;i<in->text_count;i++){out[cursor++]=(uint8_t)(in->text[i]>>8);out[cursor++]=(uint8_t)in->text[i];}
 for(size_t i=0;i<in->reference_count;i++){put32(out+cursor,in->references[i]);cursor+=4;}
 if(in->native_count)memcpy(out+cursor,in->native_bytes,in->native_count);
 int result=f7_partial_graph_validate(out,total,(uint32_t)in->node_count);if(result)return result;*length=total;return F7_OK;
}
int f7_partial_graph_validate(const uint8_t *p,size_t length,uint32_t limit){
 if(!p||length<F7_PARTIAL_HEADER||length>F7_PARTIAL_MAX||memcmp(p,"SLF7KNP1",8)||f7_read_u64be(p+40))return F7_INVALID;
 uint64_t count=f7_read_u64be(p+8),text=f7_read_u64be(p+16),refs=f7_read_u64be(p+24),native=f7_read_u64be(p+32);
 if(!count||count>limit||count>(F7_FRAME_MAX-24)/32||text>F7_FRAME_MAX||refs>F7_FRAME_MAX/4||native>F7_FRAME_MAX||
    F7_PARTIAL_HEADER+count*F7_PARTIAL_NODE+text*2+refs*4+native!=length)return F7_INVALID;
 const uint8_t *reference_bytes=p+F7_PARTIAL_HEADER+(size_t)count*F7_PARTIAL_NODE+(size_t)text*2;
 for(uint64_t i=0;i<refs;i++)if(u32(reference_bytes+i*4)>count)return F7_INVALID;
 for(uint64_t i=0;i<count;i++){
  const uint8_t *r=p+F7_PARTIAL_HEADER+i*F7_PARTIAL_NODE;uint8_t progress=r[5];
  if(u32(r)!=(uint32_t)i+1||r[9]||r[10]||r[11]||r[13]||r[14]||r[15]||u32(r+60)||
     ((progress&1)?(r[4]<F7_GRAPH_ERROR||r[4]>F7_GRAPH_ARRAY):(r[4]||progress))||
     ((progress&128)&&progress!=255))return F7_INVALID;
  for(unsigned field=0;field<3;field++){
   uint8_t state=r[6+field];uint32_t offset=u32(r+20+field*8),units=u32(r+24+field*8);
   int known=progress&(2u<<field);
   if(!known){if(state!=255||offset||units)return F7_INVALID;}
   else if(state>F7_TEXT_NULL||!range(offset,units,text)||(state!=F7_TEXT_STRING&&(offset||units)))return F7_INVALID;
  }
  uint32_t cause=u32(r+16);
  if(progress&16){if(r[12]>F7_CAUSE_NULL||(r[12]==F7_CAUSE_REFERENCE?(!cause||cause>count):cause))return F7_INVALID;}
  else if(r[12]!=255||cause)return F7_INVALID;
  uint32_t aggregate_at=u32(r+44),aggregate_count=u32(r+48);
  if(!range(aggregate_at,aggregate_count,refs)||(!aggregate_count&&aggregate_at)||
    (aggregate_count&&r[4]!=F7_GRAPH_AGGREGATE))return F7_INVALID;
  if(progress&32)for(uint32_t j=0;j<aggregate_count;j++)if(!u32(reference_bytes+((size_t)aggregate_at+j)*4))return F7_INVALID;
  uint32_t native_at=u32(r+52),native_count=u32(r+56);
  if(progress&64){if(!native_count||!range(native_at,native_count,native))return F7_INVALID;}
  else if(native_at||native_count)return F7_INVALID;
 }
 return F7_OK;
}
