#ifndef SERVICE_LASSO_F7_ERROR_PRODUCER_ENDPOINT_H
#define SERVICE_LASSO_F7_ERROR_PRODUCER_ENDPOINT_H
#include "error-producer-queue.h"
#ifdef __cplusplus
extern "C" {
#endif
/* Independently admitted original expected object/peer/lifetime is a
   prerequisite. Native queries only test those expectations; PID/bytes alone
   cannot issue role/source admission. Every attempted call is retained. */
int f7_error_endpoint_write(const struct f7_error_endpoint *endpoint,
 const uint8_t *bytes,size_t length,struct f7_producer_native_fact *fact);
int f7_error_endpoint_call(struct f7_producer_native_fact *fact,uint64_t operation,
 uint64_t argument,int64_t result,int64_t error);
#ifdef __cplusplus
}
#endif
#endif
