#include "transport-package.h"
#include "segment-record.h"
#include <string.h>
static int object_ready(const struct f7_crypto_object *o,const struct f7_package *p){
 return o&&o->write&&o->journal&&o->journal->member&&o->journal==p->encrypted_manifest->journal&&
  !o->started&&!o->write->length&&!o->write->failed&&!o->write->finalized&&
  !o->journal->failed&&!memcmp(o->journal->invocation,p->invocation,16)&&
  !memcmp(o->journal->attempt,p->attempt,32);
}
static int empty_native(struct f7_member *m,f7_handle read,int64_t *status){
 struct f7_identity write_identity,read_identity;uint64_t length;
 if(!m||m->failed||m->finalized||m->length)return F7_CONFLICT;
 if(f7_identity_read(m->handle,&write_identity,0)||
    f7_identity_read(read,&read_identity,0)||
    !f7_identity_equal(&write_identity,&m->identity)||
    !f7_identity_equal(&write_identity,&read_identity))return F7_IDENTITY_MISMATCH;
 int result=f7_handle_readonly(read,status);if(result)return result;
 result=f7_handle_size(read,&length,status);if(result)return result;
 return length?F7_CONFLICT:F7_OK;
}
static int member_ready(const struct f7_payload_member *m,int64_t *status){
 if(!m->original||!m->original->finalized||
    !m->original->readback_complete||m->original->length>F7_JSON_INTEGER_MAX)return F7_INCOMPLETE;
 /* Repeat ALL independent persistent readback immediately before deriving
    segments. Previously cached hashes are not the persistent byte source. */
 return f7_member_readback(m->original,m->independent_read,status);
}
static void inventory(struct f7_index_object *out,const struct f7_crypto_object *object,
 enum f7_object_kind kind){
 memcpy(out->key,object->key,16);memcpy(out->sha256,object->write->digest,32);
 out->length=object->write->length;out->kind=kind;
}
int f7_package_once(struct f7_package *p,int64_t *status){
 size_t i,j,manifest_slot=SIZE_MAX;uint64_t persisted;size_t canonical_length;
 if(!p||!status||p->started||!p->members||!p->member_count||
    !p->segments||!p->segment_count||p->segment_count>=F7_OBJECT_MAX||
    !p->manifest||p->manifest_length||!p->manifest_capacity||p->manifest_capacity>F7_SEGMENT_MAX||
    !p->manifest_input||!p->manifest_input->capture||!p->manifest_segments||
    p->manifest_segment_capacity<p->segment_count||
    !p->encrypted_manifest||!p->signature||!p->plaintext_manifest||!p->index||p->index->length||
    p->index->failed||p->index->finalized||!p->roster||
    p->roster_capacity<p->segment_count+1||!p->plaintext||
    p->plaintext_capacity<F7_SEGMENT_MAX+F7_SEGMENT_HEADER_BYTES||!p->canonical)return F7_INVALID;
 *status=0;
 if(p->manifest_input->member_count!=p->member_count||!p->manifest_input->members||
    !p->manifest_input->capture->witness||
    memcmp(p->manifest_input->capture->witness->invocation,p->invocation,16)||
    memcmp(p->manifest_input->capture->witness->attempt,p->attempt,32))return F7_AUTH_FAILURE;
 if(!object_ready(p->encrypted_manifest,p)||!object_ready(p->signature,p)||
    !p->pins.signer_secret||p->encrypted_manifest->journal->count||
    p->encrypted_manifest->journal->capacity<p->segment_count+3||
    !memcmp(p->encrypted_manifest->key,p->signature->key,16)||
    !memcmp(p->encrypted_manifest->key,p->index_key,16)||
    !memcmp(p->signature->key,p->index_key,16))return F7_CONFLICT;
 uint8_t signer[32];
 if(crypto_sign_ed25519_sk_to_pk(signer,p->pins.signer_secret)||
    sodium_memcmp(signer,p->pins.signer,32))return F7_AUTH_FAILURE;
 if(empty_native(p->encrypted_manifest->write,p->encrypted_manifest->independent_read,status)||
    empty_native(p->signature->write,p->signature->independent_read,status)||
    empty_native(p->plaintext_manifest,p->plaintext_manifest_read,status)||
    empty_native(p->index,p->index_read,status))return F7_INCOMPLETE;
 /* Validate the entire preassigned segmentation before the first randomized
    operation. No omission, duplicate segment, arbitrary offset or surplus
    encrypted-object slot can be normalized into a passing inventory. */
 for(i=0;i<p->member_count;i++){
  if(memcmp(p->members[i].key,p->manifest_input->members[i].key,16)||
     p->members[i].original!=p->manifest_input->members[i].persisted)return F7_CONFLICT;
  if(member_ready(p->members+i,status))return F7_INCOMPLETE;
  if(i&&memcmp(p->members[i-1].key,p->members[i].key,16)>=0)return F7_CONFLICT;
  for(j=0;j<i;j++)if(f7_identity_equal(&p->members[i].original->identity,
     &p->members[j].original->identity))return F7_CONFLICT;
  uint64_t length=p->members[i].original->length;
  uint64_t count=length/F7_SEGMENT_MAX+(length%F7_SEGMENT_MAX!=0);
  /* Empty original members still get one length-zero segment commitment. */
  if(!count)count=1;
  uint64_t found=0;
  for(j=0;j<p->segment_count;j++)if(p->segments[j].member==i){
   if(p->segments[j].ordinal>=count||!p->segments[j].object)return F7_CONFLICT;
   for(size_t previous=0;previous<j;previous++)if(p->segments[previous].member==i&&
      p->segments[previous].ordinal==p->segments[j].ordinal)return F7_CONFLICT;
   found++;
  }
  if(found!=count)return F7_CONFLICT;
 }
 for(i=0;i<p->segment_count;i++){
  const struct f7_segment_object *s=p->segments+i;
  if(s->member>=p->member_count||!object_ready(s->object,p))return F7_CONFLICT;
  if(i&&memcmp(p->segments[i-1].object->key,s->object->key,16)>=0)return F7_CONFLICT;
  if(!memcmp(s->object->key,p->encrypted_manifest->key,16)||
     !memcmp(s->object->key,p->signature->key,16)||
     !memcmp(s->object->key,p->index_key,16))return F7_CONFLICT;
  if(empty_native(s->object->write,s->object->independent_read,status))return F7_INCOMPLETE;
  if(f7_identity_equal(&s->object->write->identity,&p->encrypted_manifest->write->identity)||
     f7_identity_equal(&s->object->write->identity,&p->signature->write->identity)||
     f7_identity_equal(&s->object->write->identity,&p->plaintext_manifest->identity)||
     f7_identity_equal(&s->object->write->identity,&p->index->identity))return F7_CONFLICT;
  if(f7_identity_equal(&s->object->write->identity,&s->object->journal->member->identity))return F7_CONFLICT;
  for(j=0;j<p->member_count;j++)if(f7_identity_equal(&s->object->write->identity,
     &p->members[j].original->identity))return F7_CONFLICT;
  for(j=0;j<i;j++)if(f7_identity_equal(&s->object->write->identity,
     &p->segments[j].object->write->identity))return F7_CONFLICT;
 }
 if(f7_identity_equal(&p->encrypted_manifest->write->identity,&p->signature->write->identity)||
    f7_identity_equal(&p->encrypted_manifest->write->identity,&p->index->identity)||
    f7_identity_equal(&p->signature->write->identity,&p->index->identity))return F7_CONFLICT;
 struct f7_member *outer[4]={p->encrypted_manifest->write,p->signature->write,p->index,p->plaintext_manifest};
 for(i=0;i<4;i++){
  for(j=0;j<i;j++)if(f7_identity_equal(&outer[i]->identity,&outer[j]->identity))return F7_CONFLICT;
  if(f7_identity_equal(&outer[i]->identity,&p->encrypted_manifest->journal->member->identity))return F7_CONFLICT;
  for(j=0;j<p->member_count;j++)if(f7_identity_equal(&outer[i]->identity,
     &p->members[j].original->identity))return F7_CONFLICT;
 }
 p->started=1;
 for(i=0;i<p->segment_count;i++){
  const struct f7_segment_object *s=p->segments+i;
  const struct f7_payload_member *m=p->members+s->member;
  struct f7_segment_input metadata;
  memset(&metadata,0,sizeof(metadata));memcpy(metadata.invocation,p->invocation,16);
  memcpy(metadata.attempt,p->attempt,32);memcpy(metadata.member,m->key,16);
  memcpy(metadata.full_sha256,m->original->digest,32);metadata.full_size=m->original->length;
  metadata.count=metadata.full_size/F7_SEGMENT_MAX+(metadata.full_size%F7_SEGMENT_MAX!=0);
  if(!metadata.count)metadata.count=1;
  metadata.ordinal=s->ordinal;metadata.offset=s->ordinal*F7_SEGMENT_MAX;
  metadata.length=metadata.full_size-metadata.offset;
  if(metadata.length>F7_SEGMENT_MAX)metadata.length=F7_SEGMENT_MAX;
  int result=f7_segment_encode(p->plaintext,&metadata);
  if(result)return result;
  struct f7_member reader;memset(&reader,0,sizeof(reader));reader.handle=m->independent_read;
  result=f7_member_read_at(&reader,metadata.offset,p->plaintext+F7_SEGMENT_HEADER_BYTES,(size_t)metadata.length,status);
  if(result)return result;
  struct f7_manifest_segment *manifest_segment=p->manifest_segments+i;
  memset(manifest_segment,0,sizeof(*manifest_segment));
  memcpy(manifest_segment->key,s->object->key,16);memcpy(manifest_segment->member,m->key,16);
  manifest_segment->ordinal=metadata.ordinal;manifest_segment->count=metadata.count;
  manifest_segment->offset=metadata.offset;manifest_segment->length=metadata.length;
  manifest_segment->plaintext_length=F7_SEGMENT_HEADER_BYTES+metadata.length;
  crypto_hash_sha256(manifest_segment->plaintext_sha256,p->plaintext,manifest_segment->plaintext_length);
  result=f7_encrypt_object_once(s->object,p->plaintext,F7_SEGMENT_HEADER_BYTES+(size_t)metadata.length,&p->pins,status);
  sodium_memzero(p->plaintext,F7_SEGMENT_HEADER_BYTES+(size_t)metadata.length);
  if(result)return result;
  manifest_segment->ciphertext_length=s->object->write->length;
  memcpy(manifest_segment->ciphertext_sha256,s->object->write->digest,32);
 }
 /* Final manifest construction occurs AFTER every randomized ciphertext is
    persisted and independently reread. Its roster therefore binds actual
    segment bytes, never a prediction or caller-prepared ciphertext digest. */
 p->manifest_input->segments=p->manifest_segments;
 p->manifest_input->segment_count=p->segment_count;
 int result=f7_canonical_manifest(p->manifest_input,p->manifest,p->manifest_capacity,&p->manifest_length);
 if(result)return result;
 result=f7_member_append(p->plaintext_manifest,p->manifest,p->manifest_length,&persisted,status);
 if(result||f7_member_finish(p->plaintext_manifest,status)||
    f7_member_readback(p->plaintext_manifest,p->plaintext_manifest_read,status))return F7_INCOMPLETE;
 result=f7_encrypt_object_once(p->encrypted_manifest,p->manifest,p->manifest_length,&p->pins,status);
 if(result)return result;
 /* Merge the separately allocated manifest key into an already sorted exact
    roster, preserving keys rather than generating aliases from filenames. */
 for(i=0,j=0;i<p->segment_count;i++){
  if(manifest_slot==SIZE_MAX&&memcmp(p->encrypted_manifest->key,p->segments[i].object->key,16)<0){
   manifest_slot=j;inventory(p->roster+j++,p->encrypted_manifest,F7_ENCRYPTED_MANIFEST);
  }
  inventory(p->roster+j++,p->segments[i].object,F7_ENCRYPTED_SEGMENT);
 }
 if(manifest_slot==SIZE_MAX)inventory(p->roster+j++,p->encrypted_manifest,F7_ENCRYPTED_MANIFEST);
 struct f7_index_input index;memset(&index,0,sizeof(index));
 memcpy(index.invocation,p->invocation,16);memcpy(index.attempt,p->attempt,32);
 crypto_hash_sha256(index.observer_key,p->pins.signer,32);
 crypto_hash_sha256(index.receiver_key,p->pins.recipient,32);
 memcpy(index.plaintext_manifest_sha256,p->plaintext_manifest->digest,32);
 index.objects=p->roster;index.count=j;
 result=f7_canonical_index(&index,p->canonical,p->canonical_capacity,&canonical_length);
 if(result)return result;
 result=f7_journal_reserve(p->encrypted_manifest->journal,p->index_key,status);
 if(result)return result;
 result=f7_member_append(p->index,p->canonical,canonical_length,&persisted,status);
 if(result||f7_member_finish(p->index,status)||f7_member_readback(p->index,p->index_read,status))return F7_INCOMPLETE;
 result=f7_journal_persisted(p->encrypted_manifest->journal,p->index_key,p->index,status);
 if(result)return result;
 result=f7_sign_index_once(p->signature,p->canonical,canonical_length,&p->pins,status);
 if(result)return result;
 result=f7_journal_freeze(p->encrypted_manifest->journal,p->index_key,p->signature->key,status);
 if(result)return result;
 p->complete=1;return F7_OK;
}
