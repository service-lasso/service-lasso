#define _GNU_SOURCE
#include "recovery.h"
#ifndef _WIN32
#include <pthread.h>
#include <string.h>
#include "error-producer-endpoint.h"
#include <errno.h>
struct f7_recovery_job {
 struct f7_recovery_inventory *inventory;
 pthread_t worker;pthread_mutex_t lock;
 int joined,lock_ready,released;
 struct f7_recovery_job_status status;
};
size_t f7_recovery_job_state_bytes(void){return sizeof(struct f7_recovery_job);}
static void *validate(void *value){
 struct f7_recovery_job *job=value;int64_t native=0;
 int result=f7_recovery_validate_persistent(job->inventory,&native);
 pthread_mutex_lock(&job->lock);job->status.result=result;job->status.native_status=native;
 job->status.finished=1;pthread_mutex_unlock(&job->lock);return NULL;
}
int f7_recovery_job_start(struct f7_recovery_job **out,
 struct f7_recovery_inventory *inventory,const struct f7_recovery_job_memory *memory,int64_t *native){
 if(!out||!inventory||!native||!memory||!memory->state||memory->state_bytes<sizeof(struct f7_recovery_job)||
    (uintptr_t)memory->state%_Alignof(struct f7_recovery_job)||!memory->stack_bytes||!memory->guard_bytes)return F7_BUDGET_ABSENT;
 int shaped=f7_recovery_job_input_geometry(out,inventory,memory,native);if(shaped)return shaped;
 *out=memory->state;*native=0;struct f7_recovery_job *job=*out;memset(job,0,sizeof(*job));
 job->inventory=inventory;job->status.result=F7_INCOMPLETE;
 job->status.worker_created=2;
 int result=pthread_mutex_init(&job->lock,NULL);
 f7_error_endpoint_call(&job->status.construction_fact,15,0,result,result);
 if(result){*native=result;job->status.construction_failed=1;job->status.native_status=result;return F7_NATIVE_FAILURE;}
 job->lock_ready=1;
 pthread_attr_t attributes;result=pthread_attr_init(&attributes);
 f7_error_endpoint_call(&job->status.construction_fact,17,0,result,result);
 if(result){*native=result;job->status.construction_failed=1;job->status.native_status=result;return F7_NATIVE_FAILURE;}
 result=pthread_attr_setstacksize(&attributes,memory->stack_bytes);
 f7_error_endpoint_call(&job->status.construction_fact,18,memory->stack_bytes,result,result);
 if(!result){result=pthread_attr_setguardsize(&attributes,memory->guard_bytes);
  f7_error_endpoint_call(&job->status.construction_fact,19,memory->guard_bytes,result,result);}
 if(!result){result=pthread_create(&job->worker,&attributes,validate,job);
  f7_error_endpoint_call(&job->status.construction_fact,20,0,result,result);}
 int disposed=pthread_attr_destroy(&attributes);
 f7_error_endpoint_call(&job->status.construction_fact,21,0,disposed,disposed);
 if(!result)job->status.worker_created=1;
 if(result||disposed){*native=result?result:disposed;job->status.construction_failed=1;
  if(job->status.worker_created!=1)job->status.native_status=*native;return F7_NATIVE_FAILURE;}
 return F7_OK;
}
int f7_recovery_job_poll(struct f7_recovery_job *job,struct f7_recovery_job_status *out){
 if(!job||!out)return F7_INVALID;
 if(job->released)return F7_INCOMPLETE;
 if(!job->lock_ready){*out=job->status;return F7_OK;}
 int result=pthread_mutex_trylock(&job->lock);
 if(result){out->finished=0;out->result=F7_INCOMPLETE;out->native_status=result;
  return result==EBUSY?F7_INCOMPLETE:F7_NATIVE_FAILURE;}
 *out=job->status;pthread_mutex_unlock(&job->lock);return F7_OK;
}
int f7_recovery_job_release_exited(struct f7_recovery_job *job,int64_t *native){
 if(!job||!native||job->released)return F7_INVALID;
 if(job->status.worker_created!=1)return F7_INCOMPLETE;
 *native=0;int result=0;
 if(!job->joined){result=pthread_tryjoin_np(job->worker,NULL);
  if(result){*native=result;return result==EBUSY?F7_INCOMPLETE:F7_NATIVE_FAILURE;}
  job->joined=1;
 }
 result=pthread_mutex_destroy(&job->lock);
 if(result){*native=result;return F7_NATIVE_FAILURE;}
 job->lock_ready=0;job->released=1;return F7_OK;
}
#endif
