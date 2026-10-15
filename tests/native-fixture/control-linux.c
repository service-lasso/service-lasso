#define _GNU_SOURCE
#include "control-linux.h"

#include <errno.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

int lf_control_check_endpoint(int fd) {
  int domain = 0, type = 0, passcred = 0;
  socklen_t size = sizeof(int); struct stat info;
  if (getsockopt(fd, SOL_SOCKET, SO_DOMAIN, &domain, &size) < 0) return -1;
  if (size != sizeof(int) || domain != AF_UNIX) { errno = EPROTO; return -1; }
  size = sizeof(int);
  if (getsockopt(fd, SOL_SOCKET, SO_TYPE, &type, &size) < 0) return -1;
  if (size != sizeof(int) || type != SOCK_SEQPACKET) { errno = EPROTO; return -1; }
  size = sizeof(int);
  if (getsockopt(fd, SOL_SOCKET, SO_PASSCRED, &passcred, &size) < 0) return -1;
  if (size != sizeof(int) || passcred != 1) { errno = EPROTO; return -1; }
  if (fstat(fd, &info) < 0) return -1;
  if (!S_ISSOCK(info.st_mode)) { errno = EPROTO; return -1; }
  return 0;
}

int lf_control_pair(int endpoints[2],
                     struct lf_control_setup_observation *observation) {
  if (!observation) { errno = EINVAL; return -1; }
  memset(observation, 0, sizeof(*observation));
  observation->stage = LF_CONTROL_SOCKET_PAIR;
  if (!endpoints) {
    observation->primary_error = EINVAL; errno = EINVAL; return -1;
  }
  endpoints[0] = endpoints[1] = -1;
  if (socketpair(AF_UNIX, SOCK_SEQPACKET | SOCK_CLOEXEC | SOCK_NONBLOCK,
                 0, endpoints) < 0) {
    observation->primary_error = errno; return -1;
  }
  int enabled = 1;
  observation->stage = LF_CONTROL_PASSCRED_FIRST;
  if (setsockopt(endpoints[0], SOL_SOCKET, SO_PASSCRED,
                 &enabled, sizeof(enabled)) < 0) goto failed;
  observation->stage = LF_CONTROL_PASSCRED_SECOND;
  if (setsockopt(endpoints[1], SOL_SOCKET, SO_PASSCRED,
                 &enabled, sizeof(enabled)) < 0) goto failed;
  observation->stage = LF_CONTROL_VERIFY_FIRST;
  if (lf_control_check_endpoint(endpoints[0]) < 0) goto failed;
  observation->stage = LF_CONTROL_VERIFY_SECOND;
  if (lf_control_check_endpoint(endpoints[1]) < 0) goto failed;
  observation->stage = LF_CONTROL_SETUP_COMPLETE; return 0;
failed:
  observation->primary_error = errno;
  if (close(endpoints[0]) < 0) observation->close_errors[0] = errno;
  if (close(endpoints[1]) < 0) observation->close_errors[1] = errno;
  endpoints[0] = endpoints[1] = -1;
  errno = observation->primary_error; return -1;
}

ssize_t lf_control_send(int fd, const void *packet, size_t packet_bytes) {
  if (!packet || !packet_bytes || packet_bytes > LF_CONTROL_MAX_PACKET) {
    errno = EMSGSIZE; return -1;
  }
  struct iovec bytes = {(void *)packet, packet_bytes};
  struct msghdr message;
  memset(&message, 0, sizeof(message));
  message.msg_iov = &bytes; message.msg_iovlen = 1;
  /* Both S and W0 use this actual no-ancillary issuer. Kernel PASSCRED on the
   * receiving held endpoint provides credentials; no SCM_RIGHTS is emitted. */
  message.msg_control = NULL; message.msg_controllen = 0;
  /* Broken peer produces the actual EPIPE for independent failure capture,
   * rather than an incidental SIGPIPE killing the native control worker. */
  return sendmsg(fd, &message, MSG_DONTWAIT | MSG_NOSIGNAL);
}

