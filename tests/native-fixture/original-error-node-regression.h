#ifndef SERVICE_LASSO_F7_ORIGINAL_ERROR_NODE_REGRESSION_H
#define SERVICE_LASSO_F7_ORIGINAL_ERROR_NODE_REGRESSION_H
#include "original-error-node.h"
#ifdef __cplusplus
extern "C" {
#endif
struct f7_original_error_regression_context {
 napi_ref original;unsigned calls;napi_status query_status,throw_status;
};
/* Actual Node-API source regression cases in the original caller's live
   native env, not a JS object simulator or a substitute W/fixture lifecycle.
   The original native fixture owner must call this with separately admitted
   source/stack/workspace inputs; its owning entry remains ABSENT. UNEXECUTED.
   Caller owns the getter context and persistent strong-reference arena until
   all original Error/getter lifetimes settle; callback-local storage is refused. */
int f7_original_error_native_regression(napi_env env,
 struct f7_original_error_workspace *original_workspaces,size_t workspace_count,
 struct f7_original_error_regression_context *original_context,
 uint8_t *payload,size_t capacity,
 napi_status *native_status);
#ifdef __cplusplus
}
#endif
#endif
