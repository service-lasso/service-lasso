#ifndef SERVICE_LASSO_F7_RECOVERY_H
#define SERVICE_LASSO_F7_RECOVERY_H
#include "canonical-index.h"
#ifdef __cplusplus
extern "C" {
#endif
struct f7_retained_object {
 f7_handle read_only;
 struct f7_identity original_identity;
 uint8_t key[16],digest[32];uint64_t length;
};
struct f7_recovery_inventory {
 uint8_t invocation[16],attempt[32],observer_public[32],recipient_public[32];
 const struct f7_retained_object *objects;size_t count;
 struct f7_retained_object index,signature,journal;
 struct f7_attempt_journal *parsed_journal;
 uint8_t *index_bytes,*canonical_scratch,*hash_scratch;
 size_t index_capacity,canonical_capacity,hash_capacity;
 struct f7_index_object *decoded_objects;size_t decoded_capacity;
};
/* Pure retained-object integrity validation, never recovery authority or
   issuance. Expectations come from original authenticated ROOT custody.
   Caller paths/receipts/JSON cannot create those expectations or a successor.
   Missing original ROOT creator/endpoint admission still prevents handoff. */
int f7_recovery_validate_persistent(struct f7_recovery_inventory *inventory,
 int64_t *native_status);
struct f7_recovery_job;
struct f7_recovery_job_status {int finished,result;int64_t native_status;};
/* Read/hash work runs independently of admission/control. Caller retains the
   immutable inventory and ALL buffers/capabilities until actual job exit.
   Stack reservation is explicit and supplied by the actual row admission. */
int f7_recovery_job_start(struct f7_recovery_job **out,
 struct f7_recovery_inventory *inventory,size_t reserved_stack_bytes,int64_t *native_status);
int f7_recovery_job_poll(struct f7_recovery_job *job,struct f7_recovery_job_status *out);
/* Nonblocking settlement preserves actual wait/join/close failures. On failure
   the job and caller-owned inventory remain retained; no timeout frees them. */
int f7_recovery_job_release_exited(struct f7_recovery_job *job,int64_t *native_status);
#ifdef __cplusplus
}
#endif
#endif
