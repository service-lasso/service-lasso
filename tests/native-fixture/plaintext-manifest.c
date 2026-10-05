#include "plaintext-manifest.h"
#include "segment-record.h"
#include <string.h>
struct output {uint8_t *bytes;size_t capacity,used;int failed;};
static void text(struct output *o,const char *s){
 size_t n=strlen(s);if(o->failed)return;
 if(n>o->capacity-o->used){o->failed=1;return;}
 memcpy(o->bytes+o->used,s,n);o->used+=n;
}
static void hex(struct output *o,const uint8_t *p,size_t n){
 static const char alphabet[]="0123456789abcdef";text(o,"\"");
 for(size_t i=0;i<n;i++){char pair[3]={alphabet[p[i]>>4],alphabet[p[i]&15],0};text(o,pair);}
 text(o,"\"");
}
static void integer(struct output *o,uint64_t n){
 char result[21];size_t used=0;
 if(n>F7_JSON_INTEGER_MAX){o->failed=1;return;}
 do{result[used++]=(char)('0'+n%10);n/=10;}while(n);
 for(size_t i=0;i<used/2;i++){char temporary=result[i];result[i]=result[used-i-1];result[used-i-1]=temporary;}
 result[used]=0;text(o,result);
}
static void values(struct output *o,const uint64_t *values,size_t count){
 text(o,"[");for(size_t i=0;i<count;i++){if(i)text(o,",");integer(o,values[i]);}text(o,"]");
}
static int present(const uint8_t *p,size_t n){uint8_t found=0;for(size_t i=0;i<n;i++)found|=p[i];return found!=0;}
static int disjoint(const void *a,size_t an,const void *b,size_t bn){
 uintptr_t x=(uintptr_t)a,y=(uintptr_t)b;
 if((an&&!x)||(bn&&!y)||an>UINTPTR_MAX-x||bn>UINTPTR_MAX-y)return 0;
 return !an||!bn||x+an<=y||y+bn<=x;
}
static int output_separate(uint8_t *out,size_t capacity,size_t *length,const void *source,size_t bytes){
 return disjoint(out,capacity,source,bytes)&&disjoint(length,sizeof(*length),source,bytes);
}
static int output_memory(uint8_t *out,size_t capacity,size_t *length,const struct f7_async_memory *memory){
 return output_separate(out,capacity,length,memory->state,memory->state_bytes)&&
  output_separate(out,capacity,length,memory->ring,memory->ring_bytes)&&
  output_separate(out,capacity,length,memory->write_buffer,memory->write_bytes);
}
static int output_geometry(const struct f7_manifest_input *in,uint8_t *out,size_t capacity,size_t *length){
 const struct f7_capture *c=in->capture;
 if(!disjoint(out,capacity,length,sizeof(*length))||
    !output_separate(out,capacity,length,in,sizeof(*in))||
    !output_separate(out,capacity,length,c,sizeof(*c))||
    !output_separate(out,capacity,length,c->witness,sizeof(*c->witness))||
    !output_separate(out,capacity,length,c->reservation,sizeof(*c->reservation))||
    !output_separate(out,capacity,length,c->native_drain_storage,c->native_drain_storage_bytes)||
    !output_separate(out,capacity,length,in->members,in->member_count*sizeof(*in->members))||
    !output_separate(out,capacity,length,in->segments,in->segment_count*sizeof(*in->segments))||
    !output_separate(out,capacity,length,in->unavailable,in->unavailable_count*sizeof(*in->unavailable))||
    !output_separate(out,capacity,length,c->witness->record_buffer,c->witness->record_capacity)||
    !output_memory(out,capacity,length,&c->witness_memory)||
    !output_memory(out,capacity,length,&c->emergency_memory))return F7_CONFLICT;
 if(c->error_channel){
  if(!output_separate(out,capacity,length,c->error_channel,sizeof(*c->error_channel))||
     !output_separate(out,capacity,length,c->error_channel->payload,c->error_channel->payload_capacity))return F7_CONFLICT;
  if(c->error_channel->partial&&
     (!output_separate(out,capacity,length,c->error_channel->partial,sizeof(*c->error_channel->partial))||
      !output_separate(out,capacity,length,c->error_channel->partial->bytes,c->error_channel->partial->capacity)))return F7_CONFLICT;
 }
 for(unsigned i=0;i<F7_STREAM_COUNT;i++)if(
    !output_memory(out,capacity,length,c->raw_memory+i)||
    !output_separate(out,capacity,length,c->drain_buffer[i],c->drain_capacity[i]))return F7_CONFLICT;
 for(size_t i=0;i<in->member_count;i++){
  const struct f7_member *m=in->members[i].persisted;
  if(!m||!output_separate(out,capacity,length,m,sizeof(*m))||
     !output_separate(out,capacity,length,m->readback_storage,m->readback_capacity))return F7_CONFLICT;
 }
 return F7_OK;
}
static int retained_queue(struct f7_async_spool *queue,const struct f7_member *member,int incomplete){
 struct f7_async_status status;
 if(!queue||!member||f7_async_snapshot(queue,&status)||!status.finished||
    !status.joined||status.worker_created!=1||!status.worker_entered||
    status.persisted!=member->length||status.persisted>status.submitted||
    status.in_flight_persisted>status.in_flight)return F7_INCOMPLETE;
 if(!incomplete&&(status.failed||status.queued||status.in_flight||
    status.persisted!=status.submitted))return F7_INCOMPLETE;
 return F7_OK;
}
static int original_member(const struct f7_manifest_input *in,enum f7_record_kind kind,
 const struct f7_member *original,int required){
 size_t found=0;
 for(size_t i=0;i<in->member_count;i++)if(in->members[i].kind==kind){
  if(!required||in->members[i].persisted!=original)return F7_CONFLICT;
  found++;
 }
 return found==(size_t)required?F7_OK:F7_CONFLICT;
}
int f7_canonical_manifest(const struct f7_manifest_input *in,uint8_t *out,size_t capacity,size_t *length){
 struct output o={out,capacity,0,0};uint32_t classes=0;
 if(!in||!out||!length||!in->capture||!in->capture->witness||!in->capture->reservation||
    !in->members||!in->member_count||in->member_count>F7_OBJECT_MAX||
    !in->segments||!in->segment_count||in->segment_count>=F7_OBJECT_MAX||
    (in->unavailable_count&&!in->unavailable)||in->unavailable_count>F7_OBJECT_MAX||
    in->row>=9||(in->platform!=F7_PLATFORM_WINDOWS&&in->platform!=F7_PLATFORM_LINUX)||
    !present(in->candidate_head,20)||!present(in->candidate_tree,20)||
    !present(in->candidate_base,20)||!present(in->admission_sha256,32))return F7_INVALID;
 int geometry=output_geometry(in,out,capacity,length);if(geometry)return geometry;
 *length=0;
 for(size_t i=0;i<in->member_count;i++){
  const struct f7_manifest_member *m=in->members+i;
  if(m->kind<F7_RECORD_SOURCE_INVENTORY||m->kind>F7_RECORD_ORIGINAL_ADMISSION||
     !m->persisted||!m->persisted->finalized||!m->persisted->readback_complete||
     (i&&memcmp(in->members[i-1].key,m->key,16)>=0))return F7_INCOMPLETE;
  if(m->kind==F7_RECORD_ORIGINAL_ADMISSION&&
     sodium_memcmp(m->persisted->digest,in->admission_sha256,32))return F7_AUTH_FAILURE;
  classes|=UINT32_C(1)<<(m->kind-1);
 }
 /* O cannot bootstrap capture from a missing source/tool/ENV/native/actor/
    ancestor/endpoint/row admission. Their original records are retained, not
    merely asserted in the candidate digest or replaced by public booleans. */
 uint32_t prerequisite=((UINT32_C(1)<<11)-1)|(UINT32_C(1)<<(F7_RECORD_ORIGINAL_ADMISSION-1));
 if((classes&prerequisite)!=prerequisite)return F7_AUTH_FAILURE;
 for(size_t i=0;i<in->member_count;i++)if((in->members[i].kind<=F7_RECORD_ROW_RESERVATION||
    in->members[i].kind==F7_RECORD_ORIGINAL_ADMISSION)&&in->members[i].persisted->failed)return F7_AUTH_FAILURE;
 for(size_t i=0;i<in->unavailable_count;i++){
  const struct f7_manifest_unavailable *u=in->unavailable+i;
  if(u->kind<F7_RECORD_SOURCE_INVENTORY||u->kind>F7_RECORD_ORIGINAL_ADMISSION||
     (i&&memcmp(in->unavailable[i-1].key,u->key,16)>=0))return F7_INVALID;
  for(size_t j=0;j<in->member_count;j++)if(!memcmp(u->key,in->members[j].key,16))return F7_CONFLICT;
 }
 for(size_t i=0;i<in->segment_count;i++){
  const struct f7_manifest_segment *s=in->segments+i;size_t m;
  if(i&&memcmp(in->segments[i-1].key,s->key,16)>=0)return F7_CONFLICT;
  for(m=0;m<in->member_count;m++)if(!memcmp(s->member,in->members[m].key,16))break;
  if(m==in->member_count)return F7_CONFLICT;
  const struct f7_member *member=in->members[m].persisted;
  uint64_t count=member->length/F7_SEGMENT_MAX+(member->length%F7_SEGMENT_MAX!=0);if(!count)count=1;
  if(s->count!=count||s->ordinal>=count||s->offset!=s->ordinal*F7_SEGMENT_MAX||
     s->offset>member->length)return F7_CONFLICT;
  uint64_t n=member->length-s->offset;if(n>F7_SEGMENT_MAX)n=F7_SEGMENT_MAX;
  if(s->length!=n||s->plaintext_length!=n+F7_SEGMENT_HEADER_BYTES||
     s->ciphertext_length!=s->plaintext_length+crypto_box_SEALBYTES)return F7_CONFLICT;
  for(size_t j=0;j<i;j++)if(!memcmp(s->member,in->segments[j].member,16)&&
     s->ordinal==in->segments[j].ordinal)return F7_CONFLICT;
 }
 /* Exactly one segment per ordinal of every present underlying record. */
 for(size_t m=0;m<in->member_count;m++){
  uint64_t wanted=in->members[m].persisted->length/F7_SEGMENT_MAX+
   (in->members[m].persisted->length%F7_SEGMENT_MAX!=0);if(!wanted)wanted=1;
  uint64_t found=0;
  for(size_t i=0;i<in->segment_count;i++)if(!memcmp(in->segments[i].member,in->members[m].key,16)){
   found++;
  }
  if(found!=wanted)return F7_CONFLICT;
 }
 const struct f7_capture *c=in->capture;const struct f7_reservation *r=c->reservation;
 struct f7_reservation arithmetic;
 if(f7_budget_derive(&arithmetic,&r->input)||
    (in->unavailable_count&&!c->incomplete)||
    (c->child_created==F7_NOT_CREATED&&c->child_exit_observed)||
    (!c->incomplete&&c->child_created==F7_CREATED&&!c->child_exit_observed))return F7_INCOMPLETE;
 if(!c->prepared||c->native_drains||
    (c->child_created!=F7_CREATED&&c->child_created!=F7_NOT_CREATED))return F7_INCOMPLETE;
 struct f7_async_spool *witness_queues[2]={c->witness->async,c->witness->emergency_async};
 const struct f7_member *witness_members[2]={c->witness->member,c->witness->emergency_member};
 for(unsigned i=0;i<2;i++){
  if(original_member(in,(enum f7_record_kind)(F7_RECORD_WITNESS+i),witness_members[i],1))return F7_CONFLICT;
  if(retained_queue(witness_queues[i],witness_members[i],c->incomplete))return F7_INCOMPLETE;
  if(witness_members[i]->length>(i?r->input.emergency_bytes:r->input.witness_bytes))return F7_INCOMPLETE;
 }
 for(unsigned i=0;i<F7_STREAM_COUNT;i++){
  if(c->created[i]!=F7_CREATED&&c->created[i]!=F7_NOT_CREATED)return F7_INCOMPLETE;
  if(original_member(in,(enum f7_record_kind)(F7_RECORD_RAW_STDOUT+i),c->raw[i],c->created[i]==F7_CREATED))return F7_CONFLICT;
  if(c->created[i]==F7_NOT_CREATED&&(c->natural_eof[i]||c->observed[i]))return F7_INCOMPLETE;
  if(c->created[i]==F7_CREATED&&retained_queue(c->raw_async[i],c->raw[i],c->incomplete))return F7_INCOMPLETE;
  if(c->created[i]==F7_CREATED&&(!c->raw[i]||!c->raw[i]->readback_complete))return F7_INCOMPLETE;
  if(c->created[i]==F7_CREATED&&(c->raw[i]->length>c->observed[i]||
     c->raw[i]->length>r->input.original[i]||(!c->incomplete&&c->raw[i]->length!=c->observed[i])))return F7_INCOMPLETE;
  if(!c->incomplete&&c->created[i]==F7_CREATED&&(!c->natural_eof[i]||c->raw_lost[i]))return F7_INCOMPLETE;
 }
 for(size_t i=0;i<in->member_count;i++)if(in->members[i].persisted->failed&&!c->incomplete)return F7_INCOMPLETE;
 text(&o,"{\"admission_sha256\":");hex(&o,in->admission_sha256,32);
 text(&o,",\"attempt\":");hex(&o,c->witness->attempt,32);
 text(&o,",\"attempt_ordinal\":");integer(&o,in->attempt_ordinal);
 text(&o,",\"budgets\":{\"derivation_sha256\":");hex(&o,r->input.derivation_sha256,32);
 text(&o,",\"emergency_bytes\":");integer(&o,r->input.emergency_bytes);
 text(&o,",\"emergency_queue_bytes\":");integer(&o,r->input.emergency_queue_bytes);
 text(&o,",\"frame_count\":");integer(&o,r->input.frame_count);
 text(&o,",\"inventory_entries\":");integer(&o,r->input.inventory_entries);
 text(&o,",\"manifest_bytes\":");integer(&o,r->input.manifest_bytes);
 text(&o,",\"original_bytes\":");values(&o,r->input.original,F7_STREAM_COUNT);
 text(&o,",\"queue_bytes\":");values(&o,r->input.queue_bytes,F7_STREAM_COUNT);
 text(&o,",\"row_input_sha256\":");hex(&o,r->input.row_input_sha256,32);
 text(&o,",\"transfer_milliseconds\":");integer(&o,r->input.transfer_milliseconds);
 text(&o,",\"witness_bytes\":");integer(&o,r->input.witness_bytes);
 text(&o,",\"witness_queue_bytes\":");integer(&o,r->input.witness_queue_bytes);text(&o,"}");
 text(&o,",\"candidate\":{\"base\":");hex(&o,in->candidate_base,20);
 text(&o,",\"head\":");hex(&o,in->candidate_head,20);text(&o,",\"tree\":");hex(&o,in->candidate_tree,20);text(&o,"}");
 text(&o,",\"capture\":{\"child_creation\":");integer(&o,c->child_created);
 text(&o,",\"child_exit_observed\":");text(&o,c->child_exit_observed?"true":"false");
 text(&o,",\"disposition\":\"");text(&o,c->incomplete?"capture_incomplete":"capture_recorded");
 text(&o,"\",\"streams\":[");
 for(unsigned i=0;i<F7_STREAM_COUNT;i++){
  uint8_t status[8];f7_u64be(status,(uint64_t)c->terminal_status[i]);if(i)text(&o,",");
  text(&o,"{\"creation\":");integer(&o,c->created[i]);text(&o,",\"native_status_bits\":");hex(&o,status,8);
  text(&o,",\"natural_eof\":");text(&o,c->natural_eof[i]?"true":"false");
  text(&o,",\"observed\":");integer(&o,c->observed[i]);text(&o,",\"stream\":");integer(&o,i);text(&o,"}");
 }text(&o,"]}");
 text(&o,",\"invocation\":");hex(&o,c->witness->invocation,16);
 text(&o,",\"members\":[");
 for(size_t i=0;i<in->member_count;i++){
  const struct f7_manifest_member *m=in->members+i;const struct f7_identity *id=&m->persisted->identity;if(i)text(&o,",");
  if(id->owner_length>sizeof(id->owner))return F7_INVALID;
  text(&o,"{\"failed\":");text(&o,m->persisted->failed?"true":"false");
  text(&o,",\"key\":");hex(&o,m->key,16);text(&o,",\"kind\":");integer(&o,m->kind);
  text(&o,",\"length\":");integer(&o,m->persisted->length);text(&o,",\"object_identity\":");hex(&o,id->object,sizeof(id->object));
  text(&o,",\"owner\":");hex(&o,id->owner,id->owner_length);text(&o,",\"protection_sha256\":");hex(&o,id->protection_sha256,32);
  text(&o,",\"sha256\":");hex(&o,m->persisted->digest,32);text(&o,"}");
 }text(&o,"]");text(&o,",\"platform\":\"");text(&o,in->platform==F7_PLATFORM_WINDOWS?"windows":"linux");
 text(&o,"\",\"protocol\":1,\"row\":");integer(&o,in->row);text(&o,",\"schema\":\"f7_plaintext_manifest_v1\",\"segments\":[");
 for(size_t i=0;i<in->segment_count;i++){
  const struct f7_manifest_segment *s=in->segments+i;if(i)text(&o,",");
  text(&o,"{\"ciphertext_length\":");integer(&o,s->ciphertext_length);text(&o,",\"ciphertext_sha256\":");hex(&o,s->ciphertext_sha256,32);
  text(&o,",\"count\":");integer(&o,s->count);text(&o,",\"key\":");hex(&o,s->key,16);text(&o,",\"length\":");integer(&o,s->length);
  text(&o,",\"member\":");hex(&o,s->member,16);text(&o,",\"offset\":");integer(&o,s->offset);text(&o,",\"ordinal\":");integer(&o,s->ordinal);
  text(&o,",\"plaintext_length\":");integer(&o,s->plaintext_length);text(&o,",\"plaintext_sha256\":");hex(&o,s->plaintext_sha256,32);text(&o,"}");
 }text(&o,"],\"unavailable\":[");
 for(size_t i=0;i<in->unavailable_count;i++){
  const struct f7_manifest_unavailable *u=in->unavailable+i;if(i)text(&o,",");
  text(&o,"{\"key\":");hex(&o,u->key,16);text(&o,",\"kind\":");integer(&o,u->kind);
  text(&o,",\"native_status_bits\":");hex(&o,u->native_status_bits,8);text(&o,"}");
 }text(&o,"]}");
 if(o.failed||o.used>r->input.manifest_bytes)return F7_OVERFLOWED;
 *length=o.used;return F7_OK;
}
