#include "child-witness.h"
#ifdef _WIN32
#include <string.h>
extern "C" int f7_child_exit_windows(f7_handle process,struct f7_child_exit *out){
 DWORD status,code;
 if(!out)return F7_INVALID;
 memset(out,0,sizeof(*out));
 if(!process||process==INVALID_HANDLE_VALUE){out->disposition=F7_CHILD_INPUT_REJECTED;return F7_INVALID;}
 out->native_calls=1;status=WaitForSingleObject(process,0);
 out->wait_result=status;
 if(status==WAIT_TIMEOUT){out->disposition=F7_CHILD_PENDING;return F7_INCOMPLETE;}
 if(status!=WAIT_OBJECT_0){out->native_error=status==WAIT_FAILED?GetLastError():0;out->disposition=F7_CHILD_NATIVE_FAILURE;return F7_NATIVE_FAILURE;}
 /* A signaled held process is actual termination. STILL_ACTIVE as an exit
    CODE is not used as a lifetime test; it can be an actual process exit code. */
 out->native_calls|=2;
 if(!GetExitCodeProcess(process,&code)){out->native_error=GetLastError();out->disposition=F7_CHILD_NATIVE_FAILURE;return F7_NATIVE_FAILURE;}
 out->exit_status=code;out->exit_kind=1;out->native_calls|=4;
 out->native_pid=GetProcessId(process);
 if(!out->native_pid){out->native_error=GetLastError();out->disposition=F7_CHILD_NATIVE_FAILURE;return F7_NATIVE_FAILURE;}
 out->observed=1;out->disposition=F7_CHILD_OBSERVED;return F7_OK;
}
#endif
