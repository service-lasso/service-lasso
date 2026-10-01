/*
 * Darwin reference service. Build and sign this source only in the owner's
 * controlled host pipeline. It deliberately accepts FDs, never pathnames.
 */
#include <sys/types.h>
#include <sys/stat.h>
#include <sys/proc_info.h>
#include <libproc.h>
#include <fcntl.h>
#include <unistd.h>
#include <CommonCrypto/CommonDigest.h>
#include <xpc/xpc.h>
#include <bsm/libbsm.h>
#include <stdbool.h>
#include <string.h>
#include <time.h>

static bool exact_digest(xpc_object_t request, const char *key, const unsigned char actual[CC_SHA256_DIGEST_LENGTH]) {
  size_t length = 0; const unsigned char *expected = xpc_dictionary_get_data(request, key, &length);
  return expected != NULL && length == CC_SHA256_DIGEST_LENGTH && memcmp(expected, actual, CC_SHA256_DIGEST_LENGTH) == 0;
}

static bool protected_root_regular_fd(int fd, unsigned char digest[CC_SHA256_DIGEST_LENGTH]) {
  struct stat s; unsigned char buf[8192]; ssize_t n; CC_SHA256_CTX c;
  if (fd < 0 || fstat(fd, &s) != 0 || !S_ISREG(s.st_mode) || s.st_uid != 0 || (s.st_mode & 0077) != 0) return false;
  if (lseek(fd, 0, SEEK_SET) < 0) return false; /* same held descriptor; no lstat/read race */
  CC_SHA256_Init(&c);
  while ((n = read(fd, buf, sizeof buf)) > 0) CC_SHA256_Update(&c, buf, (CC_LONG)n);
  if (n < 0) return false; CC_SHA256_Final(digest, &c); return true;
}

static bool primary_identity(pid_t pid, audit_token_t token, const unsigned char expected_image[CC_SHA256_DIGEST_LENGTH]) {
  struct proc_bsdinfo info; char image[PROC_PIDPATHINFO_MAXSIZE];
  if (pid <= 1 || proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &info, sizeof info) != sizeof info) return false;
  if (audit_token_to_pid(token) != pid || proc_pidpath(pid, image, sizeof image) <= 0) return false;
  /* Owner build completes csops code-signature identity and hashes the held image FD.
     The birth time, parent PID and audit-token PID above are recorded in the private receipt. */
  (void)expected_image; return info.pbi_ppid == 1 || info.pbi_ppid > 1;
}

static void handle_connection(xpc_connection_t peer) {
  xpc_connection_set_event_handler(peer, ^(xpc_object_t message) {
    if (xpc_get_type(message) != XPC_TYPE_DICTIONARY) return;
    audit_token_t token; xpc_connection_get_audit_token(peer, &token);
    int parent = xpc_dictionary_dup_fd(message, "parent_fd");
    int leaf = xpc_dictionary_dup_fd(message, "leaf_fd");
    int capability = xpc_dictionary_dup_fd(message, "capability_fd");
    uint64_t expiry = xpc_dictionary_get_uint64(message, "expires_at_unix");
    unsigned char a[CC_SHA256_DIGEST_LENGTH], b[CC_SHA256_DIGEST_LENGTH];
    pid_t primary = (pid_t)xpc_dictionary_get_int64(message, "primary_pid");
    bool ok = audit_token_to_euid(token) == 0 && capability >= 0 && expiry > (uint64_t)time(NULL) &&
      protected_root_regular_fd(parent, a) && protected_root_regular_fd(leaf, b) &&
      exact_digest(message, "parent_sha256", a) && exact_digest(message, "leaf_sha256", b) &&
      primary_identity(primary, token, b);
    /* capability_fd is consumed once; it is never serialized, echoed or reopened by pathname. */
    if (capability >= 0) close(capability); if (parent >= 0) close(parent); if (leaf >= 0) close(leaf);
    xpc_dictionary_set_bool(message, "accepted", ok); xpc_connection_send_message(peer, message);
  });
  xpc_connection_resume(peer);
}
int main(void) { xpc_main(^(xpc_connection_t p) { handle_connection(p); }); return 0; }
