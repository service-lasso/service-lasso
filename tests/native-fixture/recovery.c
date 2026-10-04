#include "recovery.h"
#include <string.h>
static int read_object(const struct f7_retained_object *o,uint8_t *buffer,size_t capacity,
 uint8_t *body,size_t body_capacity,int64_t *status){
 struct f7_identity identity;uint64_t size,offset=0;uint8_t digest[32];
 crypto_hash_sha256_state hash;struct f7_member reader;
 if(!o||!buffer||!capacity||capacity>F7_FRAME_MAX||
    o->length>F7_JSON_INTEGER_MAX||(body&&o->length>body_capacity))return F7_INVALID;
 int result=f7_handle_readonly(o->read_only,status);if(result)return result;
 if(f7_identity_read_status(o->read_only,&identity,0,status)||
    !f7_identity_equal(&identity,&o->original_identity))return F7_IDENTITY_MISMATCH;
 result=f7_handle_size(o->read_only,&size,status);if(result)return result;
 if(size!=o->length)return F7_CONFLICT;
 memset(&reader,0,sizeof(reader));reader.handle=o->read_only;
 crypto_hash_sha256_init(&hash);
 while(offset<size){
  size_t n=(size_t)((size-offset)>capacity?capacity:size-offset);
  result=f7_member_read_at(&reader,offset,buffer,n,status);if(result)return result;
  crypto_hash_sha256_update(&hash,buffer,n);
  if(body)memcpy(body+(size_t)offset,buffer,n);offset+=n;
 }
 crypto_hash_sha256_final(&hash,digest);
 if(sodium_memcmp(digest,o->digest,32))return F7_CONFLICT;
 result=f7_handle_size(o->read_only,&size,status);if(result)return result;
 if(size!=o->length||f7_identity_read_status(o->read_only,&identity,0,status)||
    !f7_identity_equal(&identity,&o->original_identity))return F7_IDENTITY_MISMATCH;
 return F7_OK;
}
static const struct f7_journal_entry *entry(const struct f7_attempt_journal *j,const uint8_t key[16]){
 for(size_t i=0;i<j->count;i++)if(!memcmp(j->entries[i].key,key,16))return j->entries+i;
 return NULL;
}
static int bound(const struct f7_attempt_journal *j,const struct f7_retained_object *o){
 const struct f7_journal_entry *e=entry(j,o->key);
 return e&&e->reserved&&e->persisted&&e->length==o->length&&!sodium_memcmp(e->digest,o->digest,32);
}
int f7_recovery_validate_persistent(struct f7_recovery_inventory *in,int64_t *status){
 uint8_t signature[crypto_sign_BYTES],observer_pin[32],recipient_pin[32];struct f7_index_input index;
 if(!in||!status||!in->objects||!in->count||in->count>F7_OBJECT_MAX||
    !in->parsed_journal||!in->index_bytes||!in->canonical_scratch||!in->hash_scratch||
    !in->hash_capacity||!in->decoded_objects||in->decoded_capacity<in->count||
    !in->index.length||in->index.length>in->index_capacity||in->signature.length!=sizeof(signature))return F7_INVALID;
 *status=0;
 /* Original identities remain caller-independent custody prerequisites.
    Reading equal bytes from a newly adopted copy is not SAME validation. */
 int result=read_object(&in->index,in->hash_scratch,in->hash_capacity,in->index_bytes,in->index_capacity,status);
 if(result)return result;
 result=read_object(&in->signature,in->hash_scratch,in->hash_capacity,signature,sizeof(signature),status);
 if(result)return result;
 result=f7_decode_index(in->index_bytes,(size_t)in->index.length,&index,in->decoded_objects,
  in->decoded_capacity,in->canonical_scratch,in->canonical_capacity);if(result)return result;
 crypto_hash_sha256(observer_pin,in->observer_public,32);crypto_hash_sha256(recipient_pin,in->recipient_public,32);
 if(index.count!=in->count||memcmp(index.invocation,in->invocation,16)||memcmp(index.attempt,in->attempt,32)||
    sodium_memcmp(index.observer_key,observer_pin,32)||sodium_memcmp(index.receiver_key,recipient_pin,32))return F7_AUTH_FAILURE;
 result=f7_verify_index(in->index_bytes,(size_t)in->index.length,signature,in->observer_public);
 if(result)return result;
 result=read_object(&in->journal,in->hash_scratch,in->hash_capacity,NULL,0,status);if(result)return result;
 struct f7_attempt_journal *journal=in->parsed_journal;
 if(!journal->member||!f7_identity_equal(&journal->member->identity,&in->journal.original_identity)||
    memcmp(journal->invocation,in->invocation,16)||memcmp(journal->attempt,in->attempt,32))return F7_AUTH_FAILURE;
 result=f7_journal_read(journal,in->journal.read_only,in->journal.length,status);if(result)return result;
 if(!journal->frozen||journal->count!=in->count+2||memcmp(journal->frozen_index,in->index.key,16)||
    !bound(journal,&in->index)||!bound(journal,&in->signature))return F7_CONFLICT;
 if(!memcmp(in->index.key,in->signature.key,16)||
    f7_identity_equal(&in->index.original_identity,&in->signature.original_identity)||
    f7_identity_equal(&in->index.original_identity,&in->journal.original_identity)||
    f7_identity_equal(&in->signature.original_identity,&in->journal.original_identity))return F7_CONFLICT;
 for(size_t i=0;i<in->count;i++){
  const struct f7_retained_object *o=in->objects+i;const struct f7_index_object *expected=index.objects+i;
  if((i&&memcmp(in->objects[i-1].key,o->key,16)>=0)||memcmp(o->key,expected->key,16)||
     o->length!=expected->length||sodium_memcmp(o->digest,expected->sha256,32)||!bound(journal,o)||
     !memcmp(o->key,in->index.key,16)||!memcmp(o->key,in->signature.key,16)||
     f7_identity_equal(&o->original_identity,&in->index.original_identity)||
     f7_identity_equal(&o->original_identity,&in->signature.original_identity)||
     f7_identity_equal(&o->original_identity,&in->journal.original_identity))return F7_CONFLICT;
  for(size_t j=0;j<i;j++)if(f7_identity_equal(&o->original_identity,&in->objects[j].original_identity))return F7_CONFLICT;
  result=read_object(o,in->hash_scratch,in->hash_capacity,NULL,0,status);if(result)return result;
 }
 /* No capability is duplicated/transferred here; an authenticated admitted
    recovery owner and original T endpoint must separately authorize issuance.
    Source/candidate/admission/manifest native-witness verification is still
    required and cannot be inferred from this integrity-only success. */
 return F7_OK;
}
