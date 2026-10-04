#include "transport-crypto.h"
#include <stdlib.h>
#include <string.h>
static int empty_object(struct f7_crypto_object *o){
 return o&&o->journal&&!o->started&&o->write&&!o->write->length&&!o->write->finalized&&!o->write->failed;
}
int f7_encrypt_object_once(struct f7_crypto_object *o,const uint8_t *plain,
 size_t n,const struct f7_signing_pin *pins,int64_t *status){
 uint8_t *cipher;uint64_t persisted;size_t cipher_n;int result;
 if(!empty_object(o)||!plain||!pins||!status||n>F7_SEGMENT_MAX+F7_FRAME_MAX+8||
 n>SIZE_MAX-crypto_box_SEALBYTES)return F7_INVALID;
 o->started=1;
 result=f7_journal_reserve(o->journal,o->key,status);if(result)return result;
 cipher_n=n+crypto_box_SEALBYTES;cipher=malloc(cipher_n);
 if(!cipher)return F7_NATIVE_FAILURE;
 if(crypto_box_seal(cipher,plain,n,pins->recipient)){free(cipher);return F7_NATIVE_FAILURE;}
 result=f7_member_append(o->write,cipher,cipher_n,&persisted,status);
 sodium_memzero(cipher,cipher_n);free(cipher);
 if(result)return result;
 if(f7_member_finish(o->write,status))return F7_INCOMPLETE;
 result=f7_member_readback(o->write,o->independent_read,status);if(result)return result;
 return f7_journal_persisted(o->journal,o->key,o->write,status);
}
int f7_signature_message(enum f7_signature_domain domain,const uint8_t *canonical,
 size_t n,uint8_t **out,size_t *out_n){
 const char *prefix;size_t prefix_n,total;uint8_t *bytes;
 if(!canonical||!out||!out_n||n>F7_JSON_INTEGER_MAX)return F7_INVALID;
 if(domain==F7_INDEX_DOMAIN)prefix="SERVICE-LASSO-F7-TRANSPORT-INDEX-v1";
 else if(domain==F7_RECEIPT_DOMAIN)prefix="SERVICE-LASSO-F7-CUSTODY-RECEIPT-v1";
 else return F7_INVALID;
 prefix_n=strlen(prefix);
 if(n>SIZE_MAX-prefix_n-9)return F7_OVERFLOWED;
 total=prefix_n+1+8+n;bytes=malloc(total);if(!bytes)return F7_NATIVE_FAILURE;
 memcpy(bytes,prefix,prefix_n);bytes[prefix_n]=0;f7_u64be(bytes+prefix_n+1,n);
 memcpy(bytes+prefix_n+9,canonical,n);*out=bytes;*out_n=total;return F7_OK;
}
int f7_sign_index_once(struct f7_crypto_object *o,const uint8_t *canonical,
 size_t n,const struct f7_signing_pin *pins,int64_t *status){
 uint8_t signature[crypto_sign_BYTES],*message=NULL,actual_public[32];
 size_t message_n=0;uint64_t persisted;int result;
 if(!empty_object(o)||!pins||!pins->signer_secret||!status)return F7_INVALID;
 if(crypto_sign_ed25519_sk_to_pk(actual_public,pins->signer_secret)||
 sodium_memcmp(actual_public,pins->signer,32))return F7_AUTH_FAILURE;
 o->started=1;result=f7_journal_reserve(o->journal,o->key,status);if(result)return result;
 result=f7_signature_message(F7_INDEX_DOMAIN,canonical,n,&message,&message_n);
 if(result)return result;
 result=crypto_sign_detached(signature,NULL,message,message_n,pins->signer_secret);
 sodium_memzero(message,message_n);free(message);if(result)return F7_NATIVE_FAILURE;
 result=f7_member_append(o->write,signature,sizeof(signature),&persisted,status);
 sodium_memzero(signature,sizeof(signature));if(result)return result;
 if(f7_member_finish(o->write,status))return F7_INCOMPLETE;
 result=f7_member_readback(o->write,o->independent_read,status);if(result)return result;
 return f7_journal_persisted(o->journal,o->key,o->write,status);
}
int f7_verify_index(const uint8_t *canonical,size_t n,const uint8_t signature[64],
 const uint8_t signer[32]){
 uint8_t *message=NULL;size_t message_n=0;int result;
 if(!signature||!signer)return F7_INVALID;
 result=f7_signature_message(F7_INDEX_DOMAIN,canonical,n,&message,&message_n);
 if(result)return result;
 result=crypto_sign_verify_detached(signature,message,message_n,signer);
 free(message);return result?F7_AUTH_FAILURE:F7_OK;
}
