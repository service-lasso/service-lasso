#ifndef SERVICE_LASSO_F7_ORIGINAL_ERROR_NODE_H
#define SERVICE_LASSO_F7_ORIGINAL_ERROR_NODE_H
#ifndef NAPI_VERSION
#define NAPI_VERSION 8
#endif
#include <node_api.h>
#include "error-graph.h"
#include "partial-error.h"
#ifdef __cplusplus
extern "C" {
#endif
struct f7_original_property_read {
 napi_value owner,value;uint32_t kind,index;
};
struct f7_original_error_workspace {
 /* All original handles are in the actual caller's still-live native handle
    scope. This serializer never creates another isolate or a replacement Error.
    The caller retains original handles/references through failure settlement. */
 napi_value *originals;struct f7_error_node *nodes;size_t node_capacity,node_count;
 uint16_t *text;size_t text_capacity,text_used;
 char16_t *text_getter;size_t text_getter_capacity;
 uint32_t *references;size_t reference_capacity,reference_used;
 uint8_t *primitive;size_t primitive_capacity,primitive_used;
 uint64_t *bigint_words;size_t bigint_word_capacity;
 napi_value aggregate_constructor;
 napi_value original_object_prototype,original_array_prototype;
 struct f7_original_property_read *reads;size_t read_capacity,read_used;
 napi_env original_env;
 napi_ref *held;size_t held_capacity,held_count;
 int retained_incomplete;
 uint8_t *node_progress;size_t progress_capacity;
 uint8_t *partial_snapshot,*partial_fragment;size_t partial_capacity,fragment_capacity,partial_length;
};
struct f7_original_error_result {
 napi_value original_primary,serialization_exception;
 napi_value keeper_exception;
 napi_status native_status,exception_query_status,exception_restore_status;
 napi_status exception_keeper_status,keeper_exception_query_status;
 int exception_keeper_result;
 int identity_checked,identity_equal;size_t length;
};
/* PRIVATE original-W producer source. The owning admitted adapter supplies the
   actual env/original values and prepared workspaces only after original O
   readiness. These parameters cannot admit a W/ROOT role or create a capsule.
   expected_original is the actual injected Error when identity is required,
   NULL otherwise; mismatch is recorded before any Error field/getter access.
   Pending serialization exceptions are preserved/restored, never substituted
   for original_primary. Raw PowerShell/native errors use the separate original
   native-byte producer rather than conversion/coercion through a JS string. */
int f7_original_error_encode(napi_env env,napi_value primary,napi_value expected_original,
 const napi_value *secondary,size_t secondary_count,struct f7_original_error_workspace *workspace,
 uint8_t *payload,size_t capacity,struct f7_original_error_result *out);
/* Pure source-storage preflight before the larger producer result is reset.
   No Node-API call, original handle access or authority issuance occurs. */
int f7_original_error_storage_validate(struct f7_original_error_workspace *workspace,
 uint8_t *payload,size_t capacity,const napi_value *secondary,size_t secondary_count,
 void *output,size_t output_bytes,const void *native_owner,size_t native_owner_bytes);
#ifdef __cplusplus
}
#endif
#endif
