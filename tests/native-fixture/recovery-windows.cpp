#include "recovery.h"
#ifdef _WIN32
#include <stdlib.h>
#include <errno.h>
struct f7_recovery_job {
 struct f7_recovery_inventory *inventory;
 HANDLE worker;CRITICAL_SECTION lock;
 struct f7_recovery_job_status status;
};
static DWORD WINAPI validate(LPVOID value){
 f7_recovery_job *job=(f7_recovery_job *)value;int64_t native=0;
 int result=f7_recovery_validate_persistent(job->inventory,&native);
 EnterCriticalSection(&job->lock);job->status.result=result;job->status.native_status=native;
 job->status.finished=1;LeaveCriticalSection(&job->lock);return 0;
}
extern "C" int f7_recovery_job_start(struct f7_recovery_job **out,
 struct f7_recovery_inventory *inventory,size_t stack_bytes,int64_t *native){
 if(!out||!inventory||!native||!stack_bytes)return F7_INVALID;
 *out=NULL;*native=0;f7_recovery_job *job=(f7_recovery_job *)calloc(1,sizeof(*job));
 if(!job){*native=errno;return F7_NATIVE_FAILURE;}
 job->inventory=inventory;job->status.result=F7_INCOMPLETE;
 if(!InitializeCriticalSectionEx(&job->lock,0,0)){
  *native=GetLastError();free(job);return F7_NATIVE_FAILURE;}
 job->worker=CreateThread(NULL,stack_bytes,validate,job,STACK_SIZE_PARAM_IS_A_RESERVATION,NULL);
 if(!job->worker){*native=GetLastError();DeleteCriticalSection(&job->lock);free(job);return F7_NATIVE_FAILURE;}
 *out=job;return F7_OK;
}
extern "C" int f7_recovery_job_poll(struct f7_recovery_job *job,struct f7_recovery_job_status *out){
 if(!job||!out)return F7_INVALID;
 if(!TryEnterCriticalSection(&job->lock))return F7_INCOMPLETE;
 *out=job->status;LeaveCriticalSection(&job->lock);return F7_OK;
}
extern "C" int f7_recovery_job_release_exited(struct f7_recovery_job *job,int64_t *native){
 if(!job||!native)return F7_INVALID;
 *native=0;DWORD result=WaitForSingleObject(job->worker,0);
 if(result!=WAIT_OBJECT_0){
  if(result==WAIT_FAILED){*native=GetLastError();return F7_NATIVE_FAILURE;}
  return F7_INCOMPLETE;
 }
 if(!CloseHandle(job->worker)){*native=GetLastError();return F7_NATIVE_FAILURE;}
 DeleteCriticalSection(&job->lock);free(job);return F7_OK;
}
#endif
