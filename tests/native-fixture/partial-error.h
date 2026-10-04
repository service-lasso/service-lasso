#ifndef SERVICE_LASSO_F7_PARTIAL_ERROR_H
#define SERVICE_LASSO_F7_PARTIAL_ERROR_H
#include "error-graph.h"
#ifdef __cplusplus
extern "C" {
#endif
#define F7_PARTIAL_HEADER 48u
#define F7_PARTIAL_NODE 64u
#define F7_PARTIAL_MAX (F7_FRAME_MAX*6u)
struct f7_partial_graph_input {
 const struct f7_error_node *nodes;const uint8_t *progress;size_t node_count;
 const uint16_t *text;size_t text_count;
 const uint32_t *references;size_t reference_count;
 const uint8_t *native_bytes;size_t native_count;
};
/* Known original data only. Unknown fields are explicit 255, zero reference
   slots are uncaptured, and a partial native property prefix stays incomplete.
   No VM handles/addresses, object admission or complete capture is encoded. */
int f7_partial_graph_encode(const struct f7_partial_graph_input *original,
 uint8_t *out,size_t capacity,size_t *length);
int f7_partial_graph_validate(const uint8_t *bytes,size_t length,uint32_t node_limit);
#ifdef __cplusplus
}
#endif
#endif
