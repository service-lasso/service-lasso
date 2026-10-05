#include "transport-crypto.h"

#include <string.h>
static int disjoint(const void *a,size_t an,const void *b,size_t bn){
 uintptr_t av=(uintptr_t)a,bv=(uintptr_t)b;
 if(an>UINTPTR_MAX-av||bn>UINTPTR_MAX-bv)return 0;
 return av+an<=bv||bv+bn<=av;
}
static int empty_object(struct f7_crypto_object *o){
 return o&&o->journal&&!o->started&&o->write&&!o->write->length&&!o->write->finalized&&!o->write->failed;
}
static int readback_reserved(struct f7_crypto_object *o,const uint8_t *input,size_t length,
 const struct f7_signing_pin *pins,int64_t *status){
 struct f7_member *members[]={o->write,o->journal->member};
 if(!o->journal->entries||!o->journal->capacity||o->journal->capacity>F7_OUTER_OBJECT_MAX)return F7_BUDGET_ABSENT;
 for(size_t i=0;i<2;i++){
  if(!members[i]||!members[i]->readback_storage||!members[i]->readback_capacity||
     members[i]->readback_capacity>F7_FRAME_MAX)return F7_BUDGET_ABSENT;
  uint8_t *scratch=members[i]->readback_storage;size_t capacity=members[i]->readback_capacity;
  if(!disjoint(scratch,capacity,input,length)||!disjoint(scratch,capacity,pins,sizeof(*pins))||
     (pins->signer_secret&&!disjoint(scratch,capacity,pins->signer_secret,crypto_sign_SECRETKEYBYTES))||
     !disjoint(scratch,capacity,status,sizeof(*status))||!disjoint(scratch,capacity,o,sizeof(*o))||
     !disjoint(scratch,capacity,o->workspace,o->workspace_capacity)||
     !disjoint(scratch,capacity,o->write,sizeof(*o->write))||
     !disjoint(scratch,capacity,o->journal,sizeof(*o->journal))||
     !disjoint(scratch,capacity,o->journal->member,sizeof(*o->journal->member))||
     !disjoint(scratch,capacity,o->journal->entries,o->journal->capacity*sizeof(*o->journal->entries)))return F7_CONFLICT;
 }
 if(!disjoint(members[0]->readback_storage,members[0]->readback_capacity,
    members[1]->readback_storage,members[1]->readback_capacity))return F7_CONFLICT;
 return F7_OK;
}
int f7_encrypt_object_once(struct f7_crypto_object *o,const uint8_t *plain,
 size_t n,const struct f7_signing_pin *pins,int64_t *status){
 uint8_t *cipher;uint64_t persisted;size_t cipher_n;int result;
 if(!empty_object(o)||!plain||!pins||!status||n>F7_SEGMENT_MAX+F7_FRAME_MAX+8||
 n>SIZE_MAX-crypto_box_SEALBYTES||!o->workspace||
 n+crypto_box_SEALBYTES>o->workspace_capacity)return F7_INVALID;
 result=readback_reserved(o,plain,n,pins,status);if(result)return result;
 if(!disjoint(o->workspace,n+crypto_box_SEALBYTES,plain,n)||
    !disjoint(o->workspace,n+crypto_box_SEALBYTES,pins,sizeof(*pins))||
    (pins->signer_secret&&!disjoint(o->workspace,n+crypto_box_SEALBYTES,pins->signer_secret,crypto_sign_SECRETKEYBYTES))||
    !disjoint(o->workspace,n+crypto_box_SEALBYTES,o,sizeof(*o))||
    !disjoint(o->workspace,n+crypto_box_SEALBYTES,o->write,sizeof(*o->write))||
    !disjoint(o->workspace,n+crypto_box_SEALBYTES,o->journal,sizeof(*o->journal)))return F7_INVALID;
 o->started=1;
 result=f7_journal_reserve(o->journal,o->key,status);if(result)return result;
 cipher_n=n+crypto_box_SEALBYTES;cipher=o->workspace;
 if(crypto_box_seal(cipher,plain,n,pins->recipient)){sodium_memzero(cipher,cipher_n);return F7_NATIVE_FAILURE;}
 result=f7_member_append(o->write,cipher,cipher_n,&persisted,status);
 sodium_memzero(cipher,cipher_n);
 if(result)return result;
 if(f7_member_finish(o->write,status))return F7_INCOMPLETE;
 result=f7_member_readback(o->write,o->independent_read,status);if(result)return result;
 return f7_journal_persisted(o->journal,o->key,o->write,status);
}
int f7_signature_message(enum f7_signature_domain domain,const uint8_t *canonical,
 size_t n,uint8_t *workspace,size_t capacity,size_t *out_n){
 const char *prefix;size_t prefix_n,total;uint8_t *bytes;
 if(!canonical||!workspace||!out_n||n>F7_JSON_INTEGER_MAX)return F7_INVALID;
 if(domain==F7_INDEX_DOMAIN)prefix="SERVICE-LASSO-F7-TRANSPORT-INDEX-v1";
 else if(domain==F7_RECEIPT_DOMAIN)prefix="SERVICE-LASSO-F7-CUSTODY-RECEIPT-v1";
 else return F7_INVALID;
 prefix_n=strlen(prefix);
 if(n>SIZE_MAX-prefix_n-9)return F7_OVERFLOWED;
 total=prefix_n+1+8+n;if(total>capacity)return F7_BUDGET_ABSENT;
 if(!disjoint(workspace,total,canonical,n))return F7_INVALID;bytes=workspace;
 memcpy(bytes,prefix,prefix_n);bytes[prefix_n]=0;f7_u64be(bytes+prefix_n+1,n);
 memcpy(bytes+prefix_n+9,canonical,n);*out_n=total;return F7_OK;
}
int f7_sign_index_once(struct f7_crypto_object *o,const uint8_t *canonical,
 size_t n,const struct f7_signing_pin *pins,int64_t *status){
 uint8_t signature[crypto_sign_BYTES],*message=NULL,actual_public[32];
 size_t message_n=0;uint64_t persisted;int result;
 if(!empty_object(o)||!pins||!pins->signer_secret||!status||!o->workspace)return F7_INVALID;
 result=readback_reserved(o,canonical,n,pins,status);if(result)return result;
 if(!disjoint(o->workspace,o->workspace_capacity,pins,sizeof(*pins))||
    !disjoint(o->workspace,o->workspace_capacity,pins->signer_secret,crypto_sign_SECRETKEYBYTES))return F7_INVALID;
 if(crypto_sign_ed25519_sk_to_pk(actual_public,pins->signer_secret)||
 sodium_memcmp(actual_public,pins->signer,32))return F7_AUTH_FAILURE;
 o->started=1;result=f7_journal_reserve(o->journal,o->key,status);if(result)return result;
 result=f7_signature_message(F7_INDEX_DOMAIN,canonical,n,o->workspace,o->workspace_capacity,&message_n);
 if(result)return result;message=o->workspace;
 result=crypto_sign_detached(signature,NULL,message,message_n,pins->signer_secret);
 sodium_memzero(message,message_n);if(result)return F7_NATIVE_FAILURE;
 result=f7_member_append(o->write,signature,sizeof(signature),&persisted,status);
 sodium_memzero(signature,sizeof(signature));if(result)return result;
 if(f7_member_finish(o->write,status))return F7_INCOMPLETE;
 result=f7_member_readback(o->write,o->independent_read,status);if(result)return result;
 return f7_journal_persisted(o->journal,o->key,o->write,status);
}
int f7_verify_index(const uint8_t *canonical,size_t n,const uint8_t signature[64],
 const uint8_t signer[32],uint8_t *workspace,size_t capacity){
 uint8_t *message=NULL;size_t message_n=0;int result;
 if(!signature||!signer)return F7_INVALID;
 if(!workspace||!disjoint(workspace,capacity,signature,64)||
    !disjoint(workspace,capacity,signer,32))return F7_INVALID;
 result=f7_signature_message(F7_INDEX_DOMAIN,canonical,n,workspace,capacity,&message_n);
 if(result)return result;message=workspace;
 result=crypto_sign_verify_detached(signature,message,message_n,signer);
 sodium_memzero(message,message_n);return result?F7_AUTH_FAILURE:F7_OK;
}
