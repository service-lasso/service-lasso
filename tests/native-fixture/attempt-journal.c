#include "attempt-journal.h"
#include <string.h>
static struct f7_journal_entry *find(struct f7_attempt_journal *j,const uint8_t key[16]){
 size_t i;for(i=0;i<j->count;i++)if(!memcmp(j->entries[i].key,key,16))return j->entries+i;return NULL;
}
static int valid(struct f7_attempt_journal *j){
 return j&&j->member&&j->entries&&j->capacity&&j->capacity<=F7_OUTER_OBJECT_MAX&&
 j->count<=j->capacity&&!j->failed&&!j->frozen&&!j->parse_started&&!j->member->failed&&!j->member->finalized;
}
static int geometry(struct f7_attempt_journal *j,int64_t *status){
 struct span {uintptr_t address;size_t length;};
 if(!j||!j->member||!j->entries||!j->capacity||j->capacity>F7_OUTER_OBJECT_MAX||!status)return F7_INVALID;
 struct span spans[]={{(uintptr_t)j,sizeof(*j)},{(uintptr_t)j->member,sizeof(*j->member)},
  {(uintptr_t)j->entries,j->capacity*sizeof(*j->entries)},{(uintptr_t)status,sizeof(*status)}};
 for(size_t i=0;i<4;i++){
  if(spans[i].length>UINTPTR_MAX-spans[i].address)return F7_INVALID;
  for(size_t k=0;k<i;k++)if(!(spans[i].address+spans[i].length<=spans[k].address||
    spans[k].address+spans[k].length<=spans[i].address))return F7_CONFLICT;
 }
 return F7_OK;
}
static int inventory_hash(struct f7_attempt_journal *j,uint8_t digest[32]){
 crypto_hash_sha256_state hash;uint8_t length[8];
 if(!j->count)return F7_INCOMPLETE;
 crypto_hash_sha256_init(&hash);
 for(size_t i=0;i<j->count;i++){
  struct f7_journal_entry *e=j->entries+i;
  if(!e->reserved||!e->persisted)return F7_INCOMPLETE;
  f7_u64be(length,e->length);crypto_hash_sha256_update(&hash,e->key,16);
  crypto_hash_sha256_update(&hash,length,8);crypto_hash_sha256_update(&hash,e->digest,32);
 }
 crypto_hash_sha256_final(&hash,digest);return F7_OK;
}
static int append(struct f7_attempt_journal *j,const uint8_t key[16],enum f7_journal_event event,
 uint64_t length,const uint8_t digest[32],int64_t *status){
 uint8_t record[F7_JOURNAL_RECORD_BYTES],readback[F7_JOURNAL_RECORD_BYTES];
 struct f7_identity identity;struct f7_member reader;uint64_t persisted,offset=j->member->length;
 if(f7_handle_readonly(j->independent_read,status))goto failed;
 if(j->sequence==UINT64_MAX||length>F7_JSON_INTEGER_MAX)return F7_OVERFLOWED;
 memset(record,0,sizeof(record));memcpy(record,"SLF7JNL1",8);
 f7_u64be(record+8,j->sequence+1);memcpy(record+16,j->invocation,16);
 memcpy(record+32,j->attempt,32);memcpy(record+64,key,16);
 f7_u64be(record+80,event);f7_u64be(record+88,length);
 if(digest)memcpy(record+96,digest,32);memcpy(record+128,j->chain,32);
 crypto_hash_sha256(record+160,record,160);
 if(f7_member_append(j->member,record,sizeof(record),&persisted,status)||
 f7_member_flush(j->member,status)||
 f7_identity_read_status(j->independent_read,&identity,0,status)||
 !f7_identity_equal(&identity,&j->member->identity))goto failed;
 memset(&reader,0,sizeof(reader));reader.handle=j->independent_read;
 if(f7_member_read_at(&reader,offset,readback,sizeof(readback),status)||
 sodium_memcmp(readback,record,sizeof(record)))goto failed;
 memcpy(j->chain,record+160,32);j->sequence++;return F7_OK;
failed:
 j->failed=1;return F7_INCOMPLETE;
}
int f7_journal_reserve(struct f7_attempt_journal *j,const uint8_t key[16],int64_t *status){
 struct f7_journal_entry *entry;
 if(!valid(j)||!key||!status)return F7_INVALID;
 int shaped=geometry(j,status);if(shaped)return shaped;
 if(find(j,key))return F7_CONFLICT;
 if(j->count==j->capacity)return F7_OVERFLOWED;
 /* Even failed reservation consumes this process-local entry. Persistent
    prefix parser rejects partial records and cannot reissue encryption. */
 entry=j->entries+j->count++;memset(entry,0,sizeof(*entry));memcpy(entry->key,key,16);entry->reserved=1;
 return append(j,key,F7_ENCRYPTION_RESERVED,0,NULL,status);
}
int f7_journal_persisted(struct f7_attempt_journal *j,const uint8_t key[16],
 const struct f7_member *object,int64_t *status){
 struct f7_journal_entry *entry;
 if(!valid(j)||!key||!object||!status||!object->finalized||object->failed)return F7_INVALID;
 int shaped=geometry(j,status);if(shaped)return shaped;
 entry=find(j,key);if(!entry||!entry->reserved||entry->persisted)return F7_CONFLICT;
 int result=append(j,key,F7_OBJECT_PERSISTED,object->length,object->digest,status);
 if(result)return result;
 entry->length=object->length;memcpy(entry->digest,object->digest,32);entry->persisted=1;return F7_OK;
}
int f7_journal_read(struct f7_attempt_journal *j,f7_handle read_only,uint64_t length,int64_t *status){
 uint8_t record[F7_JOURNAL_RECORD_BYTES],digest[32];uint64_t offset=0,actual_length;
 struct f7_member reader;struct f7_identity identity;
 if(!j||!j->member||!j->entries||!j->capacity||j->capacity>F7_OUTER_OBJECT_MAX||
 !status||!length||length%F7_JOURNAL_RECORD_BYTES||
 length/F7_JOURNAL_RECORD_BYTES>j->capacity*2+1)return F7_INVALID;
 int shaped=geometry(j,status);if(shaped)return shaped;
 if(j->parse_started||j->count||j->sequence||j->failed||j->frozen)return F7_CONFLICT;
 /* Parse outputs are fresh independent owner reservations, never the original
    writer journal. Even a failed read cannot reset/reuse this retained state. */
 j->parse_started=1;
 int rights=f7_handle_readonly(read_only,status);if(rights)return rights;
 if(f7_identity_read_status(read_only,&identity,0,status)||!f7_identity_equal(&identity,&j->member->identity))return F7_IDENTITY_MISMATCH;
 if(f7_handle_size(read_only,&actual_length,status)||actual_length!=length)return F7_CONFLICT;
 memset(&reader,0,sizeof(reader));reader.handle=read_only;
 memset(j->entries,0,j->capacity*sizeof(*j->entries));j->count=0;j->sequence=0;j->frozen=0;
 memset(j->frozen_index,0,16);memset(j->frozen_inventory,0,32);memset(j->chain,0,32);
 while(offset<length){
  if(f7_member_read_at(&reader,offset,record,sizeof(record),status))goto failed;
  crypto_hash_sha256(digest,record,160);
  if(memcmp(record,"SLF7JNL1",8)||f7_read_u64be(record+8)!=j->sequence+1||
   memcmp(record+16,j->invocation,16)||memcmp(record+32,j->attempt,32)||
   sodium_memcmp(record+128,j->chain,32)||sodium_memcmp(record+160,digest,32))goto failed;
  uint64_t event=f7_read_u64be(record+80),object_length=f7_read_u64be(record+88);
  struct f7_journal_entry *entry=find(j,record+64);
  if(event==F7_ENCRYPTION_RESERVED){
   uint8_t zero[32]={0};
   if(entry||j->count==j->capacity||object_length||memcmp(record+96,zero,32))goto failed;
   entry=j->entries+j->count++;memcpy(entry->key,record+64,16);entry->reserved=1;
  }else if(event==F7_OBJECT_PERSISTED){
   if(!entry||entry->persisted||object_length>F7_JSON_INTEGER_MAX)goto failed;
   entry->persisted=1;entry->length=object_length;memcpy(entry->digest,record+96,32);
  }else if(event==F7_ATTEMPT_FROZEN){
   uint8_t roster[32];
   if(j->frozen||!entry||!entry->persisted||object_length!=j->count||
      offset+sizeof(record)!=length||inventory_hash(j,roster)||sodium_memcmp(roster,record+96,32))goto failed;
   j->frozen=1;memcpy(j->frozen_index,record+64,16);memcpy(j->frozen_inventory,roster,32);
  }else goto failed;
  memcpy(j->chain,digest,32);j->sequence++;offset+=sizeof(record);
 }
 if(f7_identity_read_status(read_only,&identity,0,status)||!f7_identity_equal(&identity,&j->member->identity)||
   f7_handle_size(read_only,&actual_length,status)||actual_length!=length)goto failed;
 return F7_OK;
failed:
 j->failed=1;return F7_INCOMPLETE;
}
int f7_journal_freeze(struct f7_attempt_journal *j,const uint8_t index_key[16],
 const uint8_t signature_key[16],int64_t *status){
 uint8_t digest[32];
 if(!valid(j)||!index_key||!signature_key||!status||!memcmp(index_key,signature_key,16))return F7_INVALID;
 int shaped=geometry(j,status);if(shaped)return shaped;
 struct f7_journal_entry *index=find(j,index_key),*signature=find(j,signature_key);
 if(!index||!signature||!index->persisted||!signature->persisted||!index->length||
    signature->length!=crypto_sign_BYTES||inventory_hash(j,digest))return F7_INCOMPLETE;
 int result=append(j,index_key,F7_ATTEMPT_FROZEN,j->count,digest,status);
 if(result)return result;
 j->frozen=1;memcpy(j->frozen_index,index_key,16);memcpy(j->frozen_inventory,digest,32);
 result=f7_member_finish(j->member,status);if(result)return result;
 return f7_member_readback(j->member,j->independent_read,status);
}
