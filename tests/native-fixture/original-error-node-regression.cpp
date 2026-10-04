#include "original-error-node-regression.h"
#include <string.h>
namespace {
static napi_value original_throw(napi_env env,napi_callback_info info){
 void *value=NULL;size_t argc=0;
 if(napi_get_cb_info(env,info,&argc,NULL,NULL,&value)!=napi_ok||!value)return NULL;
 auto *context=(f7_original_error_regression_context *)value;context->calls++;
 napi_value original=NULL;context->query_status=napi_get_reference_value(env,context->original,&original);
 if(context->query_status!=napi_ok||!original)return NULL;
 context->throw_status=napi_throw(env,original);return NULL;
}
static uint32_t number(const uint8_t *p){return ((uint32_t)p[0]<<24)|((uint32_t)p[1]<<16)|((uint32_t)p[2]<<8)|p[3];}
static int same(napi_env env,napi_value first,napi_value second,napi_status *status){
 bool equal=false;*status=napi_strict_equals(env,first,second,&equal);
 return *status==napi_ok&&equal;
}
}
extern "C" int f7_original_error_native_regression(napi_env env,
 f7_original_error_workspace *w,f7_original_error_regression_context *context,
 uint8_t *payload,size_t capacity,napi_status *status){
 if(!env||!w||!context||context->original||!payload||!status)return F7_INVALID;*status=napi_ok;
#define CALL(operation) do{*status=(operation);if(*status!=napi_ok)return F7_NATIVE_FAILURE;}while(0)
 char16_t original_units[]={u'x',0xd800,0};napi_value message,first,second,aggregate,array,plain;
 CALL(napi_create_string_utf16(env,original_units,3,&message));
 CALL(napi_create_error(env,NULL,message,&first));CALL(napi_create_error(env,NULL,message,&second));
 CALL(napi_set_named_property(env,first,"cause",second));CALL(napi_set_named_property(env,second,"cause",first));
 CALL(napi_create_object(env,&plain));CALL(napi_set_named_property(env,plain,"self",plain));
 napi_value negative_zero,positive_zero,bigint;
 CALL(napi_create_double(env,-0.0,&negative_zero));CALL(napi_create_double(env,0.0,&positive_zero));
 CALL(napi_create_bigint_uint64(env,0,&bigint));
 CALL(napi_set_named_property(env,plain,"negative",negative_zero));
 CALL(napi_set_named_property(env,plain,"positive",positive_zero));CALL(napi_set_named_property(env,plain,"bigint",bigint));
 CALL(napi_set_named_property(env,first,"detail",plain));
 CALL(napi_create_array_with_length(env,4,&array));
 CALL(napi_set_element(env,array,0,second));CALL(napi_set_element(env,array,1,second));
 CALL(napi_set_element(env,array,2,first));CALL(napi_set_element(env,array,3,plain));
 napi_value arguments[]={array,message};CALL(napi_new_instance(env,w->aggregate_constructor,2,arguments,&aggregate));
 CALL(napi_set_named_property(env,aggregate,"cause",first));
 napi_value secondary[]={second,first,second};f7_original_error_result result;
 int encoded=f7_original_error_encode(env,aggregate,aggregate,secondary,3,w,payload,capacity,&result);
 if(encoded||!result.identity_checked||!result.identity_equal||
    !same(env,result.original_primary,aggregate,status)||
    f7_error_graph_validate(payload,result.length,(uint32_t)w->node_capacity))return F7_CONFLICT;
 if(number(payload+16)!=1||number(payload+20)!=3||number(payload+24)!=number(payload+32))return F7_CONFLICT;
 uint32_t first_id=number(payload+28),second_id=number(payload+24);
 if(!first_id||!second_id||first_id>w->node_count||second_id>w->node_count||
    !same(env,w->originals[first_id-1],first,status)||!same(env,w->originals[second_id-1],second,status))return F7_CONFLICT;
 if(w->nodes[first_id-1].cause!=second_id||w->nodes[second_id-1].cause!=first_id||
    w->nodes[0].aggregate_count!=4||w->nodes[0].aggregate[0]!=second_id||
    w->nodes[0].aggregate[1]!=second_id||w->nodes[0].aggregate[2]!=first_id)return F7_CONFLICT;
 auto &text=w->nodes[first_id-1].message;
 if(text.state!=F7_TEXT_STRING||text.count!=3||text.units[0]!='x'||text.units[1]!=0xd800||text.units[2])return F7_CONFLICT;
 int negative=0,positive=0;
 for(size_t i=0;i<w->node_count;i++){
  auto *node=w->nodes+i;if(node->kind!=F7_GRAPH_PRIMITIVE||node->original_native_length!=9||node->original_native[0]!=5)continue;
  uint64_t bits=f7_read_u64be(node->original_native+1);
  if(bits==UINT64_C(0x8000000000000000))negative=1;if(!bits)positive=1;
 }
 if(!negative||!positive)return F7_CONFLICT;
 /* Identity mismatch must precede a getter that throws the ORIGINAL second
    Error. This tests the actual production serializer against native objects. */
 context->calls=0;
 for(size_t i=0;i<w->held_count;i++){
  napi_value original=NULL;CALL(napi_get_reference_value(env,w->held[i],&original));
  if(same(env,original,second,status)){context->original=w->held[i];break;}
  if(*status!=napi_ok)return F7_NATIVE_FAILURE;
 }
 if(!context->original)return F7_CONFLICT;
 napi_property_descriptor descriptor={};
 descriptor.utf8name="stack";descriptor.getter=original_throw;descriptor.data=context;
 descriptor.attributes=napi_configurable;
 CALL(napi_define_properties(env,first,1,&descriptor));
 encoded=f7_original_error_encode(env,first,second,NULL,0,w,payload,capacity,&result);
 if(encoded!=F7_AUTH_FAILURE||context->calls||!result.identity_checked||result.identity_equal||
    !same(env,result.original_primary,first,status))return F7_CONFLICT;
 encoded=f7_original_error_encode(env,first,first,NULL,0,w,payload,capacity,&result);
 if(encoded!=F7_NATIVE_FAILURE||context->calls!=1||context->query_status!=napi_ok||context->throw_status!=napi_ok||
    result.exception_keeper_result!=F7_OK||result.native_status!=napi_pending_exception||
    result.exception_query_status!=napi_ok||result.exception_restore_status!=napi_ok)return F7_CONFLICT;
 bool pending=false;CALL(napi_is_exception_pending(env,&pending));if(!pending)return F7_CONFLICT;
 napi_value caught;CALL(napi_get_and_clear_last_exception(env,&caught));
 if(!same(env,caught,second,status)||!same(env,result.serialization_exception,second,status)||
    !same(env,result.original_primary,first,status))return F7_CONFLICT;
 /* Source geometry/refusal never substitutes a replacement Error. */
 size_t saved=w->primitive_capacity;w->primitive_capacity=0;
 encoded=f7_original_error_encode(env,second,second,NULL,0,w,payload,capacity,&result);
 w->primitive_capacity=saved;
 if(encoded!=F7_BUDGET_ABSENT||!same(env,result.original_primary,second,status))return F7_CONFLICT;
#undef CALL
 return F7_OK;
}
