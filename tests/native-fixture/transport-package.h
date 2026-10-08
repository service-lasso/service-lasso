#ifndef SERVICE_LASSO_F7_TRANSPORT_PACKAGE_H
#define SERVICE_LASSO_F7_TRANSPORT_PACKAGE_H
#include "canonical-index.h"
#include "plaintext-manifest.h"
#ifdef __cplusplus
extern "C" {
#endif
/* Private source-owned reservations, not a public or caller path API. Every
   object key/member/read companion is issued by exact ROOT admission. */
struct f7_payload_member {
 struct f7_member *original;
 f7_handle independent_read;
 uint8_t key[16];
};
struct f7_segment_object {
 struct f7_crypto_object *object;
 size_t member;
 uint64_t ordinal;
};
struct f7_package {
 uint8_t invocation[16],attempt[32];
 const struct f7_payload_member *members;size_t member_count;
 const struct f7_segment_object *segments;size_t segment_count;
 uint8_t *manifest;size_t manifest_capacity,manifest_length;
 struct f7_manifest_input *manifest_input;
 struct f7_manifest_segment *manifest_segments;size_t manifest_segment_capacity;
 struct f7_crypto_object *encrypted_manifest,*signature;
 struct f7_member *plaintext_manifest;f7_handle plaintext_manifest_read;
 struct f7_member *index;f7_handle index_read;
 uint8_t index_key[16];
 struct f7_index_object *roster;size_t roster_capacity;
 uint8_t *plaintext;size_t plaintext_capacity;
 uint8_t *canonical;size_t canonical_capacity;
 struct f7_signing_pin pins;
 int started,complete;
};
/* One attempt only. Partial encryption stays journal-reserved and retained;
   neither failure nor restart silently regenerates ciphertext or signatures. */
int f7_package_once(struct f7_package *package,int64_t *native_status);
#ifdef __cplusplus
}
#endif
#endif
