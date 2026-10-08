#ifndef SERVICE_LASSO_F7_ORIGINAL_ERROR_PRODUCER_H
#define SERVICE_LASSO_F7_ORIGINAL_ERROR_PRODUCER_H
#include "original-error-node.h"
#include "error-producer-queue.h"
#include "serialization-fallback.h"
#ifdef __cplusplus
extern "C" {
#endif
struct f7_original_error_delivery {
 struct f7_original_error_result original;
 uint64_t ticket;int serialization_result,submission_result;
 uint64_t partial_last_ticket,partial_fragments;
 size_t partial_bytes;int partial_result;
};
/* Actual serializer-to-native queue path. The original admitted W adapter
   supplies an independently prepared/authenticated original queue and retains
   every original VM handle/reference until actual custody settlement. This
   function returns queued bytes/ticket only, never ROOT/source admission,
   O persistence/readback, original W exit/reset or cleanup authority. */
int f7_original_error_produce(napi_env env,napi_value primary,napi_value expected,
 const napi_value *secondary,size_t secondary_count,struct f7_original_error_workspace *workspace,
 uint8_t *payload,size_t capacity,struct f7_error_queue *queue,
 struct f7_original_error_delivery *out);
#ifdef __cplusplus
}
#endif
#endif
