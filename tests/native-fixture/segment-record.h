#ifndef SERVICE_LASSO_F7_SEGMENT_RECORD_H
#define SERVICE_LASSO_F7_SEGMENT_RECORD_H
#include "canonical-index.h"
#define F7_SEGMENT_HEADER_BYTES 160u
int f7_segment_encode(uint8_t out[F7_SEGMENT_HEADER_BYTES],const struct f7_segment_input *input);
int f7_segment_decode(struct f7_segment_input *out,const uint8_t header[F7_SEGMENT_HEADER_BYTES]);
int f7_segment_record_decode(struct f7_segment_input *out,const uint8_t **raw,
 const uint8_t *record,size_t length,const uint8_t invocation[16],
 const uint8_t attempt[32],const uint8_t member[16]);
#endif
