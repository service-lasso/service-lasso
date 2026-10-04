#ifndef SERVICE_LASSO_F7_PLAINTEXT_MANIFEST_H
#define SERVICE_LASSO_F7_PLAINTEXT_MANIFEST_H
#include "observer.h"
/* These are private record classifications, never actors or public resources.
   Underlying admission/identity/error bytes are payload members, not replaced
   by these digest bindings. Actual source-owned admission remains mandatory. */
enum f7_record_kind {
 F7_RECORD_SOURCE_INVENTORY=1,F7_RECORD_PHYSICAL_INVENTORY=2,
 F7_RECORD_TOOLS=3,F7_RECORD_LOADED_NATIVE=4,F7_RECORD_LITERAL_ENV=5,
 F7_RECORD_ACTOR_ADMISSION=6,F7_RECORD_ENDPOINTS=7,F7_RECORD_ANCESTORS=8,
 F7_RECORD_NATIVE_OBJECTS=9,F7_RECORD_WRITER_COPIES=10,
 F7_RECORD_ROW_RESERVATION=11,F7_RECORD_ERROR_GRAPH=12,
 F7_RECORD_RAW_STDOUT=13,F7_RECORD_RAW_STDERR=14,F7_RECORD_PRIVATE_ERRORS=15,
 F7_RECORD_CONTROL=16,F7_RECORD_WITNESS=17,F7_RECORD_EMERGENCY_WITNESS=18,
 F7_RECORD_NATIVE_NAMES=19,F7_RECORD_DISCREPANCIES=20,
 F7_RECORD_ORIGINAL_ADMISSION=21
};
struct f7_manifest_member {
 uint8_t key[16];enum f7_record_kind kind;
 const struct f7_member *persisted;
};
struct f7_manifest_segment {
 uint8_t key[16],member[16],plaintext_sha256[32],ciphertext_sha256[32];
 uint64_t ordinal,count,offset,length,plaintext_length,ciphertext_length;
};
struct f7_manifest_unavailable {
 uint8_t key[16],native_status_bits[8];enum f7_record_kind kind;
};
enum f7_platform {F7_PLATFORM_WINDOWS=1,F7_PLATFORM_LINUX=2};
struct f7_manifest_input {
 uint8_t candidate_head[20],candidate_tree[20],candidate_base[20];
 uint8_t admission_sha256[32];uint64_t attempt_ordinal;
 enum f7_platform platform;
 unsigned row;
 const struct f7_capture *capture;
 const struct f7_manifest_member *members;size_t member_count;
 const struct f7_manifest_segment *segments;size_t segment_count;
 const struct f7_manifest_unavailable *unavailable;size_t unavailable_count;
};
int f7_canonical_manifest(const struct f7_manifest_input *input,uint8_t *out,
 size_t capacity,size_t *length);
#endif
