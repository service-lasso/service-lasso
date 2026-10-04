#ifndef SERVICE_LASSO_F7_ERROR_CHANNEL_H
#define SERVICE_LASSO_F7_ERROR_CHANNEL_H
#include "protocol.h"
#ifdef __cplusplus
extern "C" {
#endif
struct f7_error_channel {
 uint8_t invocation[16],attempt[32],lifetime[16];uint16_t role;
 uint8_t header[F7_FRAME_HEADER_SIZE];size_t header_used;
 uint64_t sequence,ordinal,frames,payload_bytes;
 uint32_t remaining;
 int failed;
};
/* This validates framing only; payload graph validation/in-isolate original
   Error identity are independent obligations, not established here. */
int f7_error_channel_feed(struct f7_error_channel *channel,const uint8_t *bytes,
 size_t length,uint64_t admitted_frame_count,uint64_t admitted_payload_bytes);
int f7_error_channel_eof(struct f7_error_channel *channel);
#ifdef __cplusplus
}
#endif
#endif
