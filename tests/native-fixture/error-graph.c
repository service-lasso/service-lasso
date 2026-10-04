#include "error-graph.h"
#include <string.h>
static void u32(uint8_t *p,uint32_t n){p[0]=(uint8_t)(n>>24);p[1]=(uint8_t)(n>>16);p[2]=(uint8_t)(n>>8);p[3]=(uint8_t)n;}
static uint32_t read32(const uint8_t *p){return ((uint32_t)p[0]<<24)|((uint32_t)p[1]<<16)|((uint32_t)p[2]<<8)|p[3];}
static int ref(uint32_t id,uint32_t count){return id&&id<=count;}
static int text_valid(const struct f7_error_text *text){return !text->count||text->units;}
static void utf16(uint8_t *out,const struct f7_error_text *text){
 for(uint32_t i=0;i<text->count;i++){out[2*(size_t)i]=(uint8_t)(text->units[i]>>8);out[2*(size_t)i+1]=(uint8_t)text->units[i];}
}
int f7_error_graph_encode(const struct f7_error_graph *g,uint8_t *out,size_t capacity,size_t *length){
 uint64_t total=24;
 if(!g||!out||!length||!g->nodes||!g->count||!ref(g->primary,g->count)||
    (g->secondary_count&&!g->secondary)||g->count>(F7_FRAME_MAX-24)/32||
    g->secondary_count>(F7_FRAME_MAX-24)/4)return F7_INVALID;
 *length=0;
 total+=(uint64_t)g->secondary_count*4;
 for(uint32_t i=0;i<g->secondary_count;i++)if(!ref(g->secondary[i],g->count))return F7_INVALID;
 for(uint32_t i=0;i<g->count;i++){
  const struct f7_error_node *n=g->nodes+i;
  if(n->kind<F7_GRAPH_ERROR||n->kind>F7_GRAPH_NATIVE||n->cause_kind<F7_CAUSE_ABSENT||n->cause_kind>F7_CAUSE_NULL||
     (n->cause_kind==F7_CAUSE_REFERENCE?!ref(n->cause,g->count):n->cause!=0)||
     !text_valid(&n->name)||!text_valid(&n->message)||!text_valid(&n->stack)||
     (n->aggregate_count&&(!n->aggregate||n->kind!=F7_GRAPH_AGGREGATE))||
     (n->original_native_length&&(!n->original_native||n->kind<F7_GRAPH_PRIMITIVE)))return F7_INVALID;
  total+=32+(uint64_t)n->aggregate_count*4+
   ((uint64_t)n->name.count+n->message.count+n->stack.count)*2+n->original_native_length;
  if(total>F7_FRAME_MAX||total>capacity)return F7_OVERFLOWED;
  for(uint32_t j=0;j<n->aggregate_count;j++)if(!ref(n->aggregate[j],g->count))return F7_INVALID;
 }
 if(total>F7_FRAME_MAX||total>capacity)return F7_OVERFLOWED;
 memset(out,0,24);memcpy(out,"SLF7GRF1",8);out[8]=F7_VERSION;
 u32(out+12,g->count);u32(out+16,g->primary);u32(out+20,g->secondary_count);
 size_t at=24;
 for(uint32_t i=0;i<g->secondary_count;i++){u32(out+at,g->secondary[i]);at+=4;}
 for(uint32_t i=0;i<g->count;i++){
  const struct f7_error_node *n=g->nodes+i;memset(out+at,0,32);u32(out+at,i+1);
  out[at+5]=(uint8_t)n->kind;out[at+7]=(uint8_t)n->cause_kind;
  u32(out+at+8,n->cause);u32(out+at+12,n->aggregate_count);
  u32(out+at+16,n->name.count);u32(out+at+20,n->message.count);u32(out+at+24,n->stack.count);
  u32(out+at+28,n->original_native_length);at+=32;
  for(uint32_t j=0;j<n->aggregate_count;j++){u32(out+at,n->aggregate[j]);at+=4;}
  utf16(out+at,&n->name);at+=(size_t)n->name.count*2;
  utf16(out+at,&n->message);at+=(size_t)n->message.count*2;
  utf16(out+at,&n->stack);at+=(size_t)n->stack.count*2;
  if(n->original_native_length)memcpy(out+at,n->original_native,n->original_native_length);
  at+=n->original_native_length;
 }
 *length=at;return F7_OK;
}
int f7_error_graph_validate(const uint8_t *p,size_t length,uint32_t limit){
 if(!p||length<24||length>F7_FRAME_MAX||!limit||memcmp(p,"SLF7GRF1",8)||
    p[8]!=F7_VERSION||p[9]||p[10]||p[11])return F7_INVALID;
 uint32_t count=read32(p+12),primary=read32(p+16),secondary=read32(p+20);
 if(!count||count>limit||!ref(primary,count)||secondary>(length-24)/4)return F7_INVALID;
 size_t at=24;
 for(uint32_t i=0;i<secondary;i++,at+=4)if(!ref(read32(p+at),count))return F7_INVALID;
 for(uint32_t i=0;i<count;i++){
  if(length-at<32)return F7_INVALID;
  uint16_t kind=((uint16_t)p[at+4]<<8)|p[at+5],cause_kind=((uint16_t)p[at+6]<<8)|p[at+7];
  uint32_t cause=read32(p+at+8),aggregate=read32(p+at+12),native=read32(p+at+28);
  uint64_t texts=(uint64_t)read32(p+at+16)+read32(p+at+20)+read32(p+at+24);
  if(read32(p+at)!=i+1||kind<F7_GRAPH_ERROR||kind>F7_GRAPH_NATIVE||cause_kind>F7_CAUSE_NULL||
     (cause_kind==F7_CAUSE_REFERENCE?!ref(cause,count):cause!=0)||
     (aggregate&&kind!=F7_GRAPH_AGGREGATE)||(native&&kind<F7_GRAPH_PRIMITIVE))return F7_INVALID;
  at+=32;uint64_t bytes=(uint64_t)aggregate*4+texts*2+native;
  if(bytes>length-at)return F7_INVALID;
  for(uint32_t j=0;j<aggregate;j++)if(!ref(read32(p+at+(size_t)j*4),count))return F7_INVALID;
  at+=(size_t)bytes;
 }
 return at==length?F7_OK:F7_INVALID;
}
