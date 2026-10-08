#define _GNU_SOURCE
#include "error-producer-endpoint.h"
#include <string.h>
static int fact_storage(const struct f7_error_endpoint *endpoint,const uint8_t *bytes,
 size_t length,const struct f7_producer_native_fact *fact){
 uintptr_t output=(uintptr_t)fact,source=(uintptr_t)bytes,binding=(uintptr_t)endpoint;
 if(sizeof(*fact)>UINTPTR_MAX-output||length>UINTPTR_MAX-source||
    sizeof(*endpoint)>UINTPTR_MAX-binding)return F7_INVALID;
 if(!((output+sizeof(*fact)<=source||source+length<=output)&&
      (output+sizeof(*fact)<=binding||binding+sizeof(*endpoint)<=output)))return F7_CONFLICT;
 return F7_OK;
}
int f7_error_endpoint_call(struct f7_producer_native_fact *fact,uint64_t operation,
 uint64_t argument,int64_t result,int64_t error){
 if(!fact||fact->count>=F7_PRODUCER_NATIVE_CALLS){if(fact)fact->exhausted=1;return F7_OVERFLOWED;}
 fact->calls[fact->count++]=(struct f7_producer_native_call){operation,argument,result,error};return F7_OK;
}
#ifndef _WIN32
#include <sys/socket.h>
#include <sys/stat.h>
#include <poll.h>
#include <fcntl.h>
#include <unistd.h>
#include <errno.h>
#include <limits.h>
static int original(const struct f7_error_endpoint *endpoint,struct f7_producer_native_fact *fact){
 struct stat st,reference;struct ucred peer;int type=0;socklen_t size=sizeof(type);uint8_t object[24];
 if(fact->count>F7_PRODUCER_NATIVE_CALLS-6){fact->exhausted=1;return F7_OVERFLOWED;}
 memset(&st,0,sizeof(st));int result=fstat(endpoint->write,&st);int error=result<0?errno:0;
 f7_error_endpoint_call(fact,1,0,result,error);if(result<0)return F7_NATIVE_FAILURE;
 f7_u64be(object,(uint64_t)st.st_dev);f7_u64be(object+8,(uint64_t)st.st_ino);f7_u64be(object+16,(uint64_t)st.st_mode);
 if(!S_ISSOCK(st.st_mode)||memcmp(object,endpoint->original_object,24))return F7_IDENTITY_MISMATCH;
 memset(&reference,0,sizeof(reference));result=fstat(endpoint->original_object_reference,&reference);error=result<0?errno:0;
 f7_error_endpoint_call(fact,22,0,result,error);if(result<0)return F7_NATIVE_FAILURE;
 if(reference.st_dev!=st.st_dev||reference.st_ino!=st.st_ino||reference.st_mode!=st.st_mode)return F7_IDENTITY_MISMATCH;
 result=fcntl(endpoint->write,F_GETFD);error=result<0?errno:0;f7_error_endpoint_call(fact,2,F_GETFD,result,error);
 if(result<0)return F7_NATIVE_FAILURE;if(!(result&FD_CLOEXEC))return F7_AUTH_FAILURE;
 result=getsockopt(endpoint->write,SOL_SOCKET,SO_TYPE,&type,&size);error=result<0?errno:0;
 f7_error_endpoint_call(fact,3,(uint64_t)type,result,error);if(result<0)return F7_NATIVE_FAILURE;
 if(size!=sizeof(type)||type!=SOCK_SEQPACKET)return F7_INVALID;
 size=sizeof(peer);memset(&peer,0,sizeof(peer));
 result=getsockopt(endpoint->write,SOL_SOCKET,SO_PEERCRED,&peer,&size);error=result<0?errno:0;
 f7_error_endpoint_call(fact,4,(uint64_t)(peer.pid>0?peer.pid:0),result,error);if(result<0)return F7_NATIVE_FAILURE;
 if(size!=sizeof(peer)||peer.pid!=endpoint->original_peer_pid||peer.uid!=endpoint->original_peer_uid||
    peer.gid!=endpoint->original_peer_gid)return F7_AUTH_FAILURE;
 struct pollfd held={endpoint->original_peer,POLLIN,0};result=poll(&held,1,0);error=result<0?errno:0;
 f7_error_endpoint_call(fact,5,(uint64_t)(unsigned short)held.revents,result,error);
 if(result<0)return F7_NATIVE_FAILURE;
 /* The ORIGINAL admitted pidfd binding comes from ROOT custody. Poll flags
    cannot bind a caller PID to this held process or create source authority. */
 return result==0?F7_OK:F7_INCOMPLETE;
}
int f7_error_endpoint_write(const struct f7_error_endpoint *endpoint,
 const uint8_t *bytes,size_t length,struct f7_producer_native_fact *fact){
 if(!endpoint||!bytes||!length||length>F7_FRAME_MAX||!fact||endpoint->kind!=F7_LINUX_ERROR_SOCKET||
    endpoint->write<0||endpoint->original_peer<0||endpoint->original_object_reference<0||endpoint->original_peer_pid<=0||
    endpoint->original_peer_pid>INT_MAX||endpoint->original_peer_uid>UINT_MAX||endpoint->original_peer_gid>UINT_MAX)return F7_INVALID;
 int result=fact_storage(endpoint,bytes,length,fact);if(result)return result;
 memset(fact,0,sizeof(*fact));result=original(endpoint,fact);if(result)return result;
 ssize_t sent=send(endpoint->write,bytes,length,MSG_DONTWAIT|MSG_NOSIGNAL);int error=sent<0?errno:0;
 f7_error_endpoint_call(fact,6,length,sent,error);if(sent>0)fact->transferred=(uint64_t)sent;
 if(sent<0)return F7_NATIVE_FAILURE;
 if((size_t)sent!=length)return F7_INCOMPLETE;
 return original(endpoint,fact);
}
#else
static int original(const struct f7_error_endpoint *endpoint,struct f7_producer_native_fact *fact){
 if(fact->count>F7_PRODUCER_NATIVE_CALLS-5){fact->exhausted=1;return F7_OVERFLOWED;}
 SetLastError(ERROR_SUCCESS);
 BOOL comparison=CompareObjectHandles(endpoint->write,endpoint->original_object_reference);
 DWORD comparison_error=comparison?0:GetLastError();
 f7_error_endpoint_call(fact,12,0,comparison,comparison_error);
 if(!comparison)return F7_IDENTITY_MISMATCH;
 SetLastError(ERROR_SUCCESS);
 DWORD type=GetFileType(endpoint->write);DWORD error=type==FILE_TYPE_UNKNOWN?GetLastError():0;
 f7_error_endpoint_call(fact,7,0,type,error);if(type==FILE_TYPE_UNKNOWN&&error)return F7_NATIVE_FAILURE;
 if(type!=FILE_TYPE_PIPE)return F7_INVALID;
 DWORD wait=WaitForSingleObject(endpoint->original_peer,0);error=wait==WAIT_FAILED?GetLastError():0;
 f7_error_endpoint_call(fact,8,0,wait,error);if(wait==WAIT_FAILED)return F7_NATIVE_FAILURE;
 if(wait!=WAIT_TIMEOUT)return F7_INCOMPLETE;
 DWORD held_pid=GetProcessId(endpoint->original_peer);error=held_pid?0:GetLastError();
 f7_error_endpoint_call(fact,9,0,held_pid,error);if(!held_pid)return F7_NATIVE_FAILURE;
 ULONG peer_pid=0;BOOL queried=GetNamedPipeServerProcessId(endpoint->write,&peer_pid);error=queried?0:GetLastError();
 f7_error_endpoint_call(fact,10,peer_pid,queried,error);if(!queried)return F7_NATIVE_FAILURE;
 if(held_pid!=(DWORD)endpoint->original_peer_pid||peer_pid!=held_pid)return F7_AUTH_FAILURE;
 /* Original pipe object, DACL/token/birth and endpoint-side proof require
    the independently admitted ROOT custody record, never a pipe name/PID. */
 return F7_OK;
}
int f7_error_endpoint_write(const struct f7_error_endpoint *endpoint,
 const uint8_t *bytes,size_t length,struct f7_producer_native_fact *fact){
 if(!endpoint||!bytes||!length||length>F7_FRAME_MAX||!fact||endpoint->kind!=F7_WINDOWS_ERROR_PIPE||
    !endpoint->write||endpoint->write==INVALID_HANDLE_VALUE||!endpoint->original_peer||
    endpoint->original_peer==INVALID_HANDLE_VALUE||!endpoint->original_object_reference||
    endpoint->original_object_reference==INVALID_HANDLE_VALUE||endpoint->original_peer_pid<=0||endpoint->original_peer_pid>MAXDWORD)return F7_INVALID;
 int result=fact_storage(endpoint,bytes,length,fact);if(result)return result;
 memset(fact,0,sizeof(*fact));result=original(endpoint,fact);if(result)return result;
 while(fact->transferred<length){
  if(fact->count==F7_PRODUCER_NATIVE_CALLS){fact->exhausted=1;return F7_OVERFLOWED;}
  DWORD written=0;DWORD requested=(DWORD)(length-fact->transferred);
  BOOL success=WriteFile(endpoint->write,bytes+(size_t)fact->transferred,requested,&written,NULL);
  DWORD error=success?0:GetLastError();
  /* Native BOOL and raw DWORD output remain distinct. A failed API's output
     is retained, never promoted to a known delivered prefix. */
  f7_error_endpoint_call(fact,11,((uint64_t)requested<<32)|written,success,error);
  if(written>requested)return F7_INCOMPLETE;
  if(!success)return F7_NATIVE_FAILURE;fact->transferred+=written;if(!written)return F7_INCOMPLETE;
 }
 return original(endpoint,fact);
}
#endif
