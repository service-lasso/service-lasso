#define _GNU_SOURCE
#include "recovery.h"
#ifndef _WIN32
#include <pthread.h>
#include <stdlib.h>
#include <errno.h>
struct f7_recovery_job {
 struct f7_recovery_inventory *inventory;
 pthread_t worker;pthread_mutex_t lock;
 int joined;
 struct f7_recovery_job_status status;
};
static void *validate(void *value){
 struct f7_recovery_job *job=value;int64_t native=0;
 int result=f7_recovery_validate_persistent(job->inventory,&native);
 pthread_mutex_lock(&job->lock);job->status.result=result;job->status.native_status=native;
 job->status.finished=1;pthread_mutex_unlock(&job->lock);return NULL;
}
int f7_recovery_job_start(struct f7_recovery_job **out,
 struct f7_recovery_inventory *inventory,size_t stack_bytes,int64_t *native){
 if(!out||!inventory||!native||!stack_bytes)return F7_INVALID;
 *out=NULL;*native=0;struct f7_recovery_job *job=calloc(1,sizeof(*job));
 if(!job){*native=errno;return F7_NATIVE_FAILURE;}
 job->inventory=inventory;job->status.result=F7_INCOMPLETE;
 int result=pthread_mutex_init(&job->lock,NULL);
 if(result){*native=result;free(job);return F7_NATIVE_FAILURE;}
 pthread_attr_t attributes;result=pthread_attr_init(&attributes);
 if(result){*native=result;pthread_mutex_destroy(&job->lock);free(job);return F7_NATIVE_FAILURE;}
 result=pthread_attr_setstacksize(&attributes,stack_bytes);
 if(!result)result=pthread_create(&job->worker,&attributes,validate,job);
 pthread_attr_destroy(&attributes);
 if(result){*native=result;pthread_mutex_destroy(&job->lock);free(job);return F7_NATIVE_FAILURE;}
 *out=job;return F7_OK;
}
int f7_recovery_job_poll(struct f7_recovery_job *job,struct f7_recovery_job_status *out){
 if(!job||!out)return F7_INVALID;
 int result=pthread_mutex_trylock(&job->lock);
 if(result){out->finished=0;out->result=F7_INCOMPLETE;out->native_status=result;
  return result==EBUSY?F7_INCOMPLETE:F7_NATIVE_FAILURE;}
 *out=job->status;pthread_mutex_unlock(&job->lock);return F7_OK;
}
int f7_recovery_job_release_exited(struct f7_recovery_job *job,int64_t *native){
 if(!job||!native)return F7_INVALID;
 *native=0;int result=0;
 if(!job->joined){result=pthread_tryjoin_np(job->worker,NULL);
  if(result){*native=result;return result==EBUSY?F7_INCOMPLETE:F7_NATIVE_FAILURE;}
  job->joined=1;
 }
 result=pthread_mutex_destroy(&job->lock);
 if(result){*native=result;return F7_NATIVE_FAILURE;}
 free(job);return F7_OK;
}
#endif
