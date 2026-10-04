#ifndef SERVICE_LASSO_F7_MANIFEST_READER_H
#define SERVICE_LASSO_F7_MANIFEST_READER_H
#include "plaintext-manifest.h"
#ifdef __cplusplus
extern "C" {
#endif
/* Parsed claims are data only. They contain no native handles, admitted
   capsule, persisted/readback flags or successor capability constructor. */
struct f7_decoded_member {
 uint8_t key[16],digest[32];uint64_t length;enum f7_record_kind kind;
 struct f7_identity asserted_identity;int failed;
};
struct f7_decoded_stream {
 enum f7_creation_decision creation;int natural_eof;
 uint64_t observed;uint8_t native_status_bits[8];
};
struct f7_decoded_manifest {
 uint8_t admission[32],invocation[16],attempt[32],head[20],tree[20],base[20];
 uint64_t attempt_ordinal;enum f7_platform platform;unsigned row;
 enum f7_creation_decision child_creation;int child_exit_observed,incomplete;
 struct f7_decoded_stream streams[F7_STREAM_COUNT];struct f7_budget_input budgets;
 struct f7_decoded_member *members;size_t member_capacity,member_count;
 struct f7_manifest_segment *segments;size_t segment_capacity,segment_count;
 struct f7_manifest_unavailable *unavailable;size_t unavailable_capacity,unavailable_count;
};
int f7_decode_manifest(const uint8_t *bytes,size_t length,struct f7_decoded_manifest *out);
#ifdef __cplusplus
}
#endif
#endif
