#include "canonical-index.h"
#include <string.h>
struct output {uint8_t *bytes;size_t capacity,used;int failed;};
static void bytes(struct output *o,const void *p,size_t n){
 if(o->failed)return;
 if(n>o->capacity-o->used){o->failed=1;return;}
 memcpy(o->bytes+o->used,p,n);o->used+=n;
}
static void text(struct output *o,const char *s){bytes(o,s,strlen(s));}
static void hex(struct output *o,const uint8_t *p,size_t n){
 static const char alphabet[]="0123456789abcdef";size_t i;text(o,"\"");
 for(i=0;i<n;i++){uint8_t pair[2]={(uint8_t)alphabet[p[i]>>4],(uint8_t)alphabet[p[i]&15]};bytes(o,pair,2);}
 text(o,"\"");
}
static void integer(struct output *o,uint64_t n){
 uint8_t decimal[20];size_t used=0,i;
 if(n>F7_JSON_INTEGER_MAX){o->failed=1;return;}
 do{decimal[used++]=(uint8_t)('0'+n%10);n/=10;}while(n);
 for(i=used;i>0;i--)bytes(o,decimal+i-1,1);
}
static void roster(struct output *o,const struct f7_index_input *in){
 size_t i;text(o,"[");
 for(i=0;i<in->count;i++){
  const struct f7_index_object *item=in->objects+i;if(i)text(o,",");
  text(o,"{\"key\":");hex(o,item->key,16);
  text(o,",\"kind\":\"");text(o,item->kind==F7_ENCRYPTED_MANIFEST?"encrypted_manifest":"encrypted_segment");
  text(o,"\",\"length\":");integer(o,item->length);
  text(o,",\"sha256\":");hex(o,item->sha256,32);text(o,"}");
 }text(o,"]");
}
int f7_canonical_index(const struct f7_index_input *in,uint8_t *out,size_t capacity,size_t *length){
 struct output o={out,capacity,0,0};size_t i,manifest=SIZE_MAX;uint8_t digest[32];
 if(!in||!out||!length||!in->objects||!in->count||in->count>F7_OBJECT_MAX)return F7_INVALID;
 *length=0;
 for(i=0;i<in->count;i++){
  if((i&&memcmp(in->objects[i-1].key,in->objects[i].key,16)>=0)||
    !in->objects[i].length||in->objects[i].length>F7_JSON_INTEGER_MAX||
    (in->objects[i].kind!=F7_ENCRYPTED_SEGMENT&&in->objects[i].kind!=F7_ENCRYPTED_MANIFEST))return F7_INVALID;
  if(in->objects[i].kind==F7_ENCRYPTED_MANIFEST){if(manifest!=SIZE_MAX)return F7_INVALID;manifest=i;}
 }
 if(manifest==SIZE_MAX)return F7_INVALID;
 /* Complete ciphertext roster digest is over its exact canonical array bytes.
    The final index uses the same immutable input roster. */
 roster(&o,in);if(o.failed)return F7_OVERFLOWED;
 crypto_hash_sha256(digest,out,o.used);o.used=0;
 text(&o,"{\"attempt\":");hex(&o,in->attempt,32);
 text(&o,",\"encrypted_manifest\":");hex(&o,in->objects[manifest].key,16);
 text(&o,",\"inventory_digest\":");hex(&o,digest,32);
 text(&o,",\"invocation\":");hex(&o,in->invocation,16);
 text(&o,",\"objects\":");roster(&o,in);
 text(&o,",\"observer_key\":");hex(&o,in->observer_key,32);
 text(&o,",\"plaintext_manifest_digest\":");hex(&o,in->plaintext_manifest_sha256,32);
 text(&o,",\"protocol\":1,\"receiver_key\":");hex(&o,in->receiver_key,32);
 text(&o,",\"schema\":\"f7_transport_index_v1\",\"signature_algorithm\":\"Ed25519\"}");
 if(o.failed)return F7_OVERFLOWED;*length=o.used;return F7_OK;
}
int f7_canonical_segment_metadata(const struct f7_segment_input *in,
 uint8_t *out,size_t capacity,size_t *length){
 struct output o={out,capacity,0,0};
 if(!in||!out||!length||!in->count||in->ordinal>=in->count||
 in->length>F7_SEGMENT_MAX||in->full_size>F7_JSON_INTEGER_MAX||
 in->offset>in->full_size||in->length>in->full_size-in->offset||
 in->count>F7_JSON_INTEGER_MAX)return F7_INVALID;
 *length=0;text(&o,"{\"attempt\":");hex(&o,in->attempt,32);
 text(&o,",\"count\":");integer(&o,in->count);
 text(&o,",\"full_sha256\":");hex(&o,in->full_sha256,32);
 text(&o,",\"full_size\":");integer(&o,in->full_size);
 text(&o,",\"invocation\":");hex(&o,in->invocation,16);
 text(&o,",\"length\":");integer(&o,in->length);
 text(&o,",\"member\":");hex(&o,in->member,16);
 text(&o,",\"offset\":");integer(&o,in->offset);
 text(&o,",\"ordinal\":");integer(&o,in->ordinal);
 text(&o,",\"schema\":\"f7_segment_metadata_v1\"}");
 if(o.failed||o.used>F7_FRAME_MAX)return F7_OVERFLOWED;
 *length=o.used;return F7_OK;
}
