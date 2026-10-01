/* Root-owned Darwin host-runner service.  The daemon creates the resident
 * primary itself and retains primary identity plus one-shot grants. */
#include <sys/types.h>
#include <sys/stat.h>
#include <sys/proc_info.h>
#include <sys/codesign.h>
#include <libproc.h>
#include <mach/mach.h>
#include <bsm/libbsm.h>
#include <CommonCrypto/CommonDigest.h>
#include <fcntl.h>
#include <spawn.h>
#include <unistd.h>
#include <xpc/xpc.h>
#include <stdbool.h>
#include <stdint.h>
#include <limits.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
extern char **environ;
#define SHA_LEN CC_SHA256_DIGEST_LENGTH
#define MAX_GRANTS 64
typedef struct { bool live; dev_t dev; ino_t ino; audit_token_t peer; time_t expiry; } grant_t;
typedef struct { pid_t pid; uint64_t birth; pid_t parent; audit_token_t audit; unsigned char image_sha256[SHA_LEN]; } primary_t;
static grant_t grants[MAX_GRANTS]; static primary_t primary; static int receipt_fd = -1;
static char self_path[PROC_PIDPATHINFO_MAXSIZE];
static void receipt(const char *event, bool accepted) { char line[192]; int n = snprintf(line, sizeof line, "event=%s accepted=%d primary=%d birth=%llu\\n", event, accepted ? 1 : 0, primary.pid, (unsigned long long)primary.birth); if (receipt_fd >= 0 && n > 0) (void)write(receipt_fd, line, (size_t)n); }
static bool hash_fd(int fd, unsigned char digest[SHA_LEN]) { unsigned char buffer[8192]; CC_SHA256_CTX ctx; ssize_t n; if (fd < 0 || lseek(fd, 0, SEEK_SET) < 0) return false; CC_SHA256_Init(&ctx); while ((n = read(fd, buffer, sizeof buffer)) > 0) CC_SHA256_Update(&ctx, buffer, (CC_LONG)n); if (n < 0 || lseek(fd, 0, SEEK_SET) < 0) return false; CC_SHA256_Final(digest, &ctx); return true; }
static bool protected_root_regular_fd(int fd, unsigned char digest[SHA_LEN]) { struct stat st; return fd >= 0 && fstat(fd, &st) == 0 && S_ISREG(st.st_mode) && st.st_uid == 0 && (st.st_mode & 0077) == 0 && st.st_nlink == 1 && hash_fd(fd, digest); }
static bool exact_digest(xpc_object_t request, const char *key, const unsigned char actual[SHA_LEN]) { size_t length = 0; const unsigned char *expected = xpc_dictionary_get_data(request, key, &length); return expected != NULL && length == SHA_LEN && memcmp(expected, actual, SHA_LEN) == 0; }
/* Parent data must contain the authenticated leaf digest. Both were hashed through held FDs. */
static bool parent_binds_leaf(int parent_fd, const unsigned char leaf[SHA_LEN]) { unsigned char chunk[8192]; ssize_t n; if (lseek(parent_fd, 0, SEEK_SET) < 0) return false; while ((n = read(parent_fd, chunk, sizeof chunk)) > 0) for (ssize_t i = 0; i + SHA_LEN <= n; i++) if (memcmp(chunk + i, leaf, SHA_LEN) == 0) { lseek(parent_fd, 0, SEEK_SET); return true; } lseek(parent_fd, 0, SEEK_SET); return false; }
static bool primary_is_live_and_owned(void) { struct proc_bsdinfo info; int status = 0; mach_port_t task = MACH_PORT_NULL; audit_token_t token; mach_msg_type_number_t count = TASK_AUDIT_TOKEN_COUNT; if (primary.pid <= 1 || proc_pidinfo(primary.pid, PROC_PIDTBSDINFO, 0, &info, sizeof info) != sizeof info || (uint64_t)info.pbi_start_tvsec != primary.birth || info.pbi_ppid != getpid()) return false; if (task_for_pid(mach_task_self(), primary.pid, &task) != KERN_SUCCESS) return false; kern_return_t kr = task_info(task, TASK_AUDIT_TOKEN, (task_info_t)&token, &count); mach_port_deallocate(mach_task_self(), task); return kr == KERN_SUCCESS && count == TASK_AUDIT_TOKEN_COUNT && audit_token_to_pid(token) == primary.pid && memcmp(&token, &primary.audit, sizeof token) == 0 && csops(primary.pid, CS_OPS_STATUS, &status, sizeof status) == 0 && (status & CS_VALID) != 0 && (status & CS_HARD) != 0; }
static bool capture_primary(pid_t pid, const unsigned char image[SHA_LEN]) { struct proc_bsdinfo info; mach_port_t task = MACH_PORT_NULL; mach_msg_type_number_t count = TASK_AUDIT_TOKEN_COUNT; if (proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &info, sizeof info) != sizeof info || info.pbi_ppid != getpid() || task_for_pid(mach_task_self(), pid, &task) != KERN_SUCCESS) return false; kern_return_t kr = task_info(task, TASK_AUDIT_TOKEN, (task_info_t)&primary.audit, &count); mach_port_deallocate(mach_task_self(), task); if (kr != KERN_SUCCESS || count != TASK_AUDIT_TOKEN_COUNT || audit_token_to_pid(primary.audit) != pid) return false; primary.pid = pid; primary.birth = (uint64_t)info.pbi_start_tvsec; primary.parent = info.pbi_ppid; memcpy(primary.image_sha256, image, SHA_LEN); return primary_is_live_and_owned(); }
static bool spawn_resident_primary(const unsigned char image[SHA_LEN]) { pid_t pid = 0; char *argv[] = { self_path, "--resident-primary", NULL }; if (posix_spawn(&pid, self_path, NULL, NULL, argv, environ) != 0) return false; for (int i = 0; i < 20; i++) { if (capture_primary(pid, image)) return true; usleep(10000); } (void)kill(pid, SIGTERM); return false; }
static void revoke_peer(audit_token_t peer) { for (size_t i = 0; i < MAX_GRANTS; i++) if (grants[i].live && memcmp(&grants[i].peer, &peer, sizeof peer) == 0) grants[i].live = false; }
static void revoke_expired(void) { time_t now = time(NULL); for (size_t i = 0; i < MAX_GRANTS; i++) if (grants[i].live && grants[i].expiry <= now) grants[i].live = false; }
static int issue_capability(audit_token_t peer, uint64_t expiry) { int fds[2] = {-1, -1}; struct stat st; revoke_expired(); if (expiry <= (uint64_t)time(NULL) || expiry > (uint64_t)time(NULL) + 60 || pipe(fds) != 0 || fstat(fds[1], &st) != 0) { if (fds[0] >= 0) close(fds[0]); if (fds[1] >= 0) close(fds[1]); return -1; } for (size_t i = 0; i < MAX_GRANTS; i++) if (!grants[i].live) { grants[i] = (grant_t){ .live=true, .dev=st.st_dev, .ino=st.st_ino, .peer=peer, .expiry=(time_t)expiry }; close(fds[0]); return fds[1]; } close(fds[0]); close(fds[1]); return -1; }
static bool consume_capability(int capability, audit_token_t peer) { struct stat st; bool ok = false; revoke_expired(); if (capability < 0 || fstat(capability, &st) != 0) return false; for (size_t i = 0; i < MAX_GRANTS; i++) if (grants[i].live && grants[i].dev == st.st_dev && grants[i].ino == st.st_ino && memcmp(&grants[i].peer, &peer, sizeof peer) == 0) { grants[i].live = false; ok = true; break; } close(capability); return ok; }
static void handle_connection(xpc_connection_t peer) { xpc_connection_set_event_handler(peer, ^(xpc_object_t message) { audit_token_t peer_token; xpc_connection_get_audit_token(peer, &peer_token); if (xpc_get_type(message) == XPC_TYPE_ERROR) { revoke_peer(peer_token); receipt("disconnect-revoke", false); return; } if (xpc_get_type(message) != XPC_TYPE_DICTIONARY || audit_token_to_euid(peer_token) != 0) return; const char *operation = xpc_dictionary_get_string(message, "operation"); if (operation != NULL && strcmp(operation, "issue-grant") == 0) { int fd = issue_capability(peer_token, xpc_dictionary_get_uint64(message, "expires_at_unix")); xpc_dictionary_set_fd(message, "capability_fd", fd); if (fd >= 0) close(fd); xpc_dictionary_set_bool(message, "accepted", fd >= 0); receipt("grant-issued", fd >= 0); xpc_connection_send_message(peer, message); return; } int parent = xpc_dictionary_dup_fd(message, "parent_fd"), leaf = xpc_dictionary_dup_fd(message, "leaf_fd"), capability = xpc_dictionary_dup_fd(message, "capability_fd"); unsigned char parent_sha[SHA_LEN], leaf_sha[SHA_LEN]; bool ok = primary_is_live_and_owned() && consume_capability(capability, peer_token) && protected_root_regular_fd(parent, parent_sha) && protected_root_regular_fd(leaf, leaf_sha) && exact_digest(message, "parent_sha256", parent_sha) && exact_digest(message, "leaf_sha256", leaf_sha) && parent_binds_leaf(parent, leaf_sha); if (parent >= 0) close(parent); if (leaf >= 0) close(leaf); xpc_dictionary_set_bool(message, "accepted", ok); receipt("completion", ok); xpc_connection_send_message(peer, message); }); xpc_connection_resume(peer); }
int main(int argc, char **argv) { if (argc == 2 && strcmp(argv[1], "--resident-primary") == 0) { for (;;) pause(); } if (argc != 3 || strcmp(argv[1], "--state-dir") != 0 || geteuid() != 0 || proc_pidpath(getpid(), self_path, sizeof self_path) <= 0) return 64; int image_fd = open(self_path, O_RDONLY | O_CLOEXEC); unsigned char image[SHA_LEN]; if (image_fd < 0 || !hash_fd(image_fd, image) || !spawn_resident_primary(image)) return 65; close(image_fd); char receipt_path[PATH_MAX]; if (snprintf(receipt_path, sizeof receipt_path, "%s/private-receipt.log", argv[2]) >= (int)sizeof receipt_path) return 66; receipt_fd = open(receipt_path, O_WRONLY|O_APPEND|O_CREAT|O_CLOEXEC, 0600); if (receipt_fd < 0) return 67; receipt("daemon-ready", true); xpc_main(^(xpc_connection_t p) { handle_connection(p); }); return 0; }
