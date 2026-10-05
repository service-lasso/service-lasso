#include "manifest-reader.h"
#include "segment-record.h"
#include <string.h>
struct cursor {const uint8_t *p;size_t length,at;int failed;};
static int begins(struct cursor *c,const char *s){size_t n=strlen(s);return !c->failed&&n<=c->length-c->at&&!memcmp(c->p+c->at,s,n);}
static void literal(struct cursor *c,const char *s){if(!begins(c,s)){c->failed=1;return;}c->at+=strlen(s);}
static int nibble(uint8_t n){return n>='0'&&n<='9'?n-'0':n>='a'&&n<='f'?n-'a'+10:-1;}
static size_t hex(struct cursor *c,uint8_t *out,size_t maximum,int fixed){
 size_t used=0;literal(c,"\"");
 while(!c->failed&&c->at<c->length&&c->p[c->at]!='"'){
  if(used==maximum||c->length-c->at<2){c->failed=1;break;}
  int a=nibble(c->p[c->at++]),b=nibble(c->p[c->at++]);
  if(a<0||b<0){c->failed=1;break;}out[used++]=(uint8_t)((a<<4)|b);
 }
 literal(c,"\"");if(fixed&&used!=maximum)c->failed=1;return used;
}
static uint64_t number(struct cursor *c){
 uint64_t n=0;size_t start=c->at;
 if(c->failed||c->at==c->length||c->p[c->at]<'0'||c->p[c->at]>'9'){c->failed=1;return 0;}
 while(c->at<c->length&&c->p[c->at]>='0'&&c->p[c->at]<='9'){
  uint8_t digit=c->p[c->at++]-'0';if(n>(F7_JSON_INTEGER_MAX-digit)/10){c->failed=1;return 0;}n=n*10+digit;
 }
 if(c->at-start>1&&c->p[start]=='0')c->failed=1;return n;
}
static int boolean(struct cursor *c){if(begins(c,"true")){literal(c,"true");return 1;}literal(c,"false");return 0;}
static void values(struct cursor *c,uint64_t *out,size_t count){
 literal(c,"[");for(size_t i=0;i<count;i++){if(i)literal(c,",");out[i]=number(c);}literal(c,"]");
}
static int kind(uint64_t n){return n>=F7_RECORD_SOURCE_INVENTORY&&n<=F7_RECORD_ORIGINAL_ADMISSION;}
static int decision(uint64_t n){return n==F7_CREATED||n==F7_NOT_CREATED;}
static int semantics(struct f7_decoded_manifest *o){
 uint32_t classes=0;
 if(!o->member_count||!o->segment_count||!decision(o->child_creation)||
    (o->child_creation==F7_NOT_CREATED&&o->child_exit_observed)||
    (!o->incomplete&&o->child_creation==F7_CREATED&&!o->child_exit_observed))return F7_INVALID;
 for(unsigned i=0;i<F7_STREAM_COUNT;i++){
  const struct f7_decoded_stream *s=o->streams+i;
  if(!decision(s->creation)||(s->creation==F7_NOT_CREATED&&(s->natural_eof||s->observed))||
     (!o->incomplete&&s->creation==F7_CREATED&&!s->natural_eof))return F7_INVALID;
 }
 for(size_t i=0;i<o->member_count;i++){
  const struct f7_decoded_member *m=o->members+i;
  if(!kind(m->kind)||(i&&memcmp(o->members[i-1].key,m->key,16)>=0)||
     (o->platform==F7_PLATFORM_LINUX&&m->asserted_identity.owner_length!=8)||
     (o->platform==F7_PLATFORM_WINDOWS&&m->asserted_identity.owner_length<8)||
     (!o->incomplete&&m->failed))return F7_INVALID;
  classes|=UINT32_C(1)<<(m->kind-1);
  if(m->kind==F7_RECORD_ORIGINAL_ADMISSION&&sodium_memcmp(m->digest,o->admission,32))return F7_AUTH_FAILURE;
  if((m->kind<=F7_RECORD_ROW_RESERVATION||m->kind==F7_RECORD_ORIGINAL_ADMISSION)&&m->failed)return F7_AUTH_FAILURE;
 }
 uint32_t prerequisites=((UINT32_C(1)<<11)-1)|(UINT32_C(1)<<(F7_RECORD_ORIGINAL_ADMISSION-1));
 if((classes&prerequisites)!=prerequisites)return F7_AUTH_FAILURE;
 /* Bind the decoded graph to its declared capture. This checks bytes only;
    these classifications cannot authenticate an original endpoint or actor. */
 for(unsigned stream=0;stream<F7_STREAM_COUNT;stream++){
  size_t found=0;
  for(size_t i=0;i<o->member_count;i++)if(o->members[i].kind==(enum f7_record_kind)(F7_RECORD_RAW_STDOUT+stream)){
   const struct f7_decoded_member *m=o->members+i;found++;
   if(o->streams[stream].creation!=F7_CREATED||m->length>o->streams[stream].observed||
      m->length>o->budgets.original[stream]||(!o->incomplete&&m->length!=o->streams[stream].observed))return F7_CONFLICT;
  }
  if(found!=(size_t)(o->streams[stream].creation==F7_CREATED))return F7_CONFLICT;
 }
 for(unsigned kind=F7_RECORD_WITNESS;kind<=F7_RECORD_EMERGENCY_WITNESS;kind++){
  size_t found=0;for(size_t i=0;i<o->member_count;i++)if(o->members[i].kind==(enum f7_record_kind)kind)found++;
  if(found!=1)return F7_CONFLICT;
 }
 for(size_t i=0;i<o->unavailable_count;i++){
  const struct f7_manifest_unavailable *u=o->unavailable+i;
  if(!kind(u->kind)||(i&&memcmp(o->unavailable[i-1].key,u->key,16)>=0)||!o->incomplete)return F7_INVALID;
  for(size_t j=0;j<o->member_count;j++)if(!memcmp(u->key,o->members[j].key,16))return F7_CONFLICT;
 }
 for(size_t i=0;i<o->segment_count;i++){
  const struct f7_manifest_segment *s=o->segments+i;size_t m;
  if(i&&memcmp(o->segments[i-1].key,s->key,16)>=0)return F7_CONFLICT;
  for(m=0;m<o->member_count;m++)if(!memcmp(s->member,o->members[m].key,16))break;
  if(m==o->member_count)return F7_CONFLICT;
  uint64_t count=o->members[m].length/F7_SEGMENT_MAX+(o->members[m].length%F7_SEGMENT_MAX!=0);if(!count)count=1;
  if(s->count!=count||s->ordinal>=count||s->offset!=s->ordinal*F7_SEGMENT_MAX||s->offset>o->members[m].length)return F7_CONFLICT;
  uint64_t n=o->members[m].length-s->offset;if(n>F7_SEGMENT_MAX)n=F7_SEGMENT_MAX;
  if(s->length!=n||s->plaintext_length!=n+F7_SEGMENT_HEADER_BYTES||
     s->ciphertext_length!=s->plaintext_length+crypto_box_SEALBYTES)return F7_CONFLICT;
  for(size_t j=0;j<i;j++)if(!memcmp(s->member,o->segments[j].member,16)&&s->ordinal==o->segments[j].ordinal)return F7_CONFLICT;
 }
 for(size_t m=0;m<o->member_count;m++){
  uint64_t wanted=o->members[m].length/F7_SEGMENT_MAX+(o->members[m].length%F7_SEGMENT_MAX!=0);if(!wanted)wanted=1;
  uint64_t found=0;for(size_t i=0;i<o->segment_count;i++)if(!memcmp(o->segments[i].member,o->members[m].key,16))found++;
  if(found!=wanted)return F7_CONFLICT;
 }
 return F7_OK;
}
int f7_decode_manifest(const uint8_t *bytes,size_t length,struct f7_decoded_manifest *o){
 struct cursor c={bytes,length,0,0};uint64_t n;
 if(!bytes||!length||length>F7_SEGMENT_MAX||!o||!o->members||!o->member_capacity||
    o->member_capacity>F7_OBJECT_MAX||!o->segments||!o->segment_capacity||o->segment_capacity>=F7_OBJECT_MAX||
    (o->unavailable_capacity&&!o->unavailable)||o->unavailable_capacity>F7_OBJECT_MAX)return F7_INVALID;
 o->member_count=0;o->segment_count=0;o->unavailable_count=0;
 literal(&c,"{\"admission_sha256\":");hex(&c,o->admission,32,1);literal(&c,",\"attempt\":");hex(&c,o->attempt,32,1);
 literal(&c,",\"attempt_ordinal\":");o->attempt_ordinal=number(&c);
 literal(&c,",\"budgets\":{\"derivation_sha256\":");hex(&c,o->budgets.derivation_sha256,32,1);
 literal(&c,",\"emergency_bytes\":");o->budgets.emergency_bytes=number(&c);
 literal(&c,",\"emergency_queue_bytes\":");o->budgets.emergency_queue_bytes=number(&c);
 literal(&c,",\"frame_count\":");o->budgets.frame_count=number(&c);
 literal(&c,",\"inventory_entries\":");o->budgets.inventory_entries=number(&c);
 literal(&c,",\"manifest_bytes\":");o->budgets.manifest_bytes=number(&c);
 literal(&c,",\"original_bytes\":");values(&c,o->budgets.original,F7_STREAM_COUNT);
 literal(&c,",\"queue_bytes\":");values(&c,o->budgets.queue_bytes,F7_STREAM_COUNT);
 literal(&c,",\"row_input_sha256\":");hex(&c,o->budgets.row_input_sha256,32,1);
 literal(&c,",\"transfer_milliseconds\":");o->budgets.transfer_milliseconds=number(&c);
 literal(&c,",\"witness_bytes\":");o->budgets.witness_bytes=number(&c);
 literal(&c,",\"witness_queue_bytes\":");o->budgets.witness_queue_bytes=number(&c);literal(&c,"}");
 literal(&c,",\"candidate\":{\"base\":");hex(&c,o->base,20,1);literal(&c,",\"head\":");hex(&c,o->head,20,1);
 literal(&c,",\"tree\":");hex(&c,o->tree,20,1);literal(&c,"}");
 literal(&c,",\"capture\":{\"child_creation\":");n=number(&c);if(!decision(n))c.failed=1;o->child_creation=(enum f7_creation_decision)n;
 literal(&c,",\"child_exit_observed\":");o->child_exit_observed=boolean(&c);literal(&c,",\"disposition\":\"");
 if(begins(&c,"capture_incomplete")){o->incomplete=1;literal(&c,"capture_incomplete");}
 else{o->incomplete=0;literal(&c,"capture_recorded");}literal(&c,"\",\"streams\":[");
 for(unsigned i=0;i<F7_STREAM_COUNT;i++){
  if(i)literal(&c,",");literal(&c,"{\"creation\":");n=number(&c);if(!decision(n))c.failed=1;
  o->streams[i].creation=(enum f7_creation_decision)n;literal(&c,",\"native_status_bits\":");hex(&c,o->streams[i].native_status_bits,8,1);
  literal(&c,",\"natural_eof\":");o->streams[i].natural_eof=boolean(&c);literal(&c,",\"observed\":");o->streams[i].observed=number(&c);
  literal(&c,",\"stream\":");if(number(&c)!=i)c.failed=1;literal(&c,"}");
 }literal(&c,"]}");literal(&c,",\"invocation\":");hex(&c,o->invocation,16,1);literal(&c,",\"members\":[");
 while(!c.failed&&!begins(&c,"]")){
  if(o->member_count==o->member_capacity)return F7_OVERFLOWED;
  if(o->member_count)literal(&c,",");struct f7_decoded_member *m=o->members+o->member_count++;memset(m,0,sizeof(*m));
  literal(&c,"{\"failed\":");m->failed=boolean(&c);literal(&c,",\"key\":");hex(&c,m->key,16,1);
  literal(&c,",\"kind\":");n=number(&c);if(!kind(n))c.failed=1;m->kind=(enum f7_record_kind)n;
  literal(&c,",\"length\":");m->length=number(&c);literal(&c,",\"object_identity\":");hex(&c,m->asserted_identity.object,24,1);
  literal(&c,",\"owner\":");m->asserted_identity.owner_length=(uint32_t)hex(&c,m->asserted_identity.owner,68,0);
  literal(&c,",\"protection_sha256\":");hex(&c,m->asserted_identity.protection_sha256,32,1);
  literal(&c,",\"sha256\":");hex(&c,m->digest,32,1);literal(&c,"}");
 }literal(&c,"]");literal(&c,",\"platform\":\"");
 if(begins(&c,"windows")){o->platform=F7_PLATFORM_WINDOWS;literal(&c,"windows");}
 else{o->platform=F7_PLATFORM_LINUX;literal(&c,"linux");}
 literal(&c,"\",\"protocol\":1,\"row\":");n=number(&c);if(n>=9)c.failed=1;o->row=(unsigned)n;
 literal(&c,",\"schema\":\"f7_plaintext_manifest_v1\",\"segments\":[");
 while(!c.failed&&!begins(&c,"]")){
  if(o->segment_count==o->segment_capacity)return F7_OVERFLOWED;
  if(o->segment_count)literal(&c,",");struct f7_manifest_segment *s=o->segments+o->segment_count++;memset(s,0,sizeof(*s));
  literal(&c,"{\"ciphertext_length\":");s->ciphertext_length=number(&c);literal(&c,",\"ciphertext_sha256\":");hex(&c,s->ciphertext_sha256,32,1);
  literal(&c,",\"count\":");s->count=number(&c);literal(&c,",\"key\":");hex(&c,s->key,16,1);literal(&c,",\"length\":");s->length=number(&c);
  literal(&c,",\"member\":");hex(&c,s->member,16,1);literal(&c,",\"offset\":");s->offset=number(&c);literal(&c,",\"ordinal\":");s->ordinal=number(&c);
  literal(&c,",\"plaintext_length\":");s->plaintext_length=number(&c);literal(&c,",\"plaintext_sha256\":");hex(&c,s->plaintext_sha256,32,1);literal(&c,"}");
 }literal(&c,"],\"unavailable\":[");
 while(!c.failed&&!begins(&c,"]")){
  if(o->unavailable_count==o->unavailable_capacity)return F7_OVERFLOWED;
  if(o->unavailable_count)literal(&c,",");struct f7_manifest_unavailable *u=o->unavailable+o->unavailable_count++;memset(u,0,sizeof(*u));
  literal(&c,"{\"key\":");hex(&c,u->key,16,1);literal(&c,",\"kind\":");n=number(&c);if(!kind(n))c.failed=1;u->kind=(enum f7_record_kind)n;
  literal(&c,",\"native_status_bits\":");hex(&c,u->native_status_bits,8,1);literal(&c,"}");
 }literal(&c,"]}");
 if(c.failed||c.at!=c.length)return F7_INVALID;
 /* Arithmetic is a data consistency check; it is NOT an actual disk/memory
    reservation, original ROOT admission or native capture proof. */
 struct f7_reservation arithmetic;
 if(f7_budget_derive(&arithmetic,&o->budgets)||length>o->budgets.manifest_bytes)return F7_INVALID;
 return semantics(o);
}
