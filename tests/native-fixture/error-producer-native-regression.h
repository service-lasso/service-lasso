#ifndef SERVICE_LASSO_F7_PRODUCER_NATIVE_REGRESSION_H
#define SERVICE_LASSO_F7_PRODUCER_NATIVE_REGRESSION_H
#include "error-producer-queue.h"
#ifdef __cplusplus
extern "C" {
#endif
/* Source for the original admitted native fixture owner. These functions
   require its already-created queue and bytes actually read from its held
   endpoint. No source grant, endpoint creation, parser execution or synthetic
   receiver is supplied here. The owner keeps original VM handles alive. */
int f7_producer_regression_submit(struct f7_error_queue *queue,
 const uint8_t *original_graph,size_t length,uint64_t *ticket);
int f7_producer_regression_observed(struct f7_error_queue *queue,
 const struct f7_error_queue_binding *original_binding,
 const uint8_t *original_graph,size_t graph_length,uint64_t ticket,
 const uint8_t *original_read,size_t read_length);
int f7_producer_regression_failed_retained(struct f7_error_queue *queue,
 uint64_t submitted,uint64_t delivered,uint64_t original_pending_bytes);
#ifdef __cplusplus
}
#endif
#endif
