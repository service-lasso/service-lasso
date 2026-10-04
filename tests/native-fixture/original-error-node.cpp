#include "original-error-node.h"
#include <string.h>
#include <limits>
static_assert(sizeof(double)==8&&std::numeric_limits<double>::is_iec559,
 "Exact original numeric bits require the separately admitted native ABI");
namespace {
static void u32(uint8_t *p,uint32_t value){
 p[0]=(uint8_t)(value>>24);p[1]=(uint8_t)(value>>16);p[2]=(uint8_t)(value>>8);p[3]=(uint8_t)value;
}
struct builder {
 napi_env env;f7_original_error_workspace *w;f7_original_error_result *out;
 int api(napi_status status){
  if(status==napi_ok)return F7_OK;
  out->native_status=status;return F7_NATIVE_FAILURE;
 }
 int remembered(napi_value owner,uint32_t kind,uint32_t index,napi_value *value,int *found){
  *found=0;
  for(size_t i=0;i<w->read_used;i++){
   auto *read=w->reads+i;if(read->kind!=kind||read->index!=index)continue;
   bool same=false;int result=api(napi_strict_equals(env,owner,read->owner,&same));
   if(result)return result;if(same){*value=read->value;*found=1;return F7_OK;}
  }
  return F7_OK;
 }
 int remember(napi_value owner,uint32_t kind,uint32_t index,napi_value value){
  if(w->read_used==w->read_capacity)return F7_OVERFLOWED;
  w->reads[w->read_used++]={owner,value,kind,index};return F7_OK;
 }
 static uint32_t field_kind(const char *name){
  return !strcmp(name,"name")?1:!strcmp(name,"message")?2:!strcmp(name,"stack")?3:
    !strcmp(name,"cause")?4:!strcmp(name,"errors")?5:!strcmp(name,"length")?6:0;
 }
 int named(napi_value owner,const char *name,napi_value *value){
  uint32_t kind=field_kind(name);int found=0;
  int result=remembered(owner,kind,0,value,&found);if(result||found)return result;
  result=api(napi_get_named_property(env,owner,name,value));if(result)return result;
  return remember(owner,kind,0,*value);
 }
 int element(napi_value owner,uint32_t index,napi_value *value){
  int found=0;int result=remembered(owner,7,index,value,&found);if(result||found)return result;
  result=api(napi_get_element(env,owner,index,value));if(result)return result;
  return remember(owner,7,index,*value);
 }
 static int key_is(const f7_error_text *key,const char *text){
  size_t n=strlen(text);if(key->count!=n)return 0;
  for(size_t i=0;i<n;i++)if(key->units[i]!=(uint8_t)text[i])return 0;return 1;
 }
 int property(napi_value owner,napi_value key,const f7_error_text *text,napi_value *value){
  const char *names[]={"name","message","stack","cause","errors","length"};
  for(unsigned i=0;i<6;i++)if(key_is(text,names[i])){
   int found=0;int result=remembered(owner,i+1,0,value,&found);if(result||found)return result;
   result=api(napi_get_property(env,owner,key,value));if(result)return result;
   return remember(owner,i+1,0,*value);
  }
  uint64_t index=0;int numeric=text->count>0;
  for(uint32_t i=0;i<text->count&&numeric;i++){
   uint16_t unit=text->units[i];
   if(unit<'0'||unit>'9'||(i==0&&unit=='0'&&text->count>1)||index>(UINT32_MAX-(unit-'0'))/10)numeric=0;
   else index=index*10+(unit-'0');
  }
  if(numeric&&index<UINT32_MAX){
   int found=0;int result=remembered(owner,7,(uint32_t)index,value,&found);if(result||found)return result;
  }
  return api(napi_get_property(env,owner,key,value));
 }
 int reference(napi_value value,uint32_t *id){
  if(!value)return F7_INVALID;
  napi_valuetype type;int typed=api(napi_typeof(env,value,&type));if(typed)return typed;
  /* Strict equality is original object identity; it must not collapse +0/-0
     or other distinct native scalar representations into one scalar node. */
  for(size_t i=0;i<w->node_count&&(type==napi_object||type==napi_symbol||type==napi_function);i++){
   bool equal=false;int result=api(napi_strict_equals(env,w->originals[i],value,&equal));
   if(result)return result;if(equal){*id=(uint32_t)i+1;return F7_OK;}
  }
  if(w->node_count==w->node_capacity)return F7_OVERFLOWED;
  size_t i=w->node_count++;w->originals[i]=value;memset(w->nodes+i,0,sizeof(*w->nodes));
  *id=(uint32_t)i+1;return F7_OK;
 }
 int text(napi_value value,f7_error_text *out_text){
  napi_valuetype type;int result=api(napi_typeof(env,value,&type));if(result)return result;
  if(type==napi_undefined){out_text->state=F7_TEXT_UNDEFINED;return F7_OK;}
  if(type==napi_null){out_text->state=F7_TEXT_NULL;return F7_OK;}
  if(type!=napi_string)return F7_INCOMPLETE;
  size_t units=0,written=0;result=api(napi_get_value_string_utf16(env,value,NULL,0,&units));
  if(result)return result;
  if(units>UINT32_MAX||units>w->text_capacity-w->text_used||units>=w->text_getter_capacity)return F7_OVERFLOWED;
  result=api(napi_get_value_string_utf16(env,value,w->text_getter,units+1,&written));if(result)return result;
  if(written!=units)return F7_INCOMPLETE;
  out_text->units=w->text+w->text_used;out_text->count=(uint32_t)units;
  for(size_t i=0;i<units;i++)w->text[w->text_used+i]=(uint16_t)w->text_getter[i];
  out_text->state=F7_TEXT_STRING;w->text_used+=units;return F7_OK;
 }
 int field(napi_value object,const char *name,f7_error_text *out_text){
  bool present=false;napi_value value;
  int result=api(napi_has_named_property(env,object,name,&present));if(result)return result;
  if(!present){out_text->state=F7_TEXT_ABSENT;return F7_OK;}
  result=named(object,name,&value);if(result)return result;
  return text(value,out_text);
 }
 int bytes(size_t n,uint8_t **out_bytes){
  if(n>w->primitive_capacity-w->primitive_used)return F7_OVERFLOWED;
  *out_bytes=w->primitive+w->primitive_used;w->primitive_used+=n;return F7_OK;
 }
 int own_properties(napi_value original,f7_error_node *node,uint32_t prototype_kind){
  napi_value keys;uint32_t count=0;
  int result=api(napi_get_all_property_names(env,original,napi_key_own_only,
    napi_key_all_properties,napi_key_numbers_to_strings,&keys));if(result)return result;
  result=api(napi_get_array_length(env,keys,&count));if(result)return result;
  if(count>(F7_FRAME_MAX-16)/8)return F7_OVERFLOWED;
  size_t start=w->primitive_used;uint8_t *header;
  result=bytes(16,&header);if(result)return result;
  memcpy(header,"SLF7PRP1",8);u32(header+8,count);u32(header+12,prototype_kind);
  for(uint32_t i=0;i<count;i++){
   napi_value key,value;f7_error_text name={};uint32_t id;
   result=api(napi_get_element(env,keys,i,&key));if(result)return result;
   result=text(key,&name);if(result)return result;
   if(name.state!=F7_TEXT_STRING)return F7_INCOMPLETE;
   result=property(original,key,&name,&value);if(result)return result;
   result=reference(value,&id);if(result)return result;
   uint8_t *entry;result=bytes(8+(size_t)name.count*2,&entry);if(result)return result;
   u32(entry,name.count);u32(entry+4,id);
   for(uint32_t j=0;j<name.count;j++){entry[8+2*(size_t)j]=(uint8_t)(name.units[j]>>8);entry[9+2*(size_t)j]=(uint8_t)name.units[j];}
  }
  node->original_native=w->primitive+start;
  node->original_native_length=(uint32_t)(w->primitive_used-start);return F7_OK;
 }
 int primitive(napi_value value,napi_valuetype type,f7_error_node *node){
  uint8_t *record;int result;node->kind=F7_GRAPH_PRIMITIVE;
  node->name.state=node->message.state=node->stack.state=F7_TEXT_ABSENT;
  if(type==napi_string){result=text(value,&node->message);if(result)return result;}
  if(type==napi_undefined||type==napi_null||type==napi_string){
   result=bytes(1,&record);if(result)return result;
   record[0]=type==napi_undefined?1:type==napi_null?2:3;node->original_native_length=1;
  }else if(type==napi_boolean){
   bool value_bool;result=api(napi_get_value_bool(env,value,&value_bool));if(result)return result;
   result=bytes(2,&record);if(result)return result;record[0]=4;record[1]=(uint8_t)value_bool;node->original_native_length=2;
  }else if(type==napi_number){
   double number;uint64_t bits;result=api(napi_get_value_double(env,value,&number));if(result)return result;
   memcpy(&bits,&number,8);result=bytes(9,&record);if(result)return result;
   record[0]=5;f7_u64be(record+1,bits);node->original_native_length=9;
  }else if(type==napi_bigint){
   size_t count=0;int sign=0;
   result=api(napi_get_value_bigint_words(env,value,NULL,&count,NULL));if(result)return result;
   if(count>w->bigint_word_capacity||count>(F7_FRAME_MAX-6)/8)return F7_OVERFLOWED;
   size_t actual=count;result=api(napi_get_value_bigint_words(env,value,&sign,&actual,w->bigint_words));if(result)return result;
   if(actual!=count||(sign!=0&&sign!=1))return F7_INCOMPLETE;
   result=bytes(6+count*8,&record);if(result)return result;
   record[0]=6;record[1]=(uint8_t)sign;u32(record+2,(uint32_t)count);
   for(size_t i=0;i<count;i++)f7_u64be(record+6+i*8,w->bigint_words[i]);
   node->original_native_length=(uint32_t)(6+count*8);
  }else return F7_INCOMPLETE;
  node->original_native=record;return F7_OK;
 }
 int node(size_t index){
  napi_value value=w->originals[index];f7_error_node *item=w->nodes+index;
  napi_valuetype type;int result=api(napi_typeof(env,value,&type));if(result)return result;
  if(type!=napi_object)return primitive(value,type,item);
  bool error=false,aggregate=false;
  result=api(napi_is_error(env,value,&error));if(result)return result;
  if(!error){
   bool array=false;result=api(napi_is_array(env,value,&array));if(result)return result;
   napi_value prototype;result=api(napi_get_prototype(env,value,&prototype));if(result)return result;
   napi_valuetype prototype_type;result=api(napi_typeof(env,prototype,&prototype_type));if(result)return result;
   bool same=false;uint32_t prototype_kind=2;
   if(prototype_type!=napi_null){
    result=api(napi_strict_equals(env,prototype,array?w->original_array_prototype:w->original_object_prototype,&same));
    if(result)return result;if(!same)return F7_INCOMPLETE;
    prototype_kind=array?3:1;
   }else if(array)return F7_INCOMPLETE;
   item->kind=array?F7_GRAPH_ARRAY:F7_GRAPH_OBJECT;
   item->name.state=item->message.state=item->stack.state=F7_TEXT_ABSENT;
   return own_properties(value,item,prototype_kind);
  }
  result=api(napi_instanceof(env,value,w->aggregate_constructor,&aggregate));if(result)return result;
  item->kind=aggregate?F7_GRAPH_AGGREGATE:F7_GRAPH_ERROR;
  result=field(value,"name",&item->name);if(result)return result;
  result=field(value,"message",&item->message);if(result)return result;
  result=field(value,"stack",&item->stack);if(result)return result;
  bool present=false;result=api(napi_has_named_property(env,value,"cause",&present));if(result)return result;
  if(present){
   napi_value cause;result=named(value,"cause",&cause);if(result)return result;
   napi_valuetype cause_type;result=api(napi_typeof(env,cause,&cause_type));if(result)return result;
   if(cause_type==napi_undefined)item->cause_kind=F7_CAUSE_UNDEFINED;
   else if(cause_type==napi_null)item->cause_kind=F7_CAUSE_NULL;
   else{item->cause_kind=F7_CAUSE_REFERENCE;result=reference(cause,&item->cause);if(result)return result;}
  }
  if(aggregate){
   napi_value errors;bool array=false;uint32_t count=0;
   result=named(value,"errors",&errors);if(result)return result;
   result=api(napi_is_array(env,errors,&array));if(result)return result;
   if(!array)return F7_INCOMPLETE;
   result=api(napi_get_array_length(env,errors,&count));if(result)return result;
   napi_value original_length;result=named(errors,"length",&original_length);if(result)return result;
   if(count>w->reference_capacity-w->reference_used)return F7_OVERFLOWED;
   uint32_t *references=w->references+w->reference_used;w->reference_used+=count;
   item->aggregate=references;item->aggregate_count=count;
   for(uint32_t i=0;i<count;i++){
    napi_value original;bool exists=false;
    result=api(napi_has_element(env,errors,i,&exists));if(result)return result;
    if(!exists)return F7_INCOMPLETE;
    result=element(errors,i,&original);if(result)return result;
    result=reference(original,references+i);if(result)return result;
   }
  }
  return own_properties(value,item,0);
 }
};
static void preserve_exception(napi_env env,f7_original_error_result *out){
 bool pending=false;out->exception_query_status=napi_is_exception_pending(env,&pending);
 if(out->exception_query_status!=napi_ok||!pending)return;
 out->exception_query_status=napi_get_and_clear_last_exception(env,&out->serialization_exception);
 if(out->exception_query_status==napi_ok&&out->serialization_exception)
  out->exception_restore_status=napi_throw(env,out->serialization_exception);
}
static int geometry(f7_original_error_workspace *w,uint8_t *payload,size_t capacity,
 const napi_value *secondary,size_t secondary_count,f7_original_error_result *out){
 struct span {uintptr_t address;size_t length;};
 span spans[]={
  {(uintptr_t)w,sizeof(*w)},{(uintptr_t)out,sizeof(*out)},
  {(uintptr_t)payload,capacity},{(uintptr_t)secondary,secondary_count*sizeof(*secondary)},
  {(uintptr_t)w->originals,w->node_capacity*sizeof(*w->originals)},
  {(uintptr_t)w->nodes,w->node_capacity*sizeof(*w->nodes)},
  {(uintptr_t)w->text,w->text_capacity*sizeof(*w->text)},
  {(uintptr_t)w->text_getter,w->text_getter_capacity*sizeof(*w->text_getter)},
  {(uintptr_t)w->references,w->reference_capacity*sizeof(*w->references)},
  {(uintptr_t)w->primitive,w->primitive_capacity},
  {(uintptr_t)w->bigint_words,w->bigint_word_capacity*sizeof(*w->bigint_words)},
  {(uintptr_t)w->reads,w->read_capacity*sizeof(*w->reads)}
 };
 for(size_t i=0;i<sizeof(spans)/sizeof(spans[0]);i++){
  if(spans[i].length>UINTPTR_MAX-spans[i].address)return F7_INVALID;
  if(!spans[i].length)continue;
  for(size_t j=0;j<i;j++){
   if(!spans[j].length)continue;
   if(!(spans[i].address+spans[i].length<=spans[j].address||
        spans[j].address+spans[j].length<=spans[i].address))return F7_INVALID;
  }
 }
 return F7_OK;
}
}
extern "C" int f7_original_error_encode(napi_env env,napi_value primary,napi_value expected,
 const napi_value *secondary,size_t secondary_count,f7_original_error_workspace *w,
 uint8_t *payload,size_t capacity,f7_original_error_result *out){
 if(!out)return F7_INVALID;
 if(!env||!primary||!w||!payload||!capacity||capacity>F7_FRAME_MAX||
    !w->originals||!w->nodes||!w->node_capacity||w->node_capacity>(F7_FRAME_MAX-24)/32||
    !w->text||!w->text_capacity||w->text_capacity>F7_FRAME_MAX||
    !w->text_getter||!w->text_getter_capacity||w->text_getter_capacity>F7_FRAME_MAX+1u||
    !w->references||!w->reference_capacity||w->reference_capacity>F7_FRAME_MAX/4||
    !w->primitive||!w->primitive_capacity||w->primitive_capacity>F7_FRAME_MAX||
    !w->bigint_words||!w->bigint_word_capacity||w->bigint_word_capacity>F7_FRAME_MAX/8||
    !w->reads||!w->read_capacity||w->read_capacity>F7_FRAME_MAX||
    !w->aggregate_constructor||!w->original_object_prototype||!w->original_array_prototype||
    (secondary_count&&!secondary)||secondary_count>w->reference_capacity){
  memset(out,0,sizeof(*out));out->original_primary=primary;return F7_BUDGET_ABSENT;
 }
 int shape=geometry(w,payload,capacity,secondary,secondary_count,out);if(shape)return shape;
 memset(out,0,sizeof(*out));out->original_primary=primary;
 w->node_count=1;w->originals[0]=primary;memset(w->nodes,0,sizeof(*w->nodes));
 w->text_used=w->reference_used=w->primitive_used=w->read_used=0;builder build={env,w,out};int result=F7_OK;
 if(expected){
  bool same=false;result=build.api(napi_strict_equals(env,primary,expected,&same));
  out->identity_checked=1;out->identity_equal=(int)same;
  if(result){preserve_exception(env,out);return result;}
  if(!same)return F7_AUTH_FAILURE;
 }
 uint32_t *original_secondary=w->references;w->reference_used=secondary_count;
 for(size_t i=0;i<secondary_count;i++){
  result=build.reference(secondary[i],original_secondary+i);if(result){preserve_exception(env,out);return result;}
 }
 for(size_t i=0;i<w->node_count;i++){
  result=build.node(i);if(result){preserve_exception(env,out);return result;}
 }
 f7_error_graph graph={w->nodes,(uint32_t)w->node_count,1,original_secondary,(uint32_t)secondary_count};
 return f7_error_graph_encode(&graph,payload,capacity,&out->length);
}
