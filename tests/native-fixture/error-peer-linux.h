#ifndef SERVICE_LASSO_F7_ERROR_PEER_LINUX_H
#define SERVICE_LASSO_F7_ERROR_PEER_LINUX_H
#include "capture-spool.h"
#ifdef __cplusplus
extern "C" {
#endif
struct f7_linux_error_peer {
 f7_handle socket;
 f7_handle original_object_reference;uint8_t original_object[24];
 int64_t original_pid;uint64_t original_uid,original_gid;
 int64_t original_connected_pid;uint64_t original_connected_uid,original_connected_gid;
};
struct f7_linux_receive_fact {
 int native_called;int64_t returned,native_error;
 uint64_t native_queries;int socket_type,socket_family,passcred;
 int64_t connected_pid;uint64_t connected_uid,connected_gid;
 uint64_t message_flags,control_length;
 int credentials_count;int64_t actual_pid;uint64_t actual_uid,actual_gid;
 uint8_t actual_object[24],reference_object[24];int descriptor_flags;
 int64_t object_query_return,reference_query_return,flags_query_return;
};
/* PRIVATE native source only. The original independently admitted ROOT owner
   supplies the held socket, original endpoint creator and original per-message
   sender credentials separately; these arguments
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
