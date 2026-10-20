#define _GNU_SOURCE
#include "child-witness.h"
#ifndef _WIN32
#include <sys/wait.h>
#include <errno.h>
#include <string.h>
int f7_child_exit_linux(f7_handle pidfd,struct f7_child_exit *out){
 siginfo_t info;int status;
 if(!out)return F7_INVALID;
 memset(out,0,sizeof(*out));memset(&info,0,sizeof(info));
 if(pidfd<0){out->disposition=F7_CHILD_INPUT_REJECTED;return F7_INVALID;}
 /* P_PIDFD=3 is Linux UAPI. WNOWAIT preserves the exact original wait fact
    for the independent admitted collector/settlement owner. No PID reopen. */
 out->native_calls=1;status=waitid((idtype_t)3,(id_t)pidfd,&info,WEXITED|WNOHANG|WNOWAIT);
 int actual_error=status<0?errno:0;
 _Static_assert(sizeof(info)<=F7_CHILD_NATIVE_MAX,"Original native siginfo requires full reservation");
 memcpy(out->native_record,&info,sizeof(info));out->native_record_length=sizeof(info);
 out->wait_result=status;
 out->native_pid=info.si_pid>0?(uint64_t)info.si_pid:0;
 out->exit_status=info.si_status;out->exit_kind=info.si_code;
 if(status<0){out->native_error=actual_error;out->disposition=F7_CHILD_NATIVE_FAILURE;return F7_NATIVE_FAILURE;}
 if(!info.si_pid){out->disposition=F7_CHILD_PENDING;return F7_INCOMPLETE;}
 if(info.si_code!=CLD_EXITED&&info.si_code!=CLD_KILLED&&info.si_code!=CLD_DUMPED){out->disposition=F7_CHILD_UNAVAILABLE;return F7_INCOMPLETE;}
 out->observed=1;out->disposition=F7_CHILD_OBSERVED;return F7_OK;
}
#endif
