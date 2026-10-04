/* Source-authored native regression. UNEXECUTED: entire U1 source GO and NEW
   complete exact ROOT are prerequisites; this file is not a native receipt. */
#include "protocol.h"
#include "budget-reservation.h"
#include "public-projection.h"
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
int main(void){framing();budgets();states();return 0;}
