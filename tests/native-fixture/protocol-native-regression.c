/* Source-authored native regression. UNEXECUTED: entire U1 source GO and NEW
   complete exact ROOT are prerequisites; this file is not a native receipt. */
#include "protocol.h"
#include "budget-reservation.h"
#include "public-projection.h"
#include "canonical-index.h"
#include "error-channel.h"
#include "observer.h"
#include "segment-record.h"
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
 uint8_t record[F7_FRAME_HEADER_SIZE+7]={0};
 channel.role=F7_W;frame.role=F7_W;frame.sequence=1;frame.ordinal=1;
 frame.payload_type=F7_ERROR_GRAPH;frame.payload_length=7;
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
int main(void){framing();budgets();states();index_records();error_records();unknown_creation();segment_records();return 0;}
