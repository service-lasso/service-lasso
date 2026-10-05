/* Source-authored native regression. UNEXECUTED: entire U1 source GO and NEW
   complete exact ROOT are prerequisites; this file is not a native receipt. */
#include "protocol.h"
#include "budget-reservation.h"
#include "public-projection.h"
#include "canonical-index.h"
#include "error-channel.h"
#include "observer.h"
#include "segment-record.h"
#include "error-graph.h"
#include "manifest-reader.h"
#include "recovery.h"
#include <assert.h>
#include <string.h>
#include <stdint.h>
static void framing(void){
 struct f7_frame original={0},decoded;uint8_t bytes[F7_FRAME_HEADER_SIZE];uint64_t sequence=0;
 original.invocation[0]=1;original.attempt[0]=2;original.role=F7_W;
 original.payload_type=1;original.sequence=1;original.payload_length=7;
 assert(f7_frame_encode(bytes,&original)==F7_OK);
 assert(f7_frame_decode(&decoded,bytes)==F7_OK);
 assert(f7_sequence_accept(&sequence,&decoded,original.invocation,original.attempt,F7_W)==F7_OK);
 assert(f7_sequence_accept(&sequence,&decoded,original.invocation,original.attempt,F7_W)==F7_AUTH_FAILURE);
 sequence=0;decoded.invocation[0]^=1;
 assert(f7_sequence_accept(&sequence,&decoded,original.invocation,original.attempt,F7_W)==F7_AUTH_FAILURE);
 assert(sequence==0);
 bytes[110]=1;assert(f7_frame_decode(&decoded,bytes)==F7_INVALID);
 bytes[110]=0;bytes[104]=255;assert(f7_frame_decode(&decoded,bytes)==F7_INVALID);
}
static void budgets(void){
 struct f7_budget_input in={0};struct f7_reservation r;uint64_t accepted,out;unsigned i;
 assert(f7_budget_derive(&r,&in)==F7_BUDGET_ABSENT);
 for(i=0;i<F7_STREAM_COUNT;i++){in.original[i]=1024;in.queue_bytes[i]=64;}
 in.witness_bytes=1024;in.manifest_bytes=1024;in.inventory_entries=5;
 in.emergency_bytes=1024;in.frame_count=16;in.transfer_milliseconds=1000;
 in.witness_queue_bytes=1024;
 in.emergency_queue_bytes=1024;
 in.row_input_sha256[0]=1;in.derivation_sha256[0]=2;
 assert(f7_budget_derive(&r,&in)==F7_OK);
 assert(f7_budget_take(&r,F7_STDOUT,1000,&accepted)==F7_OK&&accepted==1000);
 assert(f7_budget_take(&r,F7_STDOUT,100,&accepted)==F7_OVERFLOWED&&accepted==24);
 assert(r.captured[F7_STDOUT]==1024&&r.exhausted);
 assert(f7_budget_take(&r,F7_STDERR,1024,&accepted)==F7_OK&&accepted==1024);
 assert(f7_checked_add(UINT64_MAX,1,&out)==F7_OVERFLOWED);
 assert(f7_checked_mul(UINT64_MAX,2,&out)==F7_OVERFLOWED);
 assert(f7_budget_queue(&r,F7_PRIVATE_ERRORS,65)==F7_OVERFLOWED);
 assert(f7_budget_witness(&r,1024,1)==F7_OK);
 assert(f7_budget_witness(&r,1,1)==F7_OVERFLOWED);
}
static void states(void){
 enum f7_state state=F7_OBSERVER_ADMITTED;
 assert(f7_state_advance(&state,F7_CIPHERTEXT_READBACK_SIGNED)==F7_INVALID);
 assert(f7_state_advance(&state,F7_ORIGINAL_CAPTURE)==F7_OK);
 assert(f7_state_advance(&state,F7_RETAINED_UNRESOLVED)==F7_OK);
 assert(f7_state_advance(&state,F7_LOCAL_READBACK)==F7_INVALID);
 assert(!strcmp(f7_public_projection((enum f7_public_status)999),"{\"status\":\"capture_unavailable\"}"));
}
static void index_records(void){
 struct f7_index_object objects[2]={0},decoded_objects[2];
 struct f7_index_input input={0},decoded;uint8_t original[4096],scratch[4096];size_t n;
 objects[0].key[15]=1;objects[0].kind=F7_ENCRYPTED_SEGMENT;objects[0].length=128;
 objects[1].key[15]=2;objects[1].kind=F7_ENCRYPTED_MANIFEST;objects[1].length=256;
 input.objects=objects;input.count=2;
 assert(f7_canonical_index(&input,original,sizeof(original),&n)==F7_OK);
 assert(f7_decode_index(original,n,&decoded,decoded_objects,2,scratch,sizeof(scratch))==F7_OK);
 assert(decoded.count==2&&decoded.objects[1].kind==F7_ENCRYPTED_MANIFEST);
 original[n]='\n';assert(f7_decode_index(original,n+1,&decoded,decoded_objects,2,scratch,sizeof(scratch))==F7_INVALID);
 /* Equal plaintext or valid JSON is irrelevant: exact signed roster bytes
    reject changed/duplicate object keys and incomplete caller reservation. */
 assert(f7_decode_index(original,n,&decoded,decoded_objects,1,scratch,sizeof(scratch))==F7_OVERFLOWED);
 objects[1].key[15]=1;assert(f7_canonical_index(&input,original,sizeof(original),&n)==F7_INVALID);
}
static void error_records(void){
 struct f7_error_channel channel={0},partial={0};struct f7_frame frame={0};
 uint8_t payload[F7_FRAME_MAX];channel.payload=payload;channel.payload_capacity=sizeof(payload);channel.graph_node_limit=32;
 uint8_t record[F7_FRAME_HEADER_SIZE+7]={0};
 channel.role=F7_W;frame.role=F7_W;frame.sequence=1;frame.ordinal=1;
 frame.payload_type=F7_RAW_NATIVE_ERROR;frame.payload_length=7;
 assert(f7_frame_encode(record,&frame)==F7_OK);
 partial=channel;
 assert(f7_error_channel_feed(&channel,record,31,2,32)==F7_OK);
 assert(f7_error_channel_feed(&channel,record+31,sizeof(record)-31,2,32)==F7_OK);
 assert(f7_error_channel_eof(&channel)==F7_OK&&channel.frames==1);
 assert(f7_error_channel_feed(&channel,record,sizeof(record),2,32)==F7_INCOMPLETE);
 assert(f7_error_channel_feed(&partial,record,F7_FRAME_HEADER_SIZE,2,32)==F7_OK);
 assert(f7_error_channel_eof(&partial)==F7_INCOMPLETE);
}
static void unknown_creation(void){
 struct f7_capture capture={0};
 /* Zero/default/missing fields cannot mint not-created/EOF or capture success. */
 assert(f7_capture_validate(&capture)==F7_INVALID);
}
static void segment_records(void){
 struct f7_segment_input in={0},out;const uint8_t *raw;
 uint8_t record[F7_SEGMENT_HEADER_BYTES+1]={0};
 in.invocation[0]=1;in.attempt[0]=2;in.member[0]=3;
 in.full_size=F7_SEGMENT_MAX+1;in.count=2;in.ordinal=1;
 in.offset=F7_SEGMENT_MAX;in.length=1;record[F7_SEGMENT_HEADER_BYTES]=0xff;
 assert(f7_segment_encode(record,&in)==F7_OK);
 assert(f7_segment_record_decode(&out,&raw,record,sizeof(record),in.invocation,in.attempt,in.member)==F7_OK);
 assert(raw[0]==0xff&&out.offset==F7_SEGMENT_MAX);
 assert(f7_segment_record_decode(&out,&raw,record,sizeof(record)-1,in.invocation,in.attempt,in.member)==F7_INVALID);
 uint8_t wrong_attempt[32]={9};
 assert(f7_segment_record_decode(&out,&raw,record,sizeof(record),in.invocation,wrong_attempt,in.member)==F7_AUTH_FAILURE);
 record[152]=1;assert(f7_segment_decode(&out,record)==F7_INVALID);record[152]=0;
 f7_u64be(record+104,F7_SEGMENT_MAX-1);assert(f7_segment_decode(&out,record)==F7_INVALID);
 in.full_size=0;in.count=1;in.ordinal=0;in.offset=0;in.length=0;
 assert(f7_segment_encode(record,&in)==F7_OK);
 assert(f7_segment_record_decode(&out,&raw,record,F7_SEGMENT_HEADER_BYTES,in.invocation,in.attempt,in.member)==F7_OK);
 assert(f7_segment_record_decode(&out,&raw,record,sizeof(record),in.invocation,in.attempt,in.member)==F7_INVALID);
}
static void error_graphs(void){
 struct f7_error_node nodes[2]={{0},{0}};uint32_t aggregate[3]={2,2,1},secondary[1]={2};
 uint16_t units[3]={0x0041,0xd800,0};uint8_t payload[512];size_t length;
 nodes[0].kind=F7_GRAPH_AGGREGATE;nodes[0].cause_kind=F7_CAUSE_REFERENCE;nodes[0].cause=2;
 nodes[0].aggregate=aggregate;nodes[0].aggregate_count=3;nodes[0].name.units=units;nodes[0].name.count=3;
 nodes[1].kind=F7_GRAPH_ERROR;nodes[1].cause_kind=F7_CAUSE_REFERENCE;nodes[1].cause=1;
 struct f7_error_graph graph={nodes,2,1,secondary,1};
 assert(f7_error_graph_encode(&graph,payload,sizeof(payload),&length)==F7_OK);
 assert(f7_error_graph_validate(payload,length,2)==F7_OK);
 assert(f7_error_graph_validate(payload,length,1)==F7_INVALID);
 /* First aggregate edge begins after the 24-byte header, one secondary ID,
    and its 32-byte node record. Zero cannot alias an original object. */
 payload[63]=0;assert(f7_error_graph_validate(payload,length,2)==F7_INVALID);payload[63]=2;
 payload[length]=0;assert(f7_error_graph_validate(payload,length+1,2)==F7_INVALID);
 payload[9]=1;assert(f7_error_graph_validate(payload,length,2)==F7_INVALID);
}
static void signature_buffers(void){
 uint8_t original[2]={'{','}'},index[128],receipt[128];size_t in=0,rn=0;
 assert(f7_signature_message(F7_INDEX_DOMAIN,original,2,index,sizeof(index),&in)==F7_OK);
 assert(f7_signature_message(F7_RECEIPT_DOMAIN,original,2,receipt,sizeof(receipt),&rn)==F7_OK);
 assert(in!=rn||memcmp(index,receipt,in));
 assert(f7_signature_message(F7_INDEX_DOMAIN,original,2,index,1,&in)==F7_BUDGET_ABSENT);
 assert(f7_signature_message(F7_INDEX_DOMAIN,index,2,index,sizeof(index),&in)==F7_INVALID);
 assert(f7_signature_message((enum f7_signature_domain)0,original,2,index,sizeof(index),&in)==F7_INVALID);
 size_t needed=0;assert(f7_signature_message_size(F7_INDEX_DOMAIN,2,&needed)==F7_OK);
 assert(needed==in);
 needed=777;assert(f7_signature_message_size((enum f7_signature_domain)0,2,&needed)==F7_INVALID);
 assert(needed==777);
 union {size_t value;uint8_t bytes[128];} reserved;
 reserved.value=777;
 assert(f7_signature_message(F7_INDEX_DOMAIN,original,2,reserved.bytes,sizeof(reserved.bytes),&reserved.value)==F7_INVALID);
 assert(reserved.value==777);
 union {size_t value;uint8_t bytes[sizeof(size_t)];} immutable;
 immutable.value=888;
 assert(f7_signature_message(F7_INDEX_DOMAIN,immutable.bytes,sizeof(immutable.bytes),index,sizeof(index),&immutable.value)==F7_INVALID);
 assert(immutable.value==888);
 assert(original[0]=='{'&&original[1]=='}');
}
static void witness_records(void){
 struct f7_witness_expectation expected={0};struct f7_witness_view view;
 uint8_t record[F7_WITNESS_BYTES+32]={0},raw[3]={0,255,7};
 expected.invocation[0]=1;expected.attempt[0]=2;expected.lifetime[0]=3;
 expected.pipe_key[F7_STDOUT][0]=4;expected.role=F7_O;
 memcpy(record,"SLF7WIT1",8);memcpy(record+8,expected.invocation,16);
 memcpy(record+24,expected.attempt,32);memcpy(record+56,expected.lifetime,16);
 memcpy(record+72,expected.pipe_key[F7_STDOUT],16);
 f7_u64be(record+88,1);f7_u64be(record+96,1);record[105]=F7_READ;record[109]=F7_O;
 f7_u64be(record+112,3);f7_u64be(record+120,3);
 memcpy(record+144,expected.invocation,8);f7_u64be(record+152,1);
 crypto_hash_sha256(record+F7_WITNESS_BYTES,raw,sizeof(raw));
 record[107]=1;assert(f7_witness_validate(&expected,record,sizeof(record),raw,3,&view)==F7_INVALID);
 assert(expected.sequence==0);record[107]=0;raw[2]=8;
 assert(f7_witness_validate(&expected,record,sizeof(record),raw,3,&view)==F7_CONFLICT);
 assert(expected.sequence==0);raw[2]=7;
 assert(f7_witness_validate(&expected,record,sizeof(record),raw,3,&view)==F7_OK);
 assert(expected.sequence==1&&view.returned==3&&!view.inline_bytes);
 assert(f7_witness_validate(&expected,record,sizeof(record),raw,3,&view)==F7_INVALID);
}
static void child_records(void){
 uint8_t bytes[F7_CHILD_FACT_HEADER+3]={0};struct f7_child_exit child;
 f7_u64be(bytes+56,F7_CHILD_INPUT_REJECTED);
 assert(f7_child_exit_decode(bytes,F7_CHILD_FACT_HEADER,&child)==F7_OK);
 f7_u64be(bytes+32,1);assert(f7_child_exit_decode(bytes,F7_CHILD_FACT_HEADER,&child)==F7_INVALID);
 f7_u64be(bytes+32,0);f7_u64be(bytes+56,F7_CHILD_PENDING);f7_u64be(bytes+48,1);
 f7_u64be(bytes+64,3);bytes[F7_CHILD_FACT_HEADER]=255;
 assert(f7_child_exit_decode(bytes,sizeof(bytes),&child)==F7_OK);
 assert(child.native_record_length==3&&child.native_record[0]==255&&!child.observed);
 assert(f7_child_exit_decode(bytes,sizeof(bytes)-1,&child)==F7_INVALID);
 f7_u64be(bytes+40,1);assert(f7_child_exit_decode(bytes,sizeof(bytes),&child)==F7_INVALID);
 f7_u64be(bytes+40,0);f7_u64be(bytes+48,8);
 assert(f7_child_exit_decode(bytes,sizeof(bytes),&child)==F7_INVALID);
}
static void native_graph_storage(void){
 /* Format regression data only, never asserted to be an original OS record,
    PowerShell failure, admitted actor, or one of the nine native rows. */
 uint8_t raw[8]={0,255,0,128,13,10,0,7},saved[8],payload[128];
 struct f7_error_node nodes[2]={0};uint32_t secondary[2]={2,2};
 memcpy(saved,raw,sizeof(raw));
 for(unsigned i=0;i<2;i++){
  nodes[i].kind=F7_GRAPH_NATIVE;nodes[i].cause_kind=F7_CAUSE_REFERENCE;
  nodes[i].cause=i?1:2;nodes[i].name.state=F7_TEXT_ABSENT;
  nodes[i].message.state=F7_TEXT_ABSENT;nodes[i].stack.state=F7_TEXT_ABSENT;
  nodes[i].original_native=raw;nodes[i].original_native_length=sizeof(raw);
 }
 struct f7_error_graph graph={nodes,2,1,secondary,2};size_t length=777;
 assert(f7_error_graph_encode(&graph,raw,sizeof(raw),&length)==F7_CONFLICT);
 assert(length==777&&!memcmp(raw,saved,sizeof(raw)));
 assert(f7_error_graph_encode(&graph,payload,sizeof(payload),&length)==F7_OK);
 assert(length==112&&f7_error_graph_validate(payload,length,2)==F7_OK);
 assert(payload[27]==2&&payload[31]==2&&payload[43]==2&&payload[83]==1);
 assert(!memcmp(payload+64,raw,sizeof(raw))&&!memcmp(payload+104,raw,sizeof(raw)));
 assert(!memcmp(raw,saved,sizeof(raw)));
 /* A result-length write must not erase an original graph reference field. */
 assert(f7_error_graph_output_validate(&graph,secondary,sizeof(secondary))==F7_CONFLICT);
 assert(secondary[0]==2&&secondary[1]==2);
}
static void manifest_decode_lifetime(void){
 struct f7_decoded_member members[1];struct f7_manifest_segment segments[1];
 struct f7_decoded_manifest decoded={0};const uint8_t malformed[]={'{'};
 decoded.members=members;decoded.member_capacity=1;decoded.segments=segments;decoded.segment_capacity=1;
 assert(f7_decode_manifest((const uint8_t *)&decoded,sizeof(decoded),&decoded)==F7_CONFLICT);
 assert(!decoded.parse_started&&!decoded.member_count&&!decoded.segment_count);
 assert(f7_decode_manifest(malformed,sizeof(malformed),&decoded)==F7_INVALID);
 assert(decoded.parse_started&&!decoded.member_count&&!decoded.segment_count);
 assert(f7_decode_manifest(malformed,sizeof(malformed),&decoded)==F7_CONFLICT);
 assert(decoded.parse_started&&!decoded.member_count&&!decoded.segment_count);
}
static void recovery_absent_before_effect(void){
 /* Missing original source data must reject before reading any native handle.
    This is not a fixture, worker invocation or authenticated SAME successor. */
 struct f7_retained_object object={0};struct f7_member member={0};
 struct f7_attempt_journal journal={0};struct f7_journal_entry entry[1];
 struct f7_index_object decoded[1];struct f7_recovery_inventory inventory={0};
 uint8_t index[1],canonical[1],hash[1],signature_workspace[1];int64_t native=777;
 journal.member=&member;journal.entries=entry;journal.capacity=1;
 inventory.objects=&object;inventory.count=1;inventory.parsed_journal=&journal;
 inventory.decoded_objects=decoded;inventory.decoded_capacity=1;
 inventory.index_bytes=index;inventory.index_capacity=1;inventory.index.length=1;
 inventory.canonical_scratch=canonical;inventory.canonical_capacity=1;
 inventory.hash_scratch=hash;inventory.hash_capacity=1;
 inventory.signature_workspace=signature_workspace;inventory.signature_workspace_capacity=1;
 inventory.signature.length=crypto_sign_BYTES;
 assert(f7_recovery_validate_persistent(&inventory,&native)==F7_AUTH_FAILURE);
 assert(native==777&&!journal.parse_started&&!journal.count);
 struct f7_recovery_job *job=NULL;struct f7_recovery_job_memory memory={0};uint8_t state[1];
 memory.state=state;memory.state_bytes=1;
 assert(f7_recovery_job_input_geometry(&job,&inventory,&memory,&native)==F7_AUTH_FAILURE);
 assert(!job&&native==777&&!journal.parse_started&&!journal.count);
}
int main(void){framing();budgets();states();index_records();error_records();unknown_creation();segment_records();error_graphs();signature_buffers();witness_records();child_records();native_graph_storage();manifest_decode_lifetime();recovery_absent_before_effect();return 0;}
