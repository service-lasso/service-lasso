#include "recovery.h"
#ifdef _WIN32
#include <string.h>
#include "error-producer-endpoint.h"
struct f7_recovery_job {
 struct f7_recovery_inventory *inventory;
 HANDLE worker;CRITICAL_SECTION lock;
 int lock_ready,released;
 struct f7_recovery_job_status status;
};
extern "C" size_t f7_recovery_job_state_bytes(void){return sizeof(f7_recovery_job);}
static DWORD WINAPI validate(LPVOID value){
 f7_recovery_job *job=(f7_recovery_job *)value;int64_t native=0;
 int result=f7_recovery_validate_persistent(job->inventory,&native);
 EnterCriticalSection(&job->lock);job->status.result=result;job->status.native_status=native;
 job->status.finished=1;LeaveCriticalSection(&job->lock);return 0;
}
extern "C" int f7_recovery_job_start(struct f7_recovery_job **out,
 struct f7_recovery_inventory *inventory,const f7_recovery_job_memory *memory,int64_t *native){
 if(!out||!inventory||!native||!memory||!memory->state||memory->state_bytes<sizeof(f7_recovery_job)||
    (uintptr_t)memory->state%alignof(f7_recovery_job)||!memory->stack_bytes)return F7_BUDGET_ABSENT;
 int shaped=f7_recovery_job_input_geometry(out,inventory,memory,native);if(shaped)return shaped;
 *out=(f7_recovery_job *)memory->state;*native=0;f7_recovery_job *job=*out;memset(job,0,sizeof(*job));
 job->inventory=inventory;job->status.result=F7_INCOMPLETE;
 job->status.worker_created=2;
 BOOL initialized=InitializeCriticalSectionEx(&job->lock,0,0);*native=initialized?0:GetLastError();
 f7_error_endpoint_call(&job->status.construction_fact,13,0,initialized,*native);
 if(!initialized){job->status.construction_failed=1;job->status.native_status=*native;return F7_NATIVE_FAILURE;}
 job->lock_ready=1;
 job->worker=CreateThread(NULL,memory->stack_bytes,validate,job,STACK_SIZE_PARAM_IS_A_RESERVATION,NULL);
 *native=job->worker?0:GetLastError();f7_error_endpoint_call(&job->status.construction_fact,14,memory->stack_bytes,job->worker?1:0,*native);
 if(!job->worker){job->status.construction_failed=1;job->status.native_status=*native;return F7_NATIVE_FAILURE;}
 job->status.worker_created=1;return F7_OK;
}
extern "C" int f7_recovery_job_poll(struct f7_recovery_job *job,struct f7_recovery_job_status *out){
 if(!job||!out)return F7_INVALID;
 if(job->released)return F7_INCOMPLETE;
 if(!job->lock_ready){*out=job->status;return F7_OK;}
 if(!TryEnterCriticalSection(&job->lock))return F7_INCOMPLETE;
 *out=job->status;LeaveCriticalSection(&job->lock);return F7_OK;
}
extern "C" int f7_recovery_job_release_exited(struct f7_recovery_job *job,int64_t *native){
 if(!job||!native||job->released)return F7_INVALID;
 if(job->status.worker_created!=1)return F7_INCOMPLETE;
 *native=0;DWORD result=WaitForSingleObject(job->worker,0);
 if(result!=WAIT_OBJECT_0){
  if(result==WAIT_FAILED){*native=GetLastError();return F7_NATIVE_FAILURE;}
  return F7_INCOMPLETE;
 }
 if(!CloseHandle(job->worker)){*native=GetLastError();return F7_NATIVE_FAILURE;}
 job->worker=NULL;DeleteCriticalSection(&job->lock);job->lock_ready=0;job->released=1;return F7_OK;
}
#endif
