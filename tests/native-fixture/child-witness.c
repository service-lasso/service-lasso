#include "child-witness.h"
int f7_child_exit_record(struct f7_witness_sink *sink,const struct f7_child_exit *exit){
 uint8_t bytes[64];
 if(!sink||!exit)return F7_INVALID;
 f7_u64be(bytes,exit->native_pid);f7_u64be(bytes+8,(uint64_t)exit->wait_result);
 f7_u64be(bytes+16,(uint64_t)exit->exit_status);f7_u64be(bytes+24,(uint64_t)exit->exit_kind);
 f7_u64be(bytes+32,(uint64_t)exit->native_error);f7_u64be(bytes+40,(uint64_t)exit->observed);
 f7_u64be(bytes+48,exit->native_calls);f7_u64be(bytes+56,(uint64_t)exit->disposition);
 /* Child native facts are inline witness payload, retained byte-for-byte;
    raw stdout/stderr/error witnesses instead reference their raw members. */
 enum f7_event event=exit->observed?F7_CHILD_EXIT:
   (exit->disposition==F7_CHILD_PENDING?F7_CHILD_WAIT_PENDING:F7_UNAVAILABLE);
 return f7_witness_emit(sink,F7_CONTROL,event,
 sizeof(bytes),sizeof(bytes),0,bytes,exit->native_error,1);
}
