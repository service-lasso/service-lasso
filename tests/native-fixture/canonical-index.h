#ifndef SERVICE_LASSO_F7_INDEX_H
#define SERVICE_LASSO_F7_INDEX_H
#include "transport-crypto.h"
#ifdef __cplusplus
extern "C" {
#endif
enum f7_object_kind {F7_ENCRYPTED_SEGMENT=1,F7_ENCRYPTED_MANIFEST=2};
struct f7_index_object {uint8_t key[16],sha256[32];uint64_t length;enum f7_object_kind kind;};
struct f7_index_input {
 uint8_t invocation[16],attempt[32],observer_key[32],receiver_key[32];
 uint8_t plaintext_manifest_sha256[32];
 const struct f7_index_object *objects;size_t count;
};
/* Input roster MUST already be sorted: refuse duplicates/out-of-order, never
   normalize an attacker-selected alternative inventory into a passing one. */
int f7_canonical_index(const struct f7_index_input *input,uint8_t *out,
 size_t capacity,size_t *length);
/* Caller reserves explicit roster and scratch capacity from exact admission.
   Decoder rejects every noncanonical/extra field or byte; no JSON fallback. */
int f7_decode_index(const uint8_t *bytes,size_t length,
 struct f7_index_input *out,struct f7_index_object *objects,size_t object_capacity,
 uint8_t *canonical_scratch,size_t scratch_capacity);
struct f7_segment_input {
 uint8_t invocation[16],attempt[32],member[16],full_sha256[32];
 uint64_t offset,length,full_size,ordinal,count;
};
int f7_canonical_segment_metadata(const struct f7_segment_input *input,
 uint8_t *out,size_t capacity,size_t *length);
#ifdef __cplusplus
}
#endif
#endif
