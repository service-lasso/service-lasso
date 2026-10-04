#ifndef SERVICE_LASSO_F7_JOURNAL_H
#define SERVICE_LASSO_F7_JOURNAL_H
#include "capture-spool.h"
#ifdef __cplusplus
extern "C" {
#endif
#define F7_JOURNAL_RECORD_BYTES 192u
#define F7_OUTER_OBJECT_MAX (F7_OBJECT_MAX+2u)
enum f7_journal_event {F7_ENCRYPTION_RESERVED=1,F7_OBJECT_PERSISTED=2};
struct f7_journal_entry {
 uint8_t key[16],digest[32];uint64_t length;
 int reserved,persisted;
};
struct f7_attempt_journal {
 struct f7_member *member;f7_handle independent_read;
 struct f7_journal_entry *entries;size_t capacity,count;
 uint8_t invocation[16],attempt[32],chain[32];
 uint64_t sequence;
 int failed;
};
/* reserve is durable BEFORE any randomized encryption/signing. The exact
   original journal is retained on every outcome, including partial records. */
int f7_journal_reserve(struct f7_attempt_journal *journal,const uint8_t key[16],int64_t *status);
int f7_journal_persisted(struct f7_attempt_journal *journal,const uint8_t key[16],
 const struct f7_member *object,int64_t *status);
/* Reads actual retained journal bytes from the separately held read-only
   capability. This validates record integrity/state only, never source or
   successor authority. Authentic index/manifest/admission verification is
   mandatory outside this parser before any recovery capability issuance. */
int f7_journal_read(struct f7_attempt_journal *journal,f7_handle read_only,
 uint64_t exact_length,int64_t *status);
#ifdef __cplusplus
}
#endif
#endif
