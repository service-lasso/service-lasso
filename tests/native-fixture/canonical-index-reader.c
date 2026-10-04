#include "canonical-index.h"
#include <string.h>
struct cursor {const uint8_t *bytes;size_t length,offset;int failed;};
static void literal(struct cursor *c,const char *s){
 size_t n=strlen(s);if(c->failed)return;
 if(n>c->length-c->offset||memcmp(c->bytes+c->offset,s,n)){c->failed=1;return;}c->offset+=n;
}
static int nibble(uint8_t n){if(n>='0'&&n<='9')return n-'0';if(n>='a'&&n<='f')return n-'a'+10;return -1;}
static void hex(struct cursor *c,uint8_t *out,size_t n){
 size_t i;literal(c,"\"");
 if(c->failed||n>(c->length-c->offset)/2){c->failed=1;return;}
 for(i=0;i<n;i++){int a=nibble(c->bytes[c->offset++]),b=nibble(c->bytes[c->offset++]);
  if(a<0||b<0){c->failed=1;return;}out[i]=(uint8_t)((a<<4)|b);}
 literal(c,"\"");
}
static uint64_t number(struct cursor *c){
 uint64_t result=0;size_t start=c->offset;
 if(c->failed||c->offset>=c->length||c->bytes[c->offset]<'0'||c->bytes[c->offset]>'9'){
  c->failed=1;return 0;}
 while(c->offset<c->length&&c->bytes[c->offset]>='0'&&c->bytes[c->offset]<='9'){
  uint8_t digit=(uint8_t)(c->bytes[c->offset++]-'0');
  if(result>(F7_JSON_INTEGER_MAX-digit)/10){c->failed=1;return 0;}
  result=result*10+digit;
 }
 if(c->offset-start>1&&c->bytes[start]=='0')c->failed=1;
 return result;
}
int f7_decode_index(const uint8_t *input,size_t length,struct f7_index_input *out,
 struct f7_index_object *objects,size_t capacity,uint8_t *scratch,size_t scratch_capacity){
 struct cursor c={input,length,0,0};struct f7_index_input decoded;
 uint8_t manifest[16],inventory_digest[32];size_t encoded_n=0,manifest_count=0;
 if(!input||!length||!out||!objects||!capacity||capacity>F7_OBJECT_MAX||!scratch)return F7_INVALID;
 memset(&decoded,0,sizeof(decoded));decoded.objects=objects;
 literal(&c,"{\"attempt\":");hex(&c,decoded.attempt,32);
 literal(&c,",\"encrypted_manifest\":");hex(&c,manifest,16);
 literal(&c,",\"inventory_digest\":");hex(&c,inventory_digest,32);
 literal(&c,",\"invocation\":");hex(&c,decoded.invocation,16);
 literal(&c,",\"objects\":[");
 while(!c.failed&&c.offset<c.length&&c.bytes[c.offset]!=']'){
  struct f7_index_object *o;
  if(decoded.count==capacity)return F7_OVERFLOWED;
  o=objects+decoded.count;memset(o,0,sizeof(*o));
  if(decoded.count)literal(&c,",");
  literal(&c,"{\"key\":");hex(&c,o->key,16);
  literal(&c,",\"kind\":\"");
  if(c.offset<c.length&&c.bytes[c.offset]=='e'){
   /* Both names share 'encrypted_'; compare complete exact literals. */
   if(c.length-c.offset>=18&&!memcmp(c.bytes+c.offset,"encrypted_manifest",18)){
    literal(&c,"encrypted_manifest");o->kind=F7_ENCRYPTED_MANIFEST;manifest_count++;
    if(memcmp(o->key,manifest,16))c.failed=1;
   }else{literal(&c,"encrypted_segment");o->kind=F7_ENCRYPTED_SEGMENT;}
  }else c.failed=1;
  literal(&c,"\",\"length\":");o->length=number(&c);
  literal(&c,",\"sha256\":");hex(&c,o->sha256,32);literal(&c,"}");
  if(!o->length||(decoded.count&&memcmp(objects[decoded.count-1].key,o->key,16)>=0))c.failed=1;
  decoded.count++;
 }
 literal(&c,"],\"observer_key\":");hex(&c,decoded.observer_key,32);
 literal(&c,",\"plaintext_manifest_digest\":");hex(&c,decoded.plaintext_manifest_sha256,32);
 literal(&c,",\"protocol\":1,\"receiver_key\":");hex(&c,decoded.receiver_key,32);
 literal(&c,",\"schema\":\"f7_transport_index_v1\",\"signature_algorithm\":\"Ed25519\"}");
 if(c.failed||c.offset!=c.length||manifest_count!=1||!decoded.count)return F7_INVALID;
 /* Full exact re-encoding also recomputes complete inventory digest. No
    normalized acceptance: comparison requires identical original bytes. */
 int result=f7_canonical_index(&decoded,scratch,scratch_capacity,&encoded_n);
 if(result)return result;
 if(encoded_n!=length||memcmp(scratch,input,length))return F7_CONFLICT;
 /* Fixed decoded fields, no pointers into caller input or unbounded strings. */
 *out=decoded;(void)inventory_digest;return F7_OK;
}
