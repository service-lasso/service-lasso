#ifndef SERVICE_LASSO_F7_ERROR_GRAPH_H
#define SERVICE_LASSO_F7_ERROR_GRAPH_H
#include "protocol.h"
#ifdef __cplusplus
extern "C" {
#endif
enum f7_error_kind {F7_GRAPH_ERROR=1,F7_GRAPH_AGGREGATE=2,F7_GRAPH_PRIMITIVE=3,F7_GRAPH_NATIVE=4};
enum f7_cause_kind {F7_CAUSE_ABSENT=0,F7_CAUSE_REFERENCE=1,F7_CAUSE_UNDEFINED=2,F7_CAUSE_NULL=3};
struct f7_error_text {const uint16_t *units;uint32_t count;};
struct f7_error_node {
 enum f7_error_kind kind;enum f7_cause_kind cause_kind;uint32_t cause;
 struct f7_error_text name,message,stack;
 const uint32_t *aggregate;uint32_t aggregate_count;
 const uint8_t *original_native;uint32_t original_native_length;
};
struct f7_error_graph {
 const struct f7_error_node *nodes;uint32_t count,primary;
 const uint32_t *secondary;uint32_t secondary_count;
};
/* IDs are graph-local original-object references, not process/resource IDs.
   Native producers preserve original UTF16 code units and unmodified native
   records. Cycles/repeated objects are permitted; aggregate order is exact. */
int f7_error_graph_encode(const struct f7_error_graph *graph,uint8_t *out,
 size_t capacity,size_t *length);
int f7_error_graph_validate(const uint8_t *payload,size_t length,uint32_t node_limit);
#ifdef __cplusplus
}
#endif
#endif
