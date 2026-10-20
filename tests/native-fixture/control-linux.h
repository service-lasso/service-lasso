#ifndef SERVICE_LASSO_CONTROL_LINUX_H
#define SERVICE_LASSO_CONTROL_LINUX_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include <sys/socket.h>
#include <sys/types.h>

#define LF_CONTROL_MAX_PACKET 65536u

/* Native creator/observer binds this tuple to its actual held peer lifetime
 * and exclusive endpoint. It is not reconstructed from a packet or JS input.
 * W0 never acquires S's pidfd or another role's descriptor-transfer channel. */
struct lf_control_peer { pid_t pid; uid_t uid; gid_t gid; };

enum lf_packet_status {
  LF_PACKET_RECEIVED,
  LF_PACKET_WOULD_BLOCK,
  LF_PACKET_EOF,
  LF_PACKET_NATIVE_ERROR,
  LF_PACKET_TRUNCATED,
  LF_PACKET_CREDENTIAL_ERROR,
  LF_PACKET_ANCILLARY_ERROR
};

/* Private native observation, never public text. The caller captures the real
 * prefix, status and any close error through O before choosing FAILED. */
struct lf_packet_observation {
  enum lf_packet_status status;
  ssize_t native_result;
  size_t captured_bytes;
  int native_error;
  int message_flags;
  bool has_credentials;
  struct lf_control_peer actual_peer;
  size_t rejected_descriptor_count;
  int descriptor_close_error;
};

enum lf_control_setup_stage {
  LF_CONTROL_SOCKET_PAIR,
  LF_CONTROL_PASSCRED_FIRST,
  LF_CONTROL_PASSCRED_SECOND,
  LF_CONTROL_VERIFY_FIRST,
  LF_CONTROL_VERIFY_SECOND,
  LF_CONTROL_SETUP_COMPLETE
};
struct lf_control_setup_observation {
  enum lf_control_setup_stage stage;
  int primary_error;
  int close_errors[2];
};

/* Before downstream launch: CLOEXEC/nonblocking private socketpair, PASSCRED
 * on both endpoints. Caller closes redundant inherited ends and separately
 * binds source/role/birth/state; socket creation alone grants no authority. */
int lf_control_pair(int endpoints[2], struct lf_control_setup_observation *);
int lf_control_check_endpoint(int fd);

/* Fixed credential-only send: no caller ancillary parameter, NULL control.
 * Returns actual sendmsg result/errno. No retry, synthetic ACK or fragmentation.
 * The higher-level source codec validates exact role/state/sequence/header. */
ssize_t lf_control_send(int fd, const void *packet, size_t packet_bytes);

/* Actual recvmsg with SCM_CREDENTIALS, truncation/extra/SCM_RIGHTS rejection.
 * WOULD_BLOCK is not settlement; the native worker waits on its pre-admitted
 * held epoll endpoint with the caller's original absolute deadline.
 * Any other non-RECEIVED status is failed/unresolved, never process-exit proof.
 * S never sends FDs to W0; BPF alone cannot prove pointed-to ancillary contents.
 * Unexpected capabilities are closed before exposure and privately recorded.
 */
struct lf_packet_observation lf_control_receive(
    int fd, const struct lf_control_peer *held_peer,
    void *packet, size_t packet_capacity);

#endif
