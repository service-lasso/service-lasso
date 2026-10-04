#ifndef SERVICE_LASSO_F7_ORIGINAL_ERROR_NODE_REGRESSION_H
#define SERVICE_LASSO_F7_ORIGINAL_ERROR_NODE_REGRESSION_H
#include "original-error-node.h"
#ifdef __cplusplus
extern "C" {
#endif
/* Actual Node-API source regression cases in the original caller's live
   native env, not a JS object simulator or a substitute W/fixture lifecycle.
   The original native fixture owner must call this with separately admitted
   source/stack/workspace inputs; its owning entry remains ABSENT. UNEXECUTED. */
int f7_original_error_native_regression(napi_env env,
 struct f7_original_error_workspace *workspace,uint8_t *payload,size_t capacity,
 napi_status *native_status);
#ifdef __cplusplus
}
#endif
#endif
