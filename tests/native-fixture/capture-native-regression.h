#ifndef SERVICE_LASSO_F7_CAPTURE_NATIVE_REGRESSION_H
#define SERVICE_LASSO_F7_CAPTURE_NATIVE_REGRESSION_H
#include "observer.h"
#ifdef __cplusplus
extern "C" {
#endif
struct f7_original_capture_expectation {
 const uint8_t *raw[F7_STREAM_COUNT];size_t raw_length[F7_STREAM_COUNT];
 int natural_eof[F7_STREAM_COUNT],capture_result;
};
/* Actual native readback/worker settlement regression SOURCE for the original
   independently admitted fixture owner. All objects, expected ORIGINAL bytes,
   finite scratch/deadline and row decisions come from its original inputs.
   No new fixture/profile/actor, synthetic readback, cleanup or authority. */
int f7_capture_native_regression(struct f7_capture *capture,
 const struct f7_capture_readbacks *original_reads,
 const struct f7_original_capture_expectation *original_expected,
 uint8_t *original_scratch,size_t scratch_capacity,uint64_t absolute_deadline,
 int64_t *original_native_status);
#ifdef __cplusplus
}
#endif
#endif
