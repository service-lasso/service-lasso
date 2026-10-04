#ifndef SERVICE_LASSO_F7_ORIGINAL_ERROR_NODE_H
#define SERVICE_LASSO_F7_ORIGINAL_ERROR_NODE_H
#ifndef NAPI_VERSION
#define NAPI_VERSION 8
#endif
#include <node_api.h>
#include "error-graph.h"
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
};
struct f7_original_error_result {
 napi_value original_primary,serialization_exception;
 napi_status native_status,exception_query_status,exception_restore_status;
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
#ifdef __cplusplus
}
#endif
#endif
