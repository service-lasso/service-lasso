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
 out->wait_result=status;
 if(status<0){out->native_error=errno;out->disposition=F7_CHILD_NATIVE_FAILURE;return F7_NATIVE_FAILURE;}
 if(!info.si_pid){out->disposition=F7_CHILD_PENDING;return F7_INCOMPLETE;}
 if(info.si_code!=CLD_EXITED&&info.si_code!=CLD_KILLED&&info.si_code!=CLD_DUMPED){out->disposition=F7_CHILD_UNAVAILABLE;return F7_INCOMPLETE;}
 out->native_pid=(uint64_t)info.si_pid;out->exit_status=info.si_status;
 out->exit_kind=info.si_code;out->observed=1;out->disposition=F7_CHILD_OBSERVED;return F7_OK;
}
#endif
