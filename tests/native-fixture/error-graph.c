#include "error-graph.h"
#include <string.h>
static void u32(uint8_t *p,uint32_t n){p[0]=(uint8_t)(n>>24);p[1]=(uint8_t)(n>>16);p[2]=(uint8_t)(n>>8);p[3]=(uint8_t)n;}
static uint32_t read32(const uint8_t *p){return ((uint32_t)p[0]<<24)|((uint32_t)p[1]<<16)|((uint32_t)p[2]<<8)|p[3];}
static int ref(uint32_t id,uint32_t count){return id&&id<=count;}
static int properties_kind(unsigned kind){
 return kind==F7_GRAPH_ERROR||kind==F7_GRAPH_AGGREGATE||kind==F7_GRAPH_OBJECT||kind==F7_GRAPH_ARRAY;
}
static int primitive_valid(const uint8_t *p,size_t n,uint32_t text_units,unsigned text_state){
 if(!p||!n)return 0;
 if(p[0]!=3&&text_state!=F7_TEXT_ABSENT)return 0;
 switch(p[0]){
  case 1:case 2:return n==1&&!text_units;
  case 3:return n==1&&text_state==F7_TEXT_STRING;
  case 4:return n==2&&p[1]<=1&&!text_units;
  case 5:return n==9&&!text_units;
  case 6:{
   if(n<6||p[1]>1||text_units)return 0;
   uint32_t words=read32(p+2);
   if((uint64_t)words*8+6!=n)return 0;
   if(!words)return !p[1];
   uint8_t last=0;for(unsigned i=0;i<8;i++)last|=p[n-8+i];return last!=0;
  }
  default:return 0;
 }
}
int f7_error_properties_validate(const uint8_t *p,size_t length,uint32_t nodes){
 if(!p||length<16||length>F7_FRAME_MAX||!nodes||memcmp(p,"SLF7PRP1",8)||read32(p+12)>3)return F7_INVALID;
 uint32_t count=read32(p+8);if(count>(length-16)/8)return F7_INVALID;
 size_t at=16;
 for(uint32_t i=0;i<count;i++){
  if(length-at<8)return F7_INVALID;
  uint32_t units=read32(p+at),value=read32(p+at+4);
  if(!ref(value,nodes)||(uint64_t)units*2>length-at-8)return F7_INVALID;
  size_t previous=16;
  /* Exact original enumeration order is preserved; duplicate string keys
     cannot be an original own-property enumeration. Work is frame-bounded. */
  for(uint32_t j=0;j<i;j++){
   uint32_t before=read32(p+previous);
   if(before==units&&!memcmp(p+previous+8,p+at+8,(size_t)units*2))return F7_INVALID;
   previous+=8+(size_t)before*2;
  }
  at+=8+(size_t)units*2;
 }
 return at==length?F7_OK:F7_INVALID;
}
static int text_valid(const struct f7_error_text *text){
 return text->state>=F7_TEXT_STRING&&text->state<=F7_TEXT_NULL&&
 (text->state==F7_TEXT_STRING?(!text->count||text->units):!text->count);
}
static void utf16(uint8_t *out,const struct f7_error_text *text){
 for(uint32_t i=0;i<text->count;i++){out[2*(size_t)i]=(uint8_t)(text->units[i]>>8);out[2*(size_t)i+1]=(uint8_t)text->units[i];}
}
static int separate(const void *a,size_t an,const void *b,uint64_t bn){
 uintptr_t x=(uintptr_t)a,y=(uintptr_t)b;
 if((an&&!x)||(bn&&!y)||an>UINTPTR_MAX-x||bn>SIZE_MAX||bn>UINTPTR_MAX-y)return 0;
 return !an||!bn||x+an<=y||y+(size_t)bn<=x;
}
int f7_error_graph_output_validate(const struct f7_error_graph *g,const void *out,size_t capacity){
 if(!g||!out||!capacity||!g->nodes||!g->count||g->count>(F7_FRAME_MAX-24)/32||
    g->secondary_count>(F7_FRAME_MAX-24)/4||(g->secondary_count&&!g->secondary))return F7_INVALID;
 if(!separate(out,capacity,g,sizeof(*g))||
    !separate(out,capacity,g->nodes,(uint64_t)g->count*sizeof(*g->nodes))||
    !separate(out,capacity,g->secondary,(uint64_t)g->secondary_count*4))return F7_CONFLICT;
 for(uint32_t i=0;i<g->count;i++){
  const struct f7_error_node *n=g->nodes+i;
  if(!separate(out,capacity,n->name.units,(uint64_t)n->name.count*2)||
     !separate(out,capacity,n->message.units,(uint64_t)n->message.count*2)||
     !separate(out,capacity,n->stack.units,(uint64_t)n->stack.count*2)||
     !separate(out,capacity,n->aggregate,(uint64_t)n->aggregate_count*4)||
     !separate(out,capacity,n->original_native,n->original_native_length))return F7_CONFLICT;
 }
 return F7_OK;
}
int f7_error_graph_encode(const struct f7_error_graph *g,uint8_t *out,size_t capacity,size_t *length){
 uint64_t total=24;
 if(!g||!out||!length||!g->nodes||!g->count||!ref(g->primary,g->count)||
    (g->secondary_count&&!g->secondary)||g->count>(F7_FRAME_MAX-24)/32||
    g->secondary_count>(F7_FRAME_MAX-24)/4)return F7_INVALID;
 if(!separate(out,capacity,length,sizeof(*length)))return F7_CONFLICT;
 int geometry=f7_error_graph_output_validate(g,out,capacity);if(geometry)return geometry;
 geometry=f7_error_graph_output_validate(g,length,sizeof(*length));if(geometry)return geometry;
 *length=0;
 total+=(uint64_t)g->secondary_count*4;
 for(uint32_t i=0;i<g->secondary_count;i++)if(!ref(g->secondary[i],g->count))return F7_INVALID;
 for(uint32_t i=0;i<g->count;i++){
  const struct f7_error_node *n=g->nodes+i;
  if(n->kind<F7_GRAPH_ERROR||n->kind>F7_GRAPH_ARRAY||n->cause_kind<F7_CAUSE_ABSENT||n->cause_kind>F7_CAUSE_NULL||
     (n->cause_kind==F7_CAUSE_REFERENCE?!ref(n->cause,g->count):n->cause!=0)||
     !text_valid(&n->name)||!text_valid(&n->message)||!text_valid(&n->stack)||
     (n->aggregate_count&&(!n->aggregate||n->kind!=F7_GRAPH_AGGREGATE))||
     (n->original_native_length&&!n->original_native)||
     ((n->kind==F7_GRAPH_OBJECT||n->kind==F7_GRAPH_ARRAY)&&!n->original_native_length)||
     (n->kind==F7_GRAPH_PRIMITIVE&&!primitive_valid(n->original_native,
        n->original_native_length,n->message.count,n->message.state))||
     (n->kind==F7_GRAPH_PRIMITIVE&&(n->name.count||n->stack.count||
        n->name.state!=F7_TEXT_ABSENT||n->stack.state!=F7_TEXT_ABSENT))||
     (n->original_native_length&&properties_kind(n->kind)&&
      f7_error_properties_validate(n->original_native,n->original_native_length,g->count)))return F7_INVALID;
  if(n->original_native_length&&properties_kind(n->kind)){
   uint32_t proto=read32(n->original_native+12);
   if((n->kind==F7_GRAPH_ERROR||n->kind==F7_GRAPH_AGGREGATE)?proto!=0:
      n->kind==F7_GRAPH_ARRAY?proto!=3:(proto!=1&&proto!=2))return F7_INVALID;
  }
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
  out[at+4]=(uint8_t)(n->name.state|(n->message.state<<2)|(n->stack.state<<4));
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
  uint16_t kind=p[at+5],cause_kind=((uint16_t)p[at+6]<<8)|p[at+7];
  uint32_t cause=read32(p+at+8),aggregate=read32(p+at+12),native=read32(p+at+28);
  uint64_t texts=(uint64_t)read32(p+at+16)+read32(p+at+20)+read32(p+at+24);
  if(read32(p+at)!=i+1||(p[at+4]&0xc0)||
     ((p[at+4]&3)&&read32(p+at+16))||
     (((p[at+4]>>2)&3)&&read32(p+at+20))||
     (((p[at+4]>>4)&3)&&read32(p+at+24))||
     kind<F7_GRAPH_ERROR||kind>F7_GRAPH_ARRAY||cause_kind>F7_CAUSE_NULL||
     (cause_kind==F7_CAUSE_REFERENCE?!ref(cause,count):cause!=0)||
     (aggregate&&kind!=F7_GRAPH_AGGREGATE))return F7_INVALID;
  at+=32;uint64_t bytes=(uint64_t)aggregate*4+texts*2+native;
  if(bytes>length-at)return F7_INVALID;
  if((kind==F7_GRAPH_OBJECT||kind==F7_GRAPH_ARRAY)&&!native)return F7_INVALID;
  for(uint32_t j=0;j<aggregate;j++)if(!ref(read32(p+at+(size_t)j*4),count))return F7_INVALID;
  if(native&&properties_kind(kind)&&
     f7_error_properties_validate(p+at+(size_t)aggregate*4+(size_t)texts*2,native,count))return F7_INVALID;
  if(native&&properties_kind(kind)){
   uint32_t proto=read32(p+at+(size_t)aggregate*4+(size_t)texts*2+12);
   if((kind==F7_GRAPH_ERROR||kind==F7_GRAPH_AGGREGATE)?proto!=0:
      kind==F7_GRAPH_ARRAY?proto!=3:(proto!=1&&proto!=2))return F7_INVALID;
  }
  if(kind==F7_GRAPH_PRIMITIVE&&!primitive_valid(p+at+(size_t)aggregate*4+(size_t)texts*2,
     native,read32(p+at-32+20),(p[at-32+4]>>2)&3))return F7_INVALID;
  if(kind==F7_GRAPH_PRIMITIVE&&(read32(p+at-32+16)||read32(p+at-32+24)||
     (p[at-32+4]&3)!=F7_TEXT_ABSENT||((p[at-32+4]>>4)&3)!=F7_TEXT_ABSENT))return F7_INVALID;
  at+=(size_t)bytes;
 }
 return at==length?F7_OK:F7_INVALID;
}
