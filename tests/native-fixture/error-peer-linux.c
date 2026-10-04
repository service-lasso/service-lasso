#define _GNU_SOURCE
#include "error-peer-linux.h"
#ifndef _WIN32
#include <sys/socket.h>
#include <sys/un.h>
#include <sys/stat.h>
#include <fcntl.h>
#include <unistd.h>
#include <errno.h>
#include <limits.h>
#include <string.h>
static int query(const struct f7_linux_error_peer *peer,struct f7_linux_receive_fact *fact){
 int type=0,passcred=0;socklen_t length=sizeof(type);struct sockaddr_un address;
 struct ucred original;memset(&original,0,sizeof(original));
 struct stat st;memset(&st,0,sizeof(st));fact->native_queries|=16;
 int result=fstat(peer->socket,&st);int error=result<0?errno:0;fact->object_query_return=result;
 if(result<0){fact->native_error=error;return F7_NATIVE_FAILURE;}
 f7_u64be(fact->actual_object,(uint64_t)st.st_dev);f7_u64be(fact->actual_object+8,(uint64_t)st.st_ino);
 f7_u64be(fact->actual_object+16,(uint64_t)st.st_mode);
 if(!S_ISSOCK(st.st_mode)||memcmp(fact->actual_object,peer->original_object,24))return F7_IDENTITY_MISMATCH;
 memset(&st,0,sizeof(st));fact->native_queries|=32;
 result=fstat(peer->original_object_reference,&st);error=result<0?errno:0;fact->reference_query_return=result;
 if(result<0){fact->native_error=error;return F7_NATIVE_FAILURE;}
 f7_u64be(fact->reference_object,(uint64_t)st.st_dev);f7_u64be(fact->reference_object+8,(uint64_t)st.st_ino);
 f7_u64be(fact->reference_object+16,(uint64_t)st.st_mode);
 if(memcmp(fact->reference_object,peer->original_object,24))return F7_IDENTITY_MISMATCH;
 fact->native_queries|=64;result=fcntl(peer->socket,F_GETFD);error=result<0?errno:0;
 fact->flags_query_return=result;fact->descriptor_flags=result;
 if(result<0){fact->native_error=error;return F7_NATIVE_FAILURE;}
 if(!(result&FD_CLOEXEC))return F7_AUTH_FAILURE;
 fact->native_queries|=1;
 if(getsockopt(peer->socket,SOL_SOCKET,SO_TYPE,&type,&length)<0){fact->native_error=errno;return F7_NATIVE_FAILURE;}
 fact->socket_type=type;
 if(length!=sizeof(type)||type!=SOCK_SEQPACKET)return F7_INVALID;
 length=sizeof(address);memset(&address,0,sizeof(address));
 fact->native_queries|=2;
 if(getsockname(peer->socket,(struct sockaddr *)&address,&length)<0){fact->native_error=errno;return F7_NATIVE_FAILURE;}
 fact->socket_family=address.sun_family;
 if(length<sizeof(address.sun_family)||address.sun_family!=AF_UNIX)return F7_INVALID;
 length=sizeof(passcred);
 fact->native_queries|=4;
 if(getsockopt(peer->socket,SOL_SOCKET,SO_PASSCRED,&passcred,&length)<0){fact->native_error=errno;return F7_NATIVE_FAILURE;}
 fact->passcred=passcred;
 if(length!=sizeof(passcred)||passcred!=1)return F7_AUTH_FAILURE;
 length=sizeof(original);
 fact->native_queries|=8;
 if(getsockopt(peer->socket,SOL_SOCKET,SO_PEERCRED,&original,&length)<0){fact->native_error=errno;return F7_NATIVE_FAILURE;}
 fact->connected_pid=original.pid;fact->connected_uid=original.uid;fact->connected_gid=original.gid;
 if(length!=sizeof(original)||original.pid!=peer->original_connected_pid||
    original.uid!=peer->original_connected_uid||original.gid!=peer->original_connected_gid)return F7_AUTH_FAILURE;
 return F7_OK;
}
int f7_linux_error_peer_receive(const struct f7_linux_error_peer *peer,
 uint8_t *body,size_t capacity,uint8_t *control,size_t control_capacity,
 struct f7_linux_receive_fact *fact){
 if(!fact||!peer)return F7_INVALID;
 if(peer->socket<0||peer->original_object_reference<0||peer->original_pid<=0||peer->original_pid>INT_MAX||
    peer->original_connected_pid<=0||peer->original_connected_pid>INT_MAX||
    peer->original_connected_uid>UINT_MAX||peer->original_connected_gid>UINT_MAX||
    peer->original_uid>UINT_MAX||peer->original_gid>UINT_MAX||!body||!control||
    !capacity||capacity>F7_FRAME_HEADER_SIZE+F7_FRAME_MAX||
    control_capacity<CMSG_SPACE(sizeof(struct ucred))||control_capacity>F7_FRAME_MAX||
    (uintptr_t)control%_Alignof(struct cmsghdr)||
    capacity>UINTPTR_MAX-(uintptr_t)body||control_capacity>UINTPTR_MAX-(uintptr_t)control||
    !((uintptr_t)body+capacity<=(uintptr_t)control||
      (uintptr_t)control+control_capacity<=(uintptr_t)body))return F7_INVALID;
 struct span {uintptr_t address;size_t length;};
 struct span spans[]={{(uintptr_t)peer,sizeof(*peer)},{(uintptr_t)fact,sizeof(*fact)},
  {(uintptr_t)body,capacity},{(uintptr_t)control,control_capacity}};
 for(size_t i=0;i<4;i++){
  if(spans[i].length>UINTPTR_MAX-spans[i].address)return F7_INVALID;
  for(size_t j=0;j<i;j++)if(!(spans[i].address+spans[i].length<=spans[j].address||
   spans[j].address+spans[j].length<=spans[i].address))return F7_INVALID;
 }
 memset(fact,0,sizeof(*fact));
 int result=query(peer,fact);if(result)return result;
 /* No blocking receive and no ambient child/socket discovery. Caller reserves
    complete body/control storage before any original producer can initialize. */
 struct iovec iov={body,capacity};struct msghdr message;
 memset(&message,0,sizeof(message));memset(control,0,control_capacity);
 message.msg_iov=&iov;message.msg_iovlen=1;message.msg_control=control;
 message.msg_controllen=control_capacity;
 ssize_t returned=recvmsg(peer->socket,&message,MSG_DONTWAIT|MSG_CMSG_CLOEXEC);
 int actual_error=returned<0?errno:0;fact->native_called=1;
 fact->returned=returned;fact->native_error=actual_error;
 fact->message_flags=(uint64_t)(unsigned)message.msg_flags;
 fact->control_length=message.msg_controllen;
 if(returned<0)return actual_error==EAGAIN||actual_error==EWOULDBLOCK||actual_error==EINTR?F7_INCOMPLETE:F7_NATIVE_FAILURE;
 if(message.msg_controllen>control_capacity)return F7_INCOMPLETE;
 int unknown=0;
 for(struct cmsghdr *header=CMSG_FIRSTHDR(&message);header;header=CMSG_NXTHDR(&message,header)){
  size_t offset=(size_t)((uint8_t *)header-control);
  if(offset>message.msg_controllen||header->cmsg_len<CMSG_LEN(0)||
     header->cmsg_len>message.msg_controllen-offset){unknown=1;break;}
  if(header->cmsg_level!=SOL_SOCKET||header->cmsg_type!=SCM_CREDENTIALS||
     header->cmsg_len!=CMSG_LEN(sizeof(struct ucred))){unknown=1;continue;}
  struct ucred credentials;memcpy(&credentials,CMSG_DATA(header),sizeof(credentials));
  fact->credentials_count++;fact->actual_pid=credentials.pid;
  fact->actual_uid=credentials.uid;fact->actual_gid=credentials.gid;
 }
 if(message.msg_flags&(MSG_TRUNC|MSG_CTRUNC))return F7_INCOMPLETE;
 if((size_t)returned>capacity||
    (message.msg_flags&~(MSG_EOR|MSG_CMSG_CLOEXEC)))return F7_INCOMPLETE;
 if(unknown||fact->credentials_count!=1||fact->actual_pid!=peer->original_pid||
    fact->actual_uid!=peer->original_uid||fact->actual_gid!=peer->original_gid)return F7_AUTH_FAILURE;
 /* Zero returned bytes are preserved as a receive fact, not inferred pipe EOF.
    Original child wait, producer closure and framing remain distinct proofs. */
 return returned?F7_OK:F7_INCOMPLETE;
}
#endif
