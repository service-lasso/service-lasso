#include "child-witness.h"
#include <string.h>
static uint64_t unsigned_value(const uint8_t *bytes){
 uint64_t n=0;for(unsigned i=0;i<8;i++)n=(n<<8)|bytes[i];return n;
}
static int64_t signed_value(const uint8_t *bytes){
 uint64_t n=unsigned_value(bytes);return n<=INT64_MAX?(int64_t)n:-1-(int64_t)(UINT64_MAX-n);
}
int f7_child_exit_decode(const uint8_t *bytes,size_t length,struct f7_child_exit *out){
 struct f7_child_exit value;uint64_t raw_length,observed,disposition;
 if(!bytes||!out||length<F7_CHILD_FACT_HEADER||
    length>F7_CHILD_FACT_HEADER+F7_CHILD_NATIVE_MAX)return F7_INVALID;
 raw_length=unsigned_value(bytes+64);observed=unsigned_value(bytes+40);
 disposition=unsigned_value(bytes+56);
 if(raw_length>F7_CHILD_NATIVE_MAX||length!=F7_CHILD_FACT_HEADER+raw_length||
    observed>1||disposition<F7_CHILD_INPUT_REJECTED||disposition>F7_CHILD_UNAVAILABLE)return F7_INVALID;
 memset(&value,0,sizeof(value));value.native_pid=unsigned_value(bytes);
 value.wait_result=signed_value(bytes+8);value.exit_status=signed_value(bytes+16);
 value.exit_kind=signed_value(bytes+24);value.native_error=signed_value(bytes+32);
 value.observed=(int)observed;value.native_calls=unsigned_value(bytes+48);
 value.disposition=(enum f7_child_disposition)disposition;
 if(value.native_calls&~UINT64_C(7))return F7_INVALID;
 if(value.disposition==F7_CHILD_INPUT_REJECTED){
  if(value.native_calls||observed||raw_length||value.native_error||value.native_pid||
     value.wait_result||value.exit_status||value.exit_kind)return F7_INVALID;
 }else if(!value.native_calls)return F7_INVALID;
 if(observed!=(disposition==F7_CHILD_OBSERVED)||
    (observed&&(!value.native_pid||value.native_error)))return F7_INVALID;
 value.native_record_length=(size_t)raw_length;
 memcpy(value.native_record,bytes+F7_CHILD_FACT_HEADER,(size_t)raw_length);
 *out=value;return F7_OK;
}
int f7_child_exit_record(struct f7_witness_sink *sink,const struct f7_child_exit *exit){
 uint8_t bytes[F7_CHILD_FACT_HEADER+F7_CHILD_NATIVE_MAX];
 if(!sink||!exit||exit->native_record_length>F7_CHILD_NATIVE_MAX)return F7_INVALID;
 f7_u64be(bytes,exit->native_pid);f7_u64be(bytes+8,(uint64_t)exit->wait_result);
 f7_u64be(bytes+16,(uint64_t)exit->exit_status);f7_u64be(bytes+24,(uint64_t)exit->exit_kind);
 f7_u64be(bytes+32,(uint64_t)exit->native_error);f7_u64be(bytes+40,(uint64_t)exit->observed);
 f7_u64be(bytes+48,exit->native_calls);f7_u64be(bytes+56,(uint64_t)exit->disposition);
 f7_u64be(bytes+64,exit->native_record_length);
 memcpy(bytes+F7_CHILD_FACT_HEADER,exit->native_record,exit->native_record_length);
 /* Child native facts are inline witness payload, retained byte-for-byte;
    raw stdout/stderr/error witnesses instead reference their raw members. */
 enum f7_event event=exit->observed?F7_CHILD_EXIT:
   (exit->disposition==F7_CHILD_PENDING?F7_CHILD_WAIT_PENDING:F7_UNAVAILABLE);
 return f7_witness_emit(sink,F7_CONTROL,event,
 F7_CHILD_FACT_HEADER+exit->native_record_length,
 F7_CHILD_FACT_HEADER+exit->native_record_length,0,bytes,exit->native_error,1);
}
