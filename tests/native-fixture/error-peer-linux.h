#ifndef SERVICE_LASSO_F7_ERROR_PEER_LINUX_H
#define SERVICE_LASSO_F7_ERROR_PEER_LINUX_H
#include "capture-spool.h"
#ifdef __cplusplus
extern "C" {
#endif
struct f7_linux_error_peer {
 f7_handle socket;
 int64_t original_pid;uint64_t original_uid,original_gid;
};
struct f7_linux_receive_fact {
 int native_called;int64_t returned,native_error;
 uint64_t native_queries;int socket_type,socket_family,passcred;
 int64_t connected_pid;uint64_t connected_uid,connected_gid;
 uint64_t message_flags,control_length;
 int credentials_count;int64_t actual_pid;uint64_t actual_uid,actual_gid;
};
/* PRIVATE native source only. The original independently admitted ROOT owner
   supplies the held socket and original creator credentials; these arguments
   cannot create a role, substitute a PID lookup or prove child lifetime.
   Body/control buffers remain original byte records on every result. Unknown
   ancillary capabilities are retained in control bytes for the owning native
   custodian, never silently closed/adopted/re-issued by this receiver. */
int f7_linux_error_peer_receive(const struct f7_linux_error_peer *peer,
 uint8_t *body,size_t capacity,uint8_t *control,size_t control_capacity,
 struct f7_linux_receive_fact *fact);
#ifdef __cplusplus
}
#endif
#endif
