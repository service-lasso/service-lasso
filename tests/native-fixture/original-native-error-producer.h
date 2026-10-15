#ifndef SERVICE_LASSO_F7_ORIGINAL_NATIVE_ERROR_PRODUCER_H
#define SERVICE_LASSO_F7_ORIGINAL_NATIVE_ERROR_PRODUCER_H
#include "error-graph.h"
#include "error-producer-queue.h"
#ifdef __cplusplus
extern "C" {
#endif
struct f7_original_native_delivery {
 const struct f7_error_graph *original_graph;
 size_t serialized_bytes;uint64_t ticket;
 int serialization_result,submission_result;
};
/* The original admitted native W adapter supplies original raw native records,
   their exact graph ordering, a live authenticated queue and reserved storage.
   No PowerShell formatting, string conversion or source admission occurs here.
   Original helper/PowerShell record extraction and ROOT caller are still owned
   outside this private producer. Every failure retains their original graph. */
int f7_original_native_error_produce(const struct f7_error_graph *original_graph,
 uint8_t *payload,size_t capacity,struct f7_error_queue *original_queue,
 struct f7_original_native_delivery *out);
#ifdef __cplusplus
}
#endif
#endif
