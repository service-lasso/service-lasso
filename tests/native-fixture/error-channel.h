#ifndef SERVICE_LASSO_F7_ERROR_CHANNEL_H
#define SERVICE_LASSO_F7_ERROR_CHANNEL_H
#include "protocol.h"
#include "partial-error.h"
#ifdef __cplusplus
extern "C" {
#endif
struct f7_error_channel {
 uint8_t invocation[16],attempt[32],lifetime[16];uint16_t role;
 uint8_t header[F7_FRAME_HEADER_SIZE];size_t header_used;
 uint64_t sequence,ordinal,frames,payload_bytes;
 uint32_t remaining;
 uint8_t *payload;size_t payload_capacity,payload_used;
 uint16_t payload_type;uint32_t graph_node_limit;
 int failed,incomplete;
 struct f7_partial_reader *partial;
 uint64_t partial_message;
};
/* Graph bytes are validated in the original admitted channel before terminal
   acceptance. This never substitutes for the original W identity assertion. */
int f7_error_channel_feed(struct f7_error_channel *channel,const uint8_t *bytes,
 size_t length,uint64_t admitted_frame_count,uint64_t admitted_payload_bytes);
int f7_error_channel_eof(struct f7_error_channel *channel);
#ifdef __cplusplus
}
#endif
#endif