static void reject_rights(struct cmsghdr *header,
                          struct lf_packet_observation *observation) {
  if (header->cmsg_len < CMSG_LEN(0)) return;
  size_t payload = header->cmsg_len - CMSG_LEN(0);
  for (size_t offset = 0; offset + sizeof(int) <= payload; offset += sizeof(int)) {
    int descriptor;
    memcpy(&descriptor, (unsigned char *)CMSG_DATA(header) + offset,
            sizeof(descriptor));
    observation->rejected_descriptor_count++;
    /* Linux close may report failure after actually releasing a slot. Never
     * retry and risk closing a reused descriptor. The real errno is retained. */
    if (close(descriptor) < 0 && !observation->descriptor_close_error)
      observation->descriptor_close_error = errno;
  }
}

struct lf_packet_observation lf_control_receive(
    int fd, const struct lf_control_peer *held_peer,
    void *packet, size_t packet_capacity) {
  struct lf_packet_observation observation;
  memset(&observation, 0, sizeof(observation));
  observation.status = LF_PACKET_NATIVE_ERROR;
  observation.native_result = -1;
  if (!held_peer || held_peer->pid <= 0 || !packet || !packet_capacity ||
      packet_capacity > LF_CONTROL_MAX_PACKET) {
    observation.native_error = EINVAL; return observation;
  }
  /* Correct alignment, bounded ancillary storage. A truncated message fails;
   * the kernel closes SCM_RIGHTS descriptors which do not fit this buffer. */
  union {
    struct cmsghdr alignment;
    unsigned char bytes[CMSG_SPACE(sizeof(struct ucred))];
  } ancillary;
  memset(&ancillary, 0, sizeof(ancillary));
  struct iovec bytes = {packet, packet_capacity};
  struct msghdr message;
  memset(&message, 0, sizeof(message));
  message.msg_iov = &bytes; message.msg_iovlen = 1;
  message.msg_control = ancillary.bytes;
  message.msg_controllen = sizeof(ancillary.bytes);
  ssize_t received = recvmsg(fd, &message, MSG_DONTWAIT | MSG_CMSG_CLOEXEC);
  observation.native_result = received;
  observation.message_flags = message.msg_flags;
  if (received < 0) {
    observation.native_error = errno;
    observation.status = errno == EAGAIN || errno == EWOULDBLOCK
        ? LF_PACKET_WOULD_BLOCK : LF_PACKET_NATIVE_ERROR;
    return observation;
  }
  observation.captured_bytes = (size_t)received > packet_capacity
      ? packet_capacity : (size_t)received;
  bool ancillary_error = false; unsigned int credential_count = 0;
  for (struct cmsghdr *header = CMSG_FIRSTHDR(&message); header;
       header = CMSG_NXTHDR(&message, header)) {
    size_t offset = (size_t)((unsigned char *)header - ancillary.bytes);
    if (offset > message.msg_controllen ||
        header->cmsg_len < CMSG_LEN(0) ||
        header->cmsg_len > message.msg_controllen - offset) {
      ancillary_error = true; break;
    }
    if (header->cmsg_level == SOL_SOCKET && header->cmsg_type == SCM_RIGHTS) {
      reject_rights(header, &observation); ancillary_error = true;
    } else if (header->cmsg_level == SOL_SOCKET &&
                header->cmsg_type == SCM_CREDENTIALS &&
                header->cmsg_len == CMSG_LEN(sizeof(struct ucred))) {
      struct ucred credentials;
      memcpy(&credentials, CMSG_DATA(header), sizeof(credentials));
      credential_count++;
      observation.has_credentials = true;
      observation.actual_peer = (struct lf_control_peer){
        credentials.pid, credentials.uid, credentials.gid
      };
    } else ancillary_error = true;
  }
  int known_flags = MSG_TRUNC | MSG_CTRUNC | MSG_EOR | MSG_CMSG_CLOEXEC;
  if (message.msg_flags & ~known_flags) ancillary_error = true;
  if (message.msg_flags & (MSG_TRUNC | MSG_CTRUNC))
    observation.status = LF_PACKET_TRUNCATED;
  else if (ancillary_error || observation.rejected_descriptor_count ||
           observation.descriptor_close_error)
    observation.status = LF_PACKET_ANCILLARY_ERROR;
  else if (received == 0)
    observation.status = LF_PACKET_EOF;
  else if (credential_count != 1 ||
           observation.actual_peer.pid != held_peer->pid ||
           observation.actual_peer.uid != held_peer->uid ||
           observation.actual_peer.gid != held_peer->gid)
    observation.status = LF_PACKET_CREDENTIAL_ERROR;
  else observation.status = LF_PACKET_RECEIVED;
  return observation;
}
